//! Client "Xtream Codes" sans réseau : construction des URL et conversion des réponses JSON.
//! Le transport HTTP est fourni par la plateforme (reqwest en natif, fetch en web/TV).

use serde_json::Value;

use crate::model::{Catchup, Channel};
use crate::util::stable_key;

pub struct XtreamAccount<'a> {
    pub server: &'a str,
    pub username: &'a str,
    pub password: &'a str,
    /// `ts` (défaut) ou `m3u8`.
    pub output: &'a str,
}

fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

impl<'a> XtreamAccount<'a> {
    pub fn base(&self) -> String {
        let s = self.server.trim().trim_end_matches('/');
        if s.starts_with("http://") || s.starts_with("https://") { s.to_string() } else { format!("http://{s}") }
    }

    pub fn api_url(&self, action: Option<&str>) -> String {
        let mut u = format!("{}/player_api.php?username={}&password={}", self.base(), enc(self.username), enc(self.password));
        if let Some(a) = action {
            u.push_str("&action=");
            u.push_str(a);
        }
        u
    }

    pub fn xmltv_url(&self) -> String {
        format!("{}/xmltv.php?username={}&password={}", self.base(), enc(self.username), enc(self.password))
    }

    pub fn live_url(&self, stream_id: u64) -> String {
        let ext = if self.output == "m3u8" { "m3u8" } else { "ts" };
        format!("{}/live/{}/{}/{}.{}", self.base(), enc(self.username), enc(self.password), stream_id, ext)
    }
}

/// Les panneaux Xtream renvoient nombres et chaînes de façon incohérente.
fn as_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.trim().parse().ok(),
        Value::Bool(b) => Some(*b as u64),
        _ => None,
    }
}

fn as_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Convertit `get_live_categories` + `get_live_streams` en chaînes.
pub fn live_channels(acc: &XtreamAccount, source_id: &str, categories: &Value, streams: &Value) -> Vec<Channel> {
    let cat_name = |id: &str| -> Option<String> {
        categories.as_array()?.iter().find(|c| c.get("category_id").and_then(as_str).as_deref() == Some(id))?.get("category_name").and_then(as_str)
    };
    let Some(arr) = streams.as_array() else { return vec![] };
    arr.iter()
        .filter_map(|s| {
            let stream_id = s.get("stream_id").and_then(as_u64)?;
            let name = s.get("name").and_then(as_str).unwrap_or_else(|| format!("Flux {stream_id}"));
            let archive = s.get("tv_archive").and_then(as_u64).unwrap_or(0) == 1;
            let group = s.get("category_id").and_then(as_str).and_then(|c| cat_name(&c));
            let flagged = s.get("is_adult").and_then(as_u64).unwrap_or(0) == 1;
            let adult = flagged || crate::parental::is_adult(&name, group.as_deref());
            let days = s.get("tv_archive_duration").and_then(as_u64).unwrap_or(0) as u32;
            let languages = crate::lang::detect(&name, group.as_deref(), None, None);
            let countries = crate::lang::detect_countries(&name, group.as_deref(), None, None);
            Some(Channel {
                countries,
                id: format!("{}:{}", source_id, stable_key(&[&stream_id.to_string()])),
                languages,
                source_id: source_id.to_string(),
                url: acc.live_url(stream_id),
                logo: s.get("stream_icon").and_then(as_str),
                group,
                adult,
                tvg_id: s.get("epg_channel_id").and_then(as_str),
                catchup: archive.then(|| Catchup::Xtream {
                    server: acc.base(),
                    username: acc.username.to_string(),
                    password: acc.password.to_string(),
                    stream_id,
                    days: days.max(1),
                }),
                name,
                ..Default::default()
            })
        })
        .collect()
}

// ------------------------------------------------------------------ Films et séries

use crate::vod::{Episode, Person, Season, VodDetail, VodItem, VodKind, VodRef};

fn names(v: Option<&Value>) -> Vec<String> {
    v.and_then(as_str).map(|s| s.split([',', '/']).map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()).unwrap_or_default()
}

fn rating10(v: &Value) -> Option<f32> {
    v.get("rating").and_then(as_str).and_then(|r| r.parse::<f32>().ok()).filter(|r| *r > 0.0).map(|r| if r > 10.0 { r / 10.0 } else { r })
}

