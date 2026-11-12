//! Métadonnées externes facultatives (clé API fournie par l'utilisateur) :
//! TMDB (casting avec photos, équipe, bande-annonce, filmographies) et OMDb (note IMDb).

use serde::Serialize;
use serde_json::Value;

use crate::vod::{fold, Person, VodDetail, VodKind};

const IMG: &str = "https://image.tmdb.org/t/p";
const API: &str = "https://api.themoviedb.org/3";

/// Clé v3 (`api_key=`) ou jeton v4 (en-tête Bearer) : renvoie le paramètre d'URL à ajouter.
pub fn key_param(key: &str) -> String {
    if is_bearer(key) { String::new() } else { format!("&api_key={}", key.trim()) }
}

pub fn is_bearer(key: &str) -> bool {
    key.trim().len() > 60 && key.contains('.')
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn media(kind: Option<VodKind>) -> &'static str {
    if matches!(kind, Some(VodKind::Series) | Some(VodKind::Show)) { "tv" } else { "movie" }
}

pub fn search_url(kind: Option<VodKind>, title: &str, year: Option<u16>, key: &str, lang: &str) -> String {
    let m = media(kind);
    let year_param = match (m, year) {
        ("movie", Some(y)) => format!("&year={y}"),
        ("tv", Some(y)) => format!("&first_air_date_year={y}"),
        _ => String::new(),
    };
    format!("{API}/search/{m}?query={}{year_param}&language={lang}{}", enc(title), key_param(key))
}

pub fn details_url(kind: Option<VodKind>, id: u64, key: &str, lang: &str) -> String {
    let short = lang.split('-').next().unwrap_or("en");
    format!(
        "{API}/{}/{id}?append_to_response=credits,videos,external_ids,release_dates,content_ratings&include_video_language={short},en,null&language={lang}{}",
        media(kind),
        key_param(key)
    )
}

pub fn person_search_url(name: &str, key: &str, lang: &str) -> String {
    format!("{API}/search/person?query={}&language={lang}{}", enc(name), key_param(key))
}

pub fn person_url(id: u64, key: &str, lang: &str) -> String {
    format!("{API}/person/{id}?append_to_response=combined_credits&language={lang}{}", key_param(key))
}

pub fn omdb_url(imdb_id: &str, key: &str) -> String {
    format!("https://www.omdbapi.com/?i={}&apikey={}", enc(imdb_id), enc(key.trim()))
}

/// Premier résultat de recherche dont le titre correspond (sinon le plus populaire).
pub fn pick_search_result(json: &Value, title: &str) -> Option<u64> {
    let results = json["results"].as_array()?;
    let t = fold(title);
    results
        .iter()
        .find(|r| ["title", "name", "original_title", "original_name"].iter().any(|k| r[*k].as_str().is_some_and(|x| fold(x) == t)))
        .or_else(|| results.first())
        .and_then(|r| r["id"].as_u64())
}

