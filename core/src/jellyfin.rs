//! Serveurs multimédias personnels Jellyfin et Emby (même API) : films et séries de
//! l'utilisateur, avec affiches, casting, saisons et épisodes.

use serde_json::Value;

use crate::util::stable_key;
use crate::vod::{Episode, Person, Season, VodDetail, VodItem, VodKind, VodRef};

pub const CLIENT: &str = "MyIPTV";

/// En-tête d'authentification attendu par Jellyfin/Emby.
pub fn auth_header(device_id: &str, token: Option<&str>) -> String {
    let mut h = format!(r#"MediaBrowser Client="{CLIENT}", Device="MyIPTV", DeviceId="{device_id}", Version="{}""#, env!("CARGO_PKG_VERSION"));
    if let Some(t) = token {
        h.push_str(&format!(r#", Token="{t}""#));
    }
    h
}

pub fn base(server: &str) -> String {
    let s = server.trim().trim_end_matches('/');
    if s.starts_with("http://") || s.starts_with("https://") { s.to_string() } else { format!("http://{s}") }
}

pub const ITEM_FIELDS: &str = "Genres,Overview,ProductionYear,CommunityRating,ProviderIds,DateCreated,RemoteTrailers,OfficialRating,People,Studios,Tags,MediaStreams,RunTimeTicks";

pub fn items_url(server: &str, user_id: &str, types: &str) -> String {
    format!(
        "{}/Users/{user_id}/Items?IncludeItemTypes={types}&Recursive=true&Fields={ITEM_FIELDS}&EnableImageTypes=Primary,Backdrop&ImageTypeLimit=1&SortBy=DateCreated&SortOrder=Descending",
        base(server)
    )
}

pub fn item_url(server: &str, user_id: &str, id: &str) -> String {
    format!("{}/Users/{user_id}/Items/{id}?Fields={ITEM_FIELDS}", base(server))
}

pub fn episodes_url(server: &str, user_id: &str, series_id: &str) -> String {
    format!("{}/Shows/{series_id}/Episodes?UserId={user_id}&Fields=Overview,RunTimeTicks,PremiereDate&EnableImageTypes=Primary", base(server))
}

/// Flux original du fichier (le lecteur le convertit si nécessaire).
pub fn stream_url(server: &str, token: &str, id: &str) -> String {
    format!("{}/Videos/{id}/stream?static=true&api_key={token}", base(server))
}

fn image(server: &str, id: &str, kind: &str, tag: Option<&str>, height: u32) -> Option<String> {
    tag.map(|t| format!("{}/Items/{id}/Images/{kind}?maxHeight={height}&tag={t}", base(server)))
}

fn s(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

fn languages_of(item: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for st in item["MediaStreams"].as_array().into_iter().flatten() {
        if st["Type"].as_str() == Some("Audio") {
            if let Some(l) = st["Language"].as_str().and_then(crate::lang::code_from_alias) {
                if !out.iter().any(|x| x == l) {
                    out.push(l.to_string());
                }
            }
        }
    }
    out
}

fn youtube(item: &Value) -> Option<String> {
    item["RemoteTrailers"].as_array()?.iter().filter_map(|t| t["Url"].as_str()).find_map(|u| {
        let key = u.split("v=").nth(1).or_else(|| u.rsplit('/').next())?;
        Some(key.split('&').next()?.to_string()).filter(|k| k.len() >= 6)
    })
}

/// Liste `/Users/{id}/Items` -> films et séries.
pub fn items(json: &Value, source_id: &str, server: &str, token: &str) -> Vec<VodItem> {
    json["Items"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|it| {
                    let id = s(&it["Id"])?;
                    let kind = match it["Type"].as_str()? {
                        "Movie" => VodKind::Movie,
                        "Series" => VodKind::Series,
                        _ => return None,
                    };
                    let name = s(&it["Name"])?;
                    let people = |types: &[&str]| -> Vec<String> {
                        it["People"].as_array().map(|p| p.iter().filter(|x| x["Type"].as_str().is_some_and(|t| types.contains(&t))).filter_map(|x| s(&x["Name"])).collect()).unwrap_or_default()
                    };
                    Some(VodItem {
                        id: format!("{source_id}:{}", stable_key(&[&id])),
                        source_id: source_id.into(),
                        kind: Some(kind),
                        title: name.clone(),
                        raw_name: name,
                        year: it["ProductionYear"].as_u64().map(|y| y as u16),
                        url: (kind == VodKind::Movie).then(|| stream_url(server, token, &id)),
                        poster: image(server, &id, "Primary", it["ImageTags"]["Primary"].as_str(), 450),
                        backdrop: it["BackdropImageTags"].as_array().and_then(|b| b.first()).and_then(|t| image(server, &id, "Backdrop", t.as_str(), 720)),
                        category: it["Studios"].as_array().and_then(|x| x.first()).and_then(|x| s(&x["Name"])),
                        genres: it["Genres"].as_array().map(|g| g.iter().filter_map(s).collect()).unwrap_or_default(),
                        languages: languages_of(it),
                        rating: it["CommunityRating"].as_f64().map(|r| r as f32),
                        plot: s(&it["Overview"]),
                        cast: people(&["Actor", "GuestStar"]),
                        directors: people(&["Director"]),
                        duration: it["RunTimeTicks"].as_u64().map(|t| (t / 10_000_000) as u32),
                        added: s(&it["DateCreated"]).and_then(|d| chrono::DateTime::parse_from_rfc3339(&d).ok()).map(|d| d.timestamp()),
                        tmdb_id: s(&it["ProviderIds"]["Tmdb"]).and_then(|x| x.parse().ok()),
                        imdb_id: s(&it["ProviderIds"]["Imdb"]),
                        trailer: youtube(it),
                        source_ref: VodRef::Jellyfin { server: base(server), token: token.into(), id },
                        ..Default::default()
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Fiche : casting avec photos, et saisons/épisodes pour une série.
pub fn detail(item: VodItem, full: &Value, episodes: Option<&Value>, server: &str, token: &str) -> VodDetail {
    let person = |p: &Value| -> Option<Person> {
        let id = s(&p["Id"])?;
        Some(Person { name: s(&p["Name"])?, role: s(&p["Role"]).or_else(|| s(&p["Type"])), photo: image(server, &id, "Primary", p["PrimaryImageTag"].as_str(), 200), tmdb_id: None })
    };
    let all: Vec<&Value> = full["People"].as_array().map(|p| p.iter().collect()).unwrap_or_default();
    let cast = all.iter().filter(|p| matches!(p["Type"].as_str(), Some("Actor") | Some("GuestStar"))).filter_map(|p| person(p)).collect();
    let crew = all
        .iter()
        .filter(|p| matches!(p["Type"].as_str(), Some("Director") | Some("Writer") | Some("Producer") | Some("Composer")))
        .filter_map(|p| {
            let mut x = person(p)?;
            x.role = Some(match p["Type"].as_str() {
                Some("Director") => "Réalisation",
                Some("Writer") => "Scénario",
                Some("Producer") => "Production",
                _ => "Musique",
            }
            .into());
            Some(x)
        })
        .collect();
    let mut seasons: Vec<Season> = Vec::new();
    for e in episodes.and_then(|e| e["Items"].as_array()).into_iter().flatten() {
        let Some(id) = s(&e["Id"]) else { continue };
        let number = e["ParentIndexNumber"].as_u64().unwrap_or(1) as u32;
        let ep = Episode {
            id: format!("{}:{id}", item.id),
            season: number,
            episode: e["IndexNumber"].as_u64().unwrap_or(0) as u32,
            title: s(&e["Name"]).unwrap_or_default(),
            url: stream_url(server, token, &id),
            duration: e["RunTimeTicks"].as_u64().map(|t| (t / 10_000_000) as u32),
            plot: s(&e["Overview"]),
            still: image(server, &id, "Primary", e["ImageTags"]["Primary"].as_str(), 240),
            air_date: s(&e["PremiereDate"]).map(|d| d.chars().take(10).collect()),
        };
        match seasons.iter_mut().find(|x| x.number == number) {
            Some(x) => x.episodes.push(ep),
            None => seasons.push(Season { number, name: s(&e["SeasonName"]).unwrap_or_else(|| format!("Saison {number}")), episodes: vec![ep] }),
        }
    }
    seasons.sort_by_key(|x| x.number);
    VodDetail {
        age: s(&full["OfficialRating"]).and_then(|r| crate::parental::age_from_rating(&r)),
        tagline: full["Taglines"].as_array().and_then(|t| t.first()).and_then(s),
        countries: full["ProductionLocations"].as_array().map(|c| c.iter().filter_map(s).collect()).unwrap_or_default(),
        cast,
        crew,
        seasons,
        item,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_library_and_detail() {
        let list = json!({ "Items": [
            { "Id": "m1", "Type": "Movie", "Name": "Film récent", "ProductionYear": 2024, "ImageTags": { "Primary": "t1" },
              "Genres": ["Drame"], "CommunityRating": 7.6, "ProviderIds": { "Tmdb": "123", "Imdb": "tt9" },
              "People": [ { "Name": "Actrice", "Type": "Actor" }, { "Name": "Réal", "Type": "Director" } ],
              "MediaStreams": [ { "Type": "Audio", "Language": "fre" }, { "Type": "Audio", "Language": "eng" } ],
              "RemoteTrailers": [ { "Url": "https://www.youtube.com/watch?v=abcdefgh&t=1" } ] },
            { "Id": "s1", "Type": "Series", "Name": "Série", "ImageTags": {} },
            { "Id": "x", "Type": "Folder", "Name": "Dossier" }
        ] });
        let items = items(&list, "jf", "nas:8096", "TOK");
        assert_eq!(items.len(), 2);
        let m = &items[0];
        assert_eq!(m.url.as_deref(), Some("http://nas:8096/Videos/m1/stream?static=true&api_key=TOK"));
        assert_eq!(m.poster.as_deref(), Some("http://nas:8096/Items/m1/Images/Primary?maxHeight=450&tag=t1"));
        assert_eq!(m.languages, vec!["fr", "en"]);
        assert_eq!(m.trailer.as_deref(), Some("abcdefgh"));
        assert_eq!(m.tmdb_id, Some(123));
        assert!(items[1].url.is_none(), "une série se lit par ses épisodes");

        let eps = json!({ "Items": [
            { "Id": "e2", "Name": "Deux", "ParentIndexNumber": 1, "IndexNumber": 2, "SeasonName": "Saison 1" },
            { "Id": "e3", "Name": "Trois", "ParentIndexNumber": 2, "IndexNumber": 1 }
        ] });
        let full = json!({ "People": [ { "Id": "p1", "Name": "Actrice", "Type": "Actor", "Role": "Héroïne", "PrimaryImageTag": "pt" } ], "OfficialRating": "FR-12" });
        let d = detail(items[1].clone(), &full, Some(&eps), "nas:8096", "TOK");
        assert_eq!(d.seasons.len(), 2);
        assert_eq!(d.seasons[0].episodes[0].url, "http://nas:8096/Videos/e2/stream?static=true&api_key=TOK");
        assert_eq!(d.cast[0].photo.as_deref(), Some("http://nas:8096/Items/p1/Images/Primary?maxHeight=200&tag=pt"));
        assert_eq!(d.age, Some(12));
        assert!(auth_header("dev", Some("T")).contains(r#"Token="T""#));
    }
}
