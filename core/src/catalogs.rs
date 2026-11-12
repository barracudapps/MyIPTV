//! Catalogues légaux et gratuits intégrés : conversion de leurs réponses en contenus.
//!
//! - Internet Archive : films, télévision classique, musique — uniquement les éléments dont la
//!   licence déclarée est le domaine public ou Creative Commons (les collections contiennent aussi
//!   des dépôts de particuliers sans droits) ;
//! - Radio Browser : annuaire ouvert des flux diffusés par les radios elles-mêmes ;
//! - Apple Podcasts (classement et annuaire) + flux RSS publics des éditeurs ;
//! - LibriVox (via Internet Archive) : livres audio du domaine public.

use quick_xml::events::Event;
use quick_xml::Reader;
use serde_json::Value;

use crate::lang;
use crate::util::stable_key;
use crate::vod::{Episode, VodItem, VodKind, VodRef};

fn s(v: &Value) -> Option<String> {
    match v {
        Value::String(x) if !x.trim().is_empty() => Some(x.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::Array(a) => a.first().and_then(s),
        _ => None,
    }
}

fn list(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(s).collect(),
        Value::String(x) => x.split([';', ',']).map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect(),
        _ => vec![],
    }
}

fn strip_html(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut in_tag = false;
    for c in t.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

// ------------------------------------------------------------------ Internet Archive

pub const ARCHIVE_FIELDS: &[&str] = &["identifier", "title", "year", "language", "subject", "creator", "description", "downloads", "addeddate"];

/// Filtre de licence : domaine public ou Creative Commons déclarés.
pub const ARCHIVE_LICENSED: &str = "(licenseurl:*publicdomain* OR licenseurl:*creativecommons*)";

/// URL de recherche Internet Archive pour une collection (triée par popularité).
pub fn archive_search_url(collection: &str, mediatype: &str, rows: usize) -> String {
    archive_query_url(&format!("collection:{collection} AND mediatype:{mediatype} AND {ARCHIVE_LICENSED}"), rows)
}

pub fn archive_query_url(query: &str, rows: usize) -> String {
    let fl: String = ARCHIVE_FIELDS.iter().map(|f| format!("&fl%5B%5D={f}")).collect();
    format!("https://archive.org/advancedsearch.php?q={}{fl}&sort%5B%5D=downloads+desc&rows={rows}&page=1&output=json", url_escape(query))
}

/// Livres audio LibriVox (hébergés par Internet Archive) dans une langue donnée.
pub fn librivox_archive_url(language: Option<&str>, rows: usize) -> String {
    let lang_q = language
        .and_then(|l| crate::lang::aliases(l))
        .map(|a| format!(" AND language:({})", a.iter().filter(|x| x.is_ascii() && x.len() > 2).map(|x| x.to_string()).collect::<Vec<_>>().join(" OR ")))
        .unwrap_or_default();
    archive_query_url(&format!("collection:librivoxaudio{lang_q} AND {ARCHIVE_LICENSED}"), rows)
}

/// Nom de série d'un épisode : « Série - Titre », « Série : Titre », « Série: S3 E23, Titre ».
fn series_key(raw: &str) -> Option<(String, String)> {
    let p = crate::vod::parse_title(raw);
    if p.episode.is_some() && p.title.len() >= 3 {
        return Some((p.title.trim_end_matches([':', ',', '-', ' ']).trim().trim_matches(['"', '\'']).trim().to_string(), raw.to_string()));
    }
    for sep in [" - ", " : ", ": ", " – "] {
        if let Some((left, right)) = raw.split_once(sep) {
            let left = left.trim().trim_matches(['"', '\'', ' ']);
            if left.chars().count() >= 3 && !right.trim().is_empty() && !left.chars().all(|c| c.is_ascii_digit()) {
                return Some((left.to_string(), right.trim().to_string()));
            }
        }
    }
    None
}

/// Date contenue dans un titre d'épisode (« February 8, 1955 », « 8 février 1955 », « 1955-02-08 »).
fn title_date(title: &str) -> Option<(u16, u8, u8)> {
    const MONTHS: &[&[&str]] = &[
        &["january", "jan", "janvier"], &["february", "feb", "février", "fevrier"], &["march", "mar", "mars"], &["april", "apr", "avril"],
        &["may", "mai"], &["june", "jun", "juin"], &["july", "jul", "juillet"], &["august", "aug", "août", "aout"],
        &["september", "sep", "sept", "septembre"], &["october", "oct", "octobre"], &["november", "nov", "novembre"], &["december", "dec", "décembre", "decembre"],
    ];
    let lower = title.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric() && c != 'é' && c != 'û').filter(|w| !w.is_empty()).collect();
    let year = words.iter().filter_map(|w| w.parse::<u16>().ok()).find(|y| (1900..=2100).contains(y))?;
    let month = words.iter().find_map(|w| MONTHS.iter().position(|m| m.contains(w)))? as u8 + 1;
    let day = words.iter().filter_map(|w| w.parse::<u8>().ok()).find(|d| (1..=31).contains(d)).unwrap_or(1);
    Some((year, month, day))
}