fn str_of(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Complète une fiche avec les données TMDB (sans écraser épisodes ni flux de la source).
pub fn apply_details(d: &mut VodDetail, json: &Value) {
    let it = &mut d.item;
    it.tmdb_id = json["id"].as_u64().or(it.tmdb_id);
    if let Some(p) = str_of(&json["overview"]) {
        it.plot = Some(p);
    }
    if let Some(p) = str_of(&json["poster_path"]) {
        it.poster = Some(format!("{IMG}/w500{p}"));
    }
    if let Some(b) = str_of(&json["backdrop_path"]) {
        it.backdrop = Some(format!("{IMG}/w1280{b}"));
    }
    let genres: Vec<String> = json["genres"].as_array().map(|g| g.iter().filter_map(|x| str_of(&x["name"])).collect()).unwrap_or_default();
    if !genres.is_empty() {
        it.genres = genres;
    }
    let date = str_of(&json["release_date"]).or_else(|| str_of(&json["first_air_date"]));
    it.year = it.year.or_else(|| date.and_then(|d| d.get(..4)?.parse().ok()));
    if let Some(r) = json["runtime"].as_u64().or_else(|| json["episode_run_time"].as_array().and_then(|a| a.first()).and_then(Value::as_u64)) {
        it.duration = it.duration.or(Some(r as u32 * 60));
    }
    it.imdb_id = str_of(&json["external_ids"]["imdb_id"]).or_else(|| str_of(&json["imdb_id"])).or(it.imdb_id.take());
    d.tmdb_rating = json["vote_average"].as_f64().map(|v| v as f32).filter(|v| *v > 0.0);
    d.tagline = str_of(&json["tagline"]);
    d.countries = json["production_countries"]
        .as_array()
        .or_else(|| json["origin_country"].as_array())
        .map(|c| c.iter().filter_map(|x| str_of(&x["name"]).or_else(|| str_of(x))).collect())
        .unwrap_or_default();

    // Bande-annonce : YouTube, « Trailer » officiel en priorité.
    if let Some(videos) = json["videos"]["results"].as_array() {
        let best = videos
            .iter()
            .filter(|v| v["site"].as_str() == Some("YouTube"))
            .max_by_key(|v| (v["type"].as_str() == Some("Trailer")) as u8 * 2 + v["official"].as_bool().unwrap_or(false) as u8);
        if let Some(k) = best.and_then(|v| str_of(&v["key"])) {
            it.trailer = Some(k);
        }
    }

    let cast: Vec<Person> = json["credits"]["cast"]
        .as_array()
        .map(|c| {
            c.iter()
                .take(30)
                .filter_map(|p| {
                    Some(Person {
                        name: str_of(&p["name"])?,
                        role: str_of(&p["character"]),
                        photo: str_of(&p["profile_path"]).map(|x| format!("{IMG}/w185{x}")),
                        tmdb_id: p["id"].as_u64(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if !cast.is_empty() {
        it.cast = cast.iter().map(|p| p.name.clone()).collect();
        d.cast = cast;
    }
    const JOBS: &[(&str, &str)] = &[("Director", "Réalisation"), ("Producer", "Production"), ("Executive Producer", "Production exécutive"), ("Screenplay", "Scénario"), ("Writer", "Scénario"), ("Original Music Composer", "Musique")];
    let mut crew: Vec<Person> = json["credits"]["crew"]
        .as_array()
        .map(|c| {
            c.iter()
                .filter_map(|p| {
                    let job = p["job"].as_str()?;
                    let label = JOBS.iter().find(|(j, _)| *j == job)?.1;
                    Some(Person { name: str_of(&p["name"])?, role: Some(label.into()), photo: str_of(&p["profile_path"]).map(|x| format!("{IMG}/w185{x}")), tmdb_id: p["id"].as_u64() })
                })
                .collect()
        })
        .unwrap_or_default();
    // Créateurs de séries.
    if let Some(created) = json["created_by"].as_array() {
        crew.extend(created.iter().filter_map(|p| Some(Person { name: str_of(&p["name"])?, role: Some("Création".into()), photo: str_of(&p["profile_path"]).map(|x| format!("{IMG}/w185{x}")), tmdb_id: p["id"].as_u64() })));
    }
    if !crew.is_empty() {
        let directors: Vec<String> = crew.iter().filter(|p| matches!(p.role.as_deref(), Some("Réalisation") | Some("Création"))).map(|p| p.name.clone()).collect();
        if !directors.is_empty() {
            it.directors = directors;
        }
        d.crew = crew;
    }

    // Classification d'âge (pays de la langue, puis FR, puis US).
    let certs: Vec<String> = json["release_dates"]["results"]
        .as_array()
        .map(|r| r.iter().filter(|c| matches!(c["iso_3166_1"].as_str(), Some("FR") | Some("US") | Some("DE") | Some("GB"))).flat_map(|c| c["release_dates"].as_array().cloned().unwrap_or_default()).filter_map(|x| str_of(&x["certification"])).collect())
        .or_else(|| json["content_ratings"]["results"].as_array().map(|r| r.iter().filter_map(|c| str_of(&c["rating"])).collect()))
        .unwrap_or_default();
    d.age = d.age.or_else(|| certs.iter().filter_map(|c| crate::parental::age_from_rating(c)).max());
}

pub fn apply_omdb(d: &mut VodDetail, json: &Value) {
    d.imdb_rating = json["imdbRating"].as_str().and_then(|r| r.parse().ok());
    d.imdb_votes = str_of(&json["imdbVotes"]).filter(|v| v != "N/A");
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    pub title: String,
    pub year: Option<u16>,
    pub kind: VodKind,
    pub tmdb_id: u64,
    pub role: Option<String>,
    pub poster: Option<String>,
    pub popularity: f64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersonInfo {
    pub name: String,
    pub photo: Option<String>,
    pub biography: Option<String>,
    pub birthday: Option<String>,
    pub known_for: Option<String>,
    pub credits: Vec<Credit>,
}

/// Fiche personne + filmographie (`/person/{id}?append_to_response=combined_credits`).
pub fn person_info(json: &Value) -> PersonInfo {
    let mut credits: Vec<Credit> = ["cast", "crew"]
        .iter()
        .flat_map(|k| json["combined_credits"][*k].as_array().cloned().unwrap_or_default())
        .filter_map(|c| {
            let kind = if c["media_type"].as_str() == Some("tv") { VodKind::Series } else { VodKind::Movie };
            let date = str_of(&c["release_date"]).or_else(|| str_of(&c["first_air_date"]));
            Some(Credit {
                title: str_of(&c["title"]).or_else(|| str_of(&c["name"]))?,
                year: date.and_then(|d| d.get(..4)?.parse().ok()),
                kind,
                tmdb_id: c["id"].as_u64()?,
                role: str_of(&c["character"]).or_else(|| str_of(&c["job"])),
                poster: str_of(&c["poster_path"]).map(|p| format!("{IMG}/w342{p}")),
                popularity: c["popularity"].as_f64().unwrap_or(0.0),
            })
        })
        .collect();
    credits.sort_by(|a, b| b.year.cmp(&a.year));
    let mut seen = std::collections::HashSet::new();
    credits.retain(|c| seen.insert((c.tmdb_id, c.kind as u8)));
    PersonInfo {
        name: str_of(&json["name"]).unwrap_or_default(),
        photo: str_of(&json["profile_path"]).map(|p| format!("{IMG}/w342{p}")),
        biography: str_of(&json["biography"]),
        birthday: str_of(&json["birthday"]),
        known_for: str_of(&json["known_for_department"]),
        credits,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vod::VodItem;
    use serde_json::json;

    #[test]
    fn applies_tmdb_details() {
        let mut d = VodDetail { item: VodItem { title: "Film".into(), kind: Some(VodKind::Movie), url: Some("u".into()), ..Default::default() }, ..Default::default() };
        let j = json!({
            "id": 7, "overview": "Résumé", "poster_path": "/p.jpg", "vote_average": 7.8, "release_date": "1999-03-31", "runtime": 136,
            "external_ids": { "imdb_id": "tt0133093" },
            "videos": { "results": [ { "site": "YouTube", "type": "Teaser", "key": "teaser" }, { "site": "YouTube", "type": "Trailer", "official": true, "key": "trailer" } ] },
            "credits": { "cast": [ { "id": 1, "name": "Actrice A", "character": "Rôle", "profile_path": "/a.jpg" } ],
                         "crew": [ { "id": 2, "name": "Réal B", "job": "Director" }, { "id": 3, "name": "Prod C", "job": "Producer" }, { "id": 4, "name": "X", "job": "Grip" } ] },
            "release_dates": { "results": [ { "iso_3166_1": "FR", "release_dates": [ { "certification": "12" } ] } ] }
        });
        apply_details(&mut d, &j);
        assert_eq!(d.item.trailer.as_deref(), Some("trailer"));
        assert_eq!(d.item.imdb_id.as_deref(), Some("tt0133093"));
        assert_eq!(d.item.year, Some(1999));
        assert_eq!(d.item.url.as_deref(), Some("u"), "le flux de la source est conservé");
        assert_eq!(d.cast[0].photo.as_deref(), Some("https://image.tmdb.org/t/p/w185/a.jpg"));
        assert_eq!(d.crew.len(), 2);
        assert_eq!(d.item.directors, vec!["Réal B"]);
        assert_eq!(d.age, Some(12));
        apply_omdb(&mut d, &json!({ "imdbRating": "8.7", "imdbVotes": "2,000,000" }));
        assert_eq!(d.imdb_rating, Some(8.7));
    }

    #[test]
    fn picks_matching_result_and_builds_filmography() {
        let s = json!({ "results": [ { "id": 1, "title": "Autre" }, { "id": 2, "title": "Le Film" } ] });
        assert_eq!(pick_search_result(&s, "le film"), Some(2));
        let p = json!({ "name": "A", "combined_credits": { "cast": [
            { "id": 10, "media_type": "movie", "title": "Vieux", "release_date": "1990-01-01" },
            { "id": 11, "media_type": "tv", "name": "Série", "first_air_date": "2020-01-01" },
            { "id": 10, "media_type": "movie", "title": "Vieux", "release_date": "1990-01-01" } ] } });
        let info = person_info(&p);
        assert_eq!(info.credits.len(), 2);
        assert_eq!(info.credits[0].title, "Série");
        assert!(key_param("abc123").contains("api_key=abc123"));
    }
}