fn year_of(v: &Value) -> Option<u16> {
    ["year", "releaseDate", "releasedate", "release_date"].iter().find_map(|k| v.get(*k).and_then(as_str)).and_then(|d| d.get(..4)?.parse().ok())
}

fn trailer(v: &Value) -> Option<String> {
    v.get("youtube_trailer").and_then(as_str).map(|t| t.rsplit(['=', '/']).next().unwrap_or(&t).to_string()).filter(|t| t.len() >= 6)
}

impl<'a> XtreamAccount<'a> {
    pub fn movie_url(&self, id: u64, ext: &str) -> String {
        format!("{}/movie/{}/{}/{}.{}", self.base(), enc(self.username), enc(self.password), id, ext)
    }
    pub fn episode_url(&self, id: &str, ext: &str) -> String {
        format!("{}/series/{}/{}/{}.{}", self.base(), enc(self.username), enc(self.password), id, ext)
    }
    fn vod_ref(&self, id: u64, container: Option<String>) -> VodRef {
        VodRef::Xtream { server: self.base(), username: self.username.into(), password: self.password.into(), id, container }
    }
}

fn category_lookup(categories: &Value) -> std::collections::HashMap<String, String> {
    categories
        .as_array()
        .map(|a| a.iter().filter_map(|c| Some((c.get("category_id").and_then(as_str)?, c.get("category_name").and_then(as_str)?))).collect())
        .unwrap_or_default()
}