/// Regroupe en séries les épisodes publiés séparément (au moins deux par série).
/// Les épisodes pointent vers `archive:<identifiant>`, résolu au moment de la lecture.
pub fn group_series(items: Vec<VodItem>, source_id: &str) -> Vec<VodItem> {
    use std::collections::HashMap;
    let mut keyed: HashMap<String, Vec<(String, VodItem)>> = HashMap::new();
    let mut rest = Vec::new();
    for it in items {
        match series_key(&it.raw_name) {
            Some((k, ep_title)) => keyed.entry(crate::vod::fold(&k)).or_default().push((ep_title, VodItem { title: k, ..it })),
            None => rest.push(it),
        }
    }
    for (key, mut eps) in keyed {
        if eps.len() < 2 {
            rest.extend(eps.into_iter().map(|(_, i)| VodItem { title: i.raw_name.clone(), ..i }));
            continue;
        }
        // Épisodes datés (« February 8, 1955 ») : ordre chronologique ; sinon ordre du titre.
        if eps.iter().all(|(t, _)| title_date(t).is_some()) {
            eps.sort_by_key(|(t, _)| title_date(t));
        } else {
            eps.sort_by(|a, b| a.0.cmp(&b.0));
        }
        let first = &eps[0].1;
        let mut series = VodItem {
            id: format!("{source_id}:serie:{}", stable_key(&[&key])),
            source_id: source_id.into(),
            kind: Some(VodKind::Series),
            title: first.title.clone(),
            raw_name: first.title.clone(),
            year: eps.iter().filter_map(|(_, i)| i.year).min(),
            poster: first.poster.clone(),
            genres: first.genres.clone(),
            languages: first.languages.clone(),
            plot: eps.iter().find_map(|(_, i)| i.plot.clone()),
            directors: first.directors.clone(),
            added: eps.iter().filter_map(|(_, i)| i.added).max(),
            ..Default::default()
        };
        let mut n = 0;
        for (ep_title, it) in eps {
            let VodRef::Archive { identifier } = &it.source_ref else { continue };
            let p = crate::vod::parse_title(&it.raw_name);
            n += 1;
            series.episodes.push(Episode {
                id: format!("{}:{identifier}", series.id),
                season: p.season.unwrap_or(1),
                episode: p.episode.unwrap_or(n),
                title: ep_title,
                url: format!("archive:{identifier}"),
                plot: it.plot.clone(),
                still: it.poster.clone(),
                ..Default::default()
            });
        }
        series.episodes.sort_by_key(|e| (e.season, e.episode));
        rest.push(series);
    }
    rest
}

pub fn archive_items(json: &Value, kind: VodKind, source_id: &str) -> Vec<VodItem> {
    let Some(docs) = json.pointer("/response/docs").and_then(Value::as_array) else { return vec![] };
    docs.iter()
        .filter_map(|d| {
            let id = s(&d["identifier"])?;
            let raw = s(&d["title"]).unwrap_or_else(|| id.clone());
            let parsed = crate::vod::parse_title(&raw);
            let year = s(&d["year"]).and_then(|y| y.get(..4)?.parse().ok()).or(parsed.year);
            let languages: Vec<String> = list(&d["language"]).iter().filter_map(|l| lang::code_from_alias(l)).map(str::to_string).collect();
            let creators = list(&d["creator"]);
            let subjects = list(&d["subject"]);
            let adult = crate::parental::is_adult_media(&raw, &subjects);
            Some(VodItem {
                id: format!("{source_id}:{}", stable_key(&[&id])),
                source_id: source_id.into(),
                kind: Some(kind),
                title: parsed.title,
                raw_name: raw,
                year,
                poster: Some(format!("https://archive.org/services/img/{id}")),
                genres: subjects.into_iter().take(5).collect(),
                adult,
                languages,
                plot: s(&d["description"]).map(|t| strip_html(&t)),
                directors: if matches!(kind, VodKind::Movie | VodKind::Show | VodKind::Audiobook) { creators.clone() } else { vec![] },
                cast: if kind == VodKind::Music { creators } else { vec![] },
                added: s(&d["addeddate"]).and_then(|t| chrono::DateTime::parse_from_rfc3339(&t).ok()).map(|t| t.timestamp()),
                source_ref: VodRef::Archive { identifier: id },
                ..Default::default()
            })
        })
        .collect()
}

/// Fichiers lisibles d'un élément Internet Archive (`/metadata/<id>`).
/// Vidéo : la meilleure version web ; audio : une piste par fichier, dans l'ordre.
pub fn archive_files(meta: &Value, video: bool) -> Vec<Episode> {
    let id = meta.pointer("/metadata/identifier").and_then(s).unwrap_or_default();
    let Some(files) = meta["files"].as_array() else { return vec![] };
    let url = |name: &str| format!("https://archive.org/download/{id}/{}", name.split('/').map(|p| url_escape(p)).collect::<Vec<_>>().join("/"));
    if video {
        let rank = |f: &Value| -> Option<u8> {
            let name = s(&f["name"])?.to_lowercase();
            let fmt = s(&f["format"]).unwrap_or_default().to_lowercase();
            // Versions dérivées H.264 d'abord : lisibles partout. L'original en .mp4 peut être
            // en MPEG-4 Part 2 ou HEVC, que les navigateurs et les TV refusent.
            if fmt.contains("h.264") {
                Some(4)
            } else if fmt.contains("512kb") {
                Some(3)
            } else if name.ends_with(".mp4") || name.ends_with(".m4v") {
                Some(2)
            } else if name.ends_with(".webm") {
                Some(1)
            } else if name.ends_with(".ogv") {
                Some(0)
            } else {
                None
            }
        };
        files
            .iter()
            .filter_map(|f| Some((rank(f)?, f)))
            .max_by_key(|(r, _)| *r)
            .map(|(_, f)| {
                let name = s(&f["name"]).unwrap_or_default();
                vec![Episode { id: format!("{id}/{name}"), season: 1, episode: 1, title: s(&f["title"]).unwrap_or(name.clone()), url: url(&name), duration: s(&f["length"]).and_then(parse_len), ..Default::default() }]
            })
            .unwrap_or_default()
    } else {
        let mut tracks: Vec<&Value> = files
            .iter()
            .filter(|f| {
                let n = s(&f["name"]).unwrap_or_default().to_lowercase();
                (n.ends_with(".mp3") || n.ends_with(".ogg")) && s(&f["source"]).as_deref() != Some("metadata")
            })
            .collect();
        // Une seule version par piste (le MP3 VBR est préféré aux variantes 64 kb).
        tracks.sort_by_key(|f| s(&f["name"]).unwrap_or_default());
        let mut seen = std::collections::HashSet::new();
        tracks
            .into_iter()
            .filter(|f| {
                let n = s(&f["name"]).unwrap_or_default();
                let stem = n.trim_end_matches(".mp3").trim_end_matches(".ogg").trim_end_matches("_64kb").to_string();
                seen.insert(stem)
            })
            .enumerate()
            .map(|(i, f)| {
                let name = s(&f["name"]).unwrap_or_default();
                Episode {
                    id: format!("{id}/{name}"),
                    season: 1,
                    episode: i as u32 + 1,
                    title: s(&f["title"]).unwrap_or_else(|| name.rsplit('/').next().unwrap_or(&name).to_string()),
                    url: url(&name),
                    duration: s(&f["length"]).and_then(parse_len),
                    ..Default::default()
                }
            })
            .collect()
    }
}