/// `get_vod_categories` + `get_vod_streams` -> films.
pub fn vod_items(acc: &XtreamAccount, source_id: &str, categories: &Value, streams: &Value) -> Vec<VodItem> {
    let cats = category_lookup(categories);
    streams
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let id = v.get("stream_id").and_then(as_u64)?;
                    let raw = v.get("name").and_then(as_str)?;
                    let ext = v.get("container_extension").and_then(as_str).unwrap_or_else(|| "mp4".into());
                    let category = v.get("category_id").and_then(as_str).and_then(|c| cats.get(&c).cloned());
                    let parsed = crate::vod::parse_title(&raw);
                    Some(VodItem {
                        id: format!("{source_id}:m{id}"),
                        source_id: source_id.into(),
                        kind: Some(VodKind::Movie),
                        languages: crate::lang::detect(&raw, category.as_deref(), None, None),
                        adult: v.get("is_adult").and_then(as_u64) == Some(1) || crate::parental::is_adult(&raw, category.as_deref()),
                        title: parsed.title,
                        year: year_of(v).or(parsed.year),
                        raw_name: raw,
                        url: Some(acc.movie_url(id, &ext)),
                        poster: v.get("stream_icon").and_then(as_str),
                        category,
                        genres: names(v.get("genre")),
                        rating: rating10(v),
                        plot: v.get("plot").and_then(as_str),
                        cast: names(v.get("cast")),
                        directors: names(v.get("director")),
                        added: v.get("added").and_then(as_u64).map(|t| t as i64),
                        tmdb_id: v.get("tmdb").or_else(|| v.get("tmdb_id")).and_then(as_u64).filter(|t| *t > 0),
                        trailer: trailer(v),
                        source_ref: acc.vod_ref(id, Some(ext)),
                        ..Default::default()
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `get_series_categories` + `get_series` -> séries (épisodes chargés à la demande).
pub fn series_items(acc: &XtreamAccount, source_id: &str, categories: &Value, series: &Value) -> Vec<VodItem> {
    let cats = category_lookup(categories);
    series
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let id = v.get("series_id").and_then(as_u64)?;
                    let raw = v.get("name").and_then(as_str)?;
                    let category = v.get("category_id").and_then(as_str).and_then(|c| cats.get(&c).cloned());
                    let parsed = crate::vod::parse_title(&raw);
                    Some(VodItem {
                        id: format!("{source_id}:s{id}"),
                        source_id: source_id.into(),
                        kind: Some(VodKind::Series),
                        languages: crate::lang::detect(&raw, category.as_deref(), None, None),
                        adult: crate::parental::is_adult(&raw, category.as_deref()),
                        title: parsed.title,
                        year: year_of(v).or(parsed.year),
                        raw_name: raw,
                        poster: v.get("cover").and_then(as_str),
                        backdrop: v.get("backdrop_path").and_then(|b| b.as_array().and_then(|a| a.first()).or(Some(b))).and_then(as_str),
                        category,
                        genres: names(v.get("genre")),
                        rating: rating10(v),
                        plot: v.get("plot").and_then(as_str),
                        cast: names(v.get("cast")),
                        directors: names(v.get("director")),
                        added: v.get("last_modified").and_then(as_u64).map(|t| t as i64),
                        tmdb_id: v.get("tmdb").and_then(as_u64).filter(|t| *t > 0),
                        trailer: trailer(v),
                        source_ref: acc.vod_ref(id, None),
                        ..Default::default()
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn enrich_from_info(item: &mut VodItem, info: &Value) {
    let set = |dst: &mut Option<String>, key: &str| {
        if let Some(v) = info.get(key).and_then(as_str) {
            *dst = Some(v);
        }
    };
    set(&mut item.plot, "plot");
    if item.plot.is_none() {
        set(&mut item.plot, "description");
    }
    let mut poster = None;
    set(&mut poster, "cover_big");
    if poster.is_none() {
        set(&mut poster, "movie_image");
    }
    if poster.is_some() {
        item.poster = poster;
    }
    if let Some(b) = info.get("backdrop_path").and_then(|b| b.as_array().and_then(|a| a.first()).or(Some(b))).and_then(as_str) {
        item.backdrop = Some(b);
    }
    for (dst, key) in [(&mut item.cast, "cast"), (&mut item.directors, "director"), (&mut item.genres, "genre")] {
        let v = names(info.get(key));
        if !v.is_empty() {
            *dst = v;
        }
    }
    if item.cast.is_empty() {
        item.cast = names(info.get("actors"));
    }
    item.year = item.year.or_else(|| year_of(info));
    item.rating = rating10(info).or(item.rating);
    item.trailer = trailer(info).or(item.trailer.take());
    item.tmdb_id = info.get("tmdb_id").and_then(as_u64).filter(|t| *t > 0).or(item.tmdb_id);
    item.duration = info.get("duration_secs").and_then(as_u64).map(|d| d as u32).or(item.duration);
}

fn people(names: &[String], role: Option<&str>) -> Vec<Person> {
    names.iter().map(|n| Person { name: n.clone(), role: role.map(str::to_string), ..Default::default() }).collect()
}

/// `get_vod_info` -> fiche film.
pub fn movie_detail(mut item: VodItem, resp: &Value) -> VodDetail {
    let info = resp.get("info").cloned().unwrap_or_default();
    enrich_from_info(&mut item, &info);
    let age = info.get("age").and_then(as_str).and_then(|a| crate::parental::age_from_rating(&a));
    VodDetail {
        cast: people(&item.cast, None),
        crew: people(&item.directors, Some("Réalisation")),
        countries: names(info.get("country")),
        age,
        item,
        ..Default::default()
    }
}

/// `get_series_info` -> fiche série avec saisons et épisodes.
pub fn series_detail(acc: &XtreamAccount, mut item: VodItem, resp: &Value) -> VodDetail {
    let info = resp.get("info").cloned().unwrap_or_default();
    enrich_from_info(&mut item, &info);
    let names_of: std::collections::HashMap<u32, String> = resp
        .get("seasons")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|s| Some((s.get("season_number").and_then(as_u64)? as u32, s.get("name").and_then(as_str)?))).collect())
        .unwrap_or_default();
    let mut seasons: Vec<Season> = resp
        .get("episodes")
        .and_then(Value::as_object)
        .map(|o| {
            o.iter()
                .map(|(num, eps)| {
                    let number: u32 = num.parse().unwrap_or(0);
                    let episodes = eps
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|e| {
                                    let id = e.get("id").and_then(as_str)?;
                                    let ext = e.get("container_extension").and_then(as_str).unwrap_or_else(|| "mp4".into());
                                    let ei = e.get("info").cloned().unwrap_or_default();
                                    Some(Episode {
                                        id: format!("{}:{id}", item.id),
                                        season: number,
                                        episode: e.get("episode_num").and_then(as_u64).unwrap_or(0) as u32,
                                        title: e.get("title").and_then(as_str).unwrap_or_default(),
                                        url: acc.episode_url(&id, &ext),
                                        duration: ei.get("duration_secs").and_then(as_u64).map(|d| d as u32),
                                        plot: ei.get("plot").and_then(as_str),
                                        still: ei.get("movie_image").and_then(as_str),
                                        air_date: ei.get("releasedate").and_then(as_str),
                                    })
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    Season { number, name: names_of.get(&number).cloned().unwrap_or_else(|| format!("Saison {number}")), episodes }
                })
                .collect()
        })
        .unwrap_or_default();
    seasons.sort_by_key(|s| s.number);
    for s in &mut seasons {
        s.episodes.sort_by_key(|e| e.episode);
    }
    VodDetail { cast: people(&item.cast, None), crew: people(&item.directors, Some("Réalisation")), seasons, item, ..Default::default() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_urls_and_channels() {
        let acc = XtreamAccount { server: "example.com:8080/", username: "u s", password: "p&w", output: "ts" };
        assert_eq!(acc.api_url(Some("get_live_streams")), "http://example.com:8080/player_api.php?username=u%20s&password=p%26w&action=get_live_streams");
        let cats = json!([{ "category_id": "3", "category_name": "Infos" }]);
        let streams = json!([
            { "stream_id": 42, "name": "Info 1", "category_id": "3", "epg_channel_id": "info1.fr", "tv_archive": "1", "tv_archive_duration": "5" },
            { "stream_id": "43", "name": "Sans archive", "tv_archive": 0 },
            { "name": "invalide" }
        ]);
        let ch = live_channels(&acc, "x", &cats, &streams);
        assert_eq!(ch.len(), 2);
        assert_eq!(ch[0].group.as_deref(), Some("Infos"));
        assert_eq!(ch[0].url, "http://example.com:8080/live/u%20s/p%26w/42.ts");
        assert!(matches!(ch[0].catchup, Some(Catchup::Xtream { stream_id: 42, days: 5, .. })));
        assert!(ch[1].catchup.is_none());
    }

    #[test]
    fn converts_vod_and_series_detail() {
        let acc = XtreamAccount { server: "h", username: "u", password: "p", output: "ts" };
        let cats = json!([{ "category_id": "9", "category_name": "FR | Action" }]);
        let vod = json!([{ "stream_id": 5, "name": "FR| Le Film (2021)", "category_id": "9", "container_extension": "mkv", "rating": "7.4", "added": "1700000000" }]);
        let m = vod_items(&acc, "x", &cats, &vod);
        assert_eq!(m[0].title, "Le Film");
        assert_eq!(m[0].year, Some(2021));
        assert_eq!(m[0].url.as_deref(), Some("http://h/movie/u/p/5.mkv"));
        assert_eq!(m[0].languages, vec!["fr"]);
        let info = json!({ "info": { "cast": "A, B", "director": "C", "youtube_trailer": "https://youtu.be/abcdefgh", "age": "-12" } });
        let d = movie_detail(m[0].clone(), &info);
        assert_eq!(d.cast.len(), 2);
        assert_eq!(d.item.trailer.as_deref(), Some("abcdefgh"));
        assert_eq!(d.age, Some(12));
        let s = series_items(&acc, "x", &cats, &json!([{ "series_id": 8, "name": "Show", "cast": "D" }]));
        let resp = json!({ "seasons": [{ "season_number": 1, "name": "Saison 1" }], "episodes": { "1": [
            { "id": "102", "episode_num": 2, "title": "Deux", "container_extension": "mp4" },
            { "id": "101", "episode_num": "1", "title": "Un", "container_extension": "mp4", "info": { "duration_secs": 1500 } }
        ] } });
        let sd = series_detail(&acc, s[0].clone(), &resp);
        assert_eq!(sd.seasons[0].episodes[0].title, "Un");
        assert_eq!(sd.seasons[0].episodes[0].url, "http://h/series/u/p/101.mp4");
        assert_eq!(sd.seasons[0].episodes[0].duration, Some(1500));
    }
}