fn url_escape(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// « 1234.5 » ou « 20:33 » ou « 1:02:03 » -> secondes.
fn parse_len(t: String) -> Option<u32> {
    if let Ok(f) = t.parse::<f64>() {
        return Some(f as u32);
    }
    let parts: Vec<u32> = t.split(':').filter_map(|p| p.parse().ok()).collect();
    match parts.as_slice() {
        [m, s] => Some(m * 60 + s),
        [h, m, s] => Some(h * 3600 + m * 60 + s),
        _ => None,
    }
}

// ------------------------------------------------------------------ Radio Browser

pub fn radio_search_url(countrycode: Option<&str>, limit: usize) -> String {
    let mut u = format!("https://all.api.radio-browser.info/json/stations/search?order=clickcount&reverse=true&hidebroken=true&limit={limit}");
    if let Some(c) = countrycode {
        u.push_str(&format!("&countrycode={}", c.to_uppercase()));
    }
    u
}

pub fn radio_items(json: &Value, source_id: &str) -> Vec<VodItem> {
    let Some(arr) = json.as_array() else { return vec![] };
    arr.iter()
        .filter_map(|r| {
            let uuid = s(&r["stationuuid"])?;
            let url = s(&r["url_resolved"]).or_else(|| s(&r["url"]))?;
            let mut languages: Vec<String> = list(&r["languagecodes"]).into_iter().filter_map(|l| lang::code_from_alias(&l).map(str::to_string)).collect();
            if languages.is_empty() {
                languages = s(&r["countrycode"]).and_then(|c| lang::lang_from_country(&c)).map(|l| vec![l.to_string()]).unwrap_or_default();
            }
            Some(VodItem {
                id: format!("{source_id}:{}", stable_key(&[&uuid])),
                source_id: source_id.into(),
                kind: Some(VodKind::Radio),
                title: s(&r["name"])?.trim().to_string(),
                raw_name: s(&r["name"])?,
                url: Some(url),
                poster: s(&r["favicon"]),
                category: s(&r["country"]),
                genres: list(&r["tags"]).into_iter().take(4).collect(),
                countries: s(&r["countrycode"]).map(|c| vec![c.to_uppercase()]).unwrap_or_default(),
                languages,
                live: true,
                ..Default::default()
            })
        })
        .collect()
}

// ------------------------------------------------------------------ Podcasts

pub fn podcast_chart_url(country: &str, limit: usize) -> String {
    format!("https://itunes.apple.com/{}/rss/toppodcasts/limit={limit}/json", country.to_lowercase())
}

/// Identifiants du classement (ancien format JSON d'Apple).
pub fn podcast_chart_ids(json: &Value) -> Vec<String> {
    json.pointer("/feed/entry").and_then(Value::as_array).map(|e| e.iter().filter_map(|x| x.pointer("/id/attributes/im:id").and_then(s)).collect()).unwrap_or_default()
}

pub fn podcast_lookup_url(ids: &[String], country: &str) -> String {
    format!("https://itunes.apple.com/lookup?id={}&country={}", ids.join(","), country)
}

pub fn podcast_search_url(term: &str, country: &str, limit: usize) -> String {
    let t: String = url_escape(term);
    format!("https://itunes.apple.com/search?media=podcast&term={t}&country={country}&limit={limit}")
}

/// Résultats de l'annuaire (lookup ou search) -> podcasts, langue déduite du pays du classement.
pub fn podcast_items(json: &Value, source_id: &str, language: Option<&str>) -> Vec<VodItem> {
    let Some(arr) = json["results"].as_array() else { return vec![] };
    arr.iter()
        .filter_map(|p| {
            let feed = s(&p["feedUrl"])?;
            let id = s(&p["collectionId"]).unwrap_or_else(|| feed.clone());
            Some(VodItem {
                id: format!("{source_id}:{}", stable_key(&[&id])),
                source_id: source_id.into(),
                kind: Some(VodKind::Podcast),
                title: s(&p["collectionName"])?,
                raw_name: s(&p["collectionName"])?,
                poster: s(&p["artworkUrl600"]).or_else(|| s(&p["artworkUrl100"])),
                category: s(&p["primaryGenreName"]),
                genres: list(&p["genres"]).into_iter().filter(|g| g != "Podcasts").collect(),
                languages: language.map(|l| vec![l.to_string()]).unwrap_or_default(),
                directors: s(&p["artistName"]).into_iter().collect(),
                added: s(&p["releaseDate"]).and_then(|t| chrono::DateTime::parse_from_rfc3339(&t).ok()).map(|t| t.timestamp()),
                url: Some(feed),
                ..Default::default()
            })
        })
        .collect()
}

/// Épisodes d'un flux RSS de podcast (balises `item` / `enclosure`), du plus récent au plus ancien.
pub fn rss_episodes(xml: &[u8], item_id: &str) -> (Vec<Episode>, Option<String>) {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut eps = Vec::new();
    let mut cur: Option<Episode> = None;
    let mut field: Option<&'static str> = None;
    let mut text = String::new();
    let mut channel_desc: Option<String> = None;
    let mut in_item = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Err(_) | Ok(Event::Eof) => break,
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = e.name().as_ref().to_vec();
                match name.as_slice() {
                    b"item" => {
                        in_item = true;
                        cur = Some(Episode::default());
                    }
                    b"enclosure" if in_item => {
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"url" {
                                if let (Some(c), Ok(v)) = (cur.as_mut(), a.unescape_value()) {
                                    c.url = v.into_owned();
                                }
                            }
                        }
                    }
                    b"itunes:image" if in_item => {
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"href" {
                                if let (Some(c), Ok(v)) = (cur.as_mut(), a.unescape_value()) {
                                    c.still = Some(v.into_owned());
                                }
                            }
                        }
                    }
                    b"title" if in_item => field = Some("title"),
                    b"description" | b"itunes:summary" => field = Some("desc"),
                    b"pubDate" if in_item => field = Some("date"),
                    b"itunes:duration" if in_item => field = Some("duration"),
                    _ => {}
                }
                text.clear();
            }
            Ok(Event::Text(t)) if field.is_some() => text.push_str(&t.unescape().unwrap_or_default()),
            Ok(Event::CData(t)) if field.is_some() => text.push_str(&String::from_utf8_lossy(&t)),
            Ok(Event::End(e)) => {
                if let Some(f) = field.take() {
                    let v = std::mem::take(&mut text).trim().to_string();
                    match (f, cur.as_mut()) {
                        ("title", Some(c)) => c.title = v,
                        ("desc", Some(c)) if c.plot.is_none() => c.plot = Some(strip_html(&v).chars().take(600).collect()),
                        ("desc", None) if channel_desc.is_none() => channel_desc = Some(strip_html(&v)),
                        ("date", Some(c)) => c.air_date = Some(v),
                        ("duration", Some(c)) => c.duration = parse_len(v),
                        _ => {}
                    }
                }
                if e.name().as_ref() == b"item" {
                    in_item = false;
                    if let Some(mut c) = cur.take() {
                        if !c.url.is_empty() {
                            c.id = format!("{item_id}:{}", stable_key(&[&c.url]));
                            eps.push(c);
                        }
                    }
                }
            }
            _ => {}
        }
        buf.clear();
    }
    let n = eps.len() as u32;
    for (i, e) in eps.iter_mut().enumerate() {
        e.season = 1;
        e.episode = n - i as u32;
    }
    (eps, channel_desc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_archive_and_picks_playable_file() {
        let search = json!({"response":{"docs":[{"identifier":"nosferatu","title":"Nosferatu (1922)","language":"eng","subject":["Horror","Silent"],"creator":"F. W. Murnau"}]}});
        let items = archive_items(&search, VodKind::Movie, "ia");
        assert_eq!(items[0].title, "Nosferatu");
        assert_eq!(items[0].year, Some(1922));
        assert_eq!(items[0].languages, vec!["en"]);
        assert_eq!(items[0].directors, vec!["F. W. Murnau"]);
        let meta = json!({"metadata":{"identifier":"nosferatu"},"files":[
            {"name":"nosferatu.ogv","format":"Ogg Video"},
            {"name":"nosferatu_512kb.mp4","format":"512Kb MPEG4"},
            {"name":"nosferatu.mp4","format":"h.264","length":"5640.2"}]});
        let f = archive_files(&meta, true);
        assert_eq!(f[0].url, "https://archive.org/download/nosferatu/nosferatu.mp4");
        assert_eq!(f[0].duration, Some(5640));
    }

    #[test]
    fn groups_archive_episodes_into_series() {
        let mk = |id: &str, title: &str| VodItem { id: id.into(), title: title.into(), raw_name: title.into(), kind: Some(VodKind::Show), source_ref: VodRef::Archive { identifier: id.into() }, ..Default::default() };
        let items = vec![
            mk("a", "Sherlock Holmes - The Case of Lady Beryl"),
            mk("b", "Sherlock Holmes - The Case of the Shy Ballerina"),
            mk("c", "The Andy Griffith Show: S3 E23, Andy Discovers America"),
            mk("d", "The Andy Griffith Show: S1 E2, Manhunt"),
            mk("e", "Lucy meets John Wayne"),
            mk("f", "Tales: one-off"),
            mk("g", "''Burns and Allen'' - Episode A"),
            mk("h", "''Burns and Allen'' - Episode B"),
        ];
        let out = group_series(items, "ia");
        let series: Vec<_> = out.iter().filter(|i| i.kind == Some(VodKind::Series)).collect();
        assert_eq!(series.len(), 3);
        assert!(series.iter().any(|s| s.title == "Burns and Allen"));
        let andy = series.iter().find(|s| s.title == "The Andy Griffith Show").unwrap();
        assert_eq!(andy.episodes.iter().map(|e| (e.season, e.episode)).collect::<Vec<_>>(), vec![(1, 2), (3, 23)]);
        assert_eq!(andy.episodes[0].url, "archive:d");
        assert!(out.iter().any(|i| i.title == "Lucy meets John Wayne" && i.kind == Some(VodKind::Show)));
        assert!(out.iter().any(|i| i.title == "Tales: one-off"), "une seule occurrence : reste une émission");
        assert!(archive_search_url("classic_tv", "movies", 10).contains("licenseurl"));
        let dated = group_series(vec![mk("x", "Love of Life - February 8, 1955"), mk("y", "Love of Life - March 20, 1953")], "ia");
        assert_eq!(dated[0].episodes.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), vec!["March 20, 1953", "February 8, 1955"]);
        assert_eq!(title_date("8 février 1955"), Some((1955, 2, 8)));
    }

    #[test]
    fn converts_radio_and_podcasts() {
        let r = json!([{"stationuuid":"u1","name":"Radio Test","url_resolved":"https://r/stream","countrycode":"FR","tags":"news,talk"}]);
        let items = radio_items(&r, "rb");
        assert!(items[0].live);
        assert_eq!(items[0].languages, vec!["fr"]);
        let chart = json!({"feed":{"entry":[{"id":{"attributes":{"im:id":"42"}}}]}});
        assert_eq!(podcast_chart_ids(&chart), vec!["42"]);
        let rss = br#"<rss><channel><title>P</title><description>Un podcast</description>
          <item><title>Ep 2</title><enclosure url="https://a/2.mp3"/><itunes:duration>01:02:03</itunes:duration></item>
          <item><title><![CDATA[Ep 1]]></title><description>&lt;p&gt;Intro&lt;/p&gt;</description><enclosure url="https://a/1.mp3"/></item>
        </channel></rss>"#;
        let (eps, desc) = rss_episodes(rss, "p");
        assert_eq!(eps.len(), 2);
        assert_eq!((eps[0].title.as_str(), eps[0].episode, eps[0].duration), ("Ep 2", 2, Some(3723)));
        assert_eq!(eps[1].plot.as_deref(), Some("Intro"));
        assert_eq!(desc.as_deref(), Some("Un podcast"));
    }
}
