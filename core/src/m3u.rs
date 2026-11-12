//! Parser M3U/M3U8 "étendu" (format IPTV : `#EXTINF` avec attributs `tvg-*`).

use crate::model::{Catchup, Channel, Playlist};
use crate::util::stable_key;

/// Analyse les attributs `cle="valeur"` (ou `cle=valeur`) d'une ligne.
/// Retourne les attributs et l'index où commence le titre (après la virgule hors guillemets).
fn parse_attrs(s: &str) -> (Vec<(String, String)>, usize) {
    let b = s.as_bytes();
    let mut attrs = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b',' => return (attrs, i + 1),
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                let ks = i;
                while i < b.len() && b[i] != b'=' && b[i] != b',' && !b[i].is_ascii_whitespace() {
                    i += 1;
                }
                let key = s[ks..i].to_ascii_lowercase();
                if i < b.len() && b[i] == b'=' {
                    i += 1;
                    let val = if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                        let q = b[i];
                        i += 1;
                        let vs = i;
                        while i < b.len() && b[i] != q {
                            i += 1;
                        }
                        let v = &s[vs..i];
                        i = (i + 1).min(b.len());
                        v
                    } else {
                        let vs = i;
                        while i < b.len() && b[i] != b',' && !b[i].is_ascii_whitespace() {
                            i += 1;
                        }
                        &s[vs..i]
                    };
                    attrs.push((key, val.trim().to_string()));
                }
            }
        }
    }
    (attrs, b.len())
}

fn non_empty(v: Option<&String>) -> Option<String> {
    v.map(|s| s.trim()).filter(|s| !s.is_empty()).map(str::to_string)
}

fn get<'a>(attrs: &'a [(String, String)], key: &str) -> Option<&'a String> {
    attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

pub fn parse_m3u(text: &str, source_id: &str) -> Playlist {
    let mut pl = Playlist::default();
    let mut header_catchup: Option<(String, String, u32)> = None; // (type, source, days)

    let mut pending: Option<Channel> = None;
    let mut pending_attrs: Vec<(String, String)> = Vec::new();
    let mut group_override: Option<String> = None;
    let mut ua: Option<String> = None;
    let mut referrer: Option<String> = None;
    let mut vod_entries = Vec::new();

    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTM3U") {
            let (attrs, _) = parse_attrs(rest);
            for key in ["url-tvg", "x-tvg-url", "tvg-url"] {
                if let Some(v) = get(&attrs, key) {
                    pl.epg_urls.extend(v.split(',').map(|u| u.trim().to_string()).filter(|u| !u.is_empty()));
                }
            }
            if let Some(t) = get(&attrs, "catchup") {
                header_catchup = Some((
                    t.clone(),
                    get(&attrs, "catchup-source").cloned().unwrap_or_default(),
                    get(&attrs, "catchup-days").and_then(|d| d.parse().ok()).unwrap_or(7),
                ));
            }
        } else if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let (attrs, title_at) = parse_attrs(rest.trim_start_matches(|c: char| c == '-' || c.is_ascii_digit() || c == '.'));
            let rest_t = rest.trim_start_matches(|c: char| c == '-' || c.is_ascii_digit() || c == '.');
            let title = rest_t.get(title_at..).unwrap_or("").trim().to_string();
            let name = if title.is_empty() { non_empty(get(&attrs, "tvg-name")).unwrap_or_default() } else { title };
            pending = Some(Channel {
                source_id: source_id.to_string(),
                name,
                logo: non_empty(get(&attrs, "tvg-logo")),
                group: non_empty(get(&attrs, "group-title")),
                tvg_id: non_empty(get(&attrs, "tvg-id")),
                tvg_name: non_empty(get(&attrs, "tvg-name")),
                country: non_empty(get(&attrs, "tvg-country")),
                language: non_empty(get(&attrs, "tvg-language")),
                user_agent: non_empty(get(&attrs, "http-user-agent")).or(non_empty(get(&attrs, "user-agent"))),
                referrer: non_empty(get(&attrs, "http-referrer")).or(non_empty(get(&attrs, "referrer"))),
                ..Default::default()
            });
            pending_attrs = attrs;
        } else if let Some(g) = line.strip_prefix("#EXTGRP:") {
            group_override = Some(g.trim().to_string());
        } else if let Some(opt) = line.strip_prefix("#EXTVLCOPT:") {
            if let Some((k, v)) = opt.split_once('=') {
                match k.trim().to_ascii_lowercase().as_str() {
                    "http-user-agent" => ua = Some(v.trim().to_string()),
                    "http-referrer" | "http-referer" => referrer = Some(v.trim().to_string()),
                    _ => {}
                }
            }
        } else if line.starts_with('#') {
            continue;
        } else if let Some(mut ch) = pending.take() {
            // Ligne d'URL : termine l'entrée en cours. Les en-têtes peuvent suivre l'URL après `|`.
            let (url, pipe_headers) = match line.split_once('|') {
                Some((u, h)) => (u.trim(), Some(h)),
                None => (line, None),
            };
            if let Some(h) = pipe_headers {
                for kv in h.split('&') {
                    if let Some((k, v)) = kv.split_once('=') {
                        match k.to_ascii_lowercase().as_str() {
                            "user-agent" => ua = Some(v.to_string()),
                            "referer" | "referrer" => referrer = Some(v.to_string()),
                            _ => {}
                        }
                    }
                }
            }
            ch.url = url.to_string();
            if ch.group.is_none() {
                ch.group = group_override.take();
            }
            ch.user_agent = ch.user_agent.or(ua.take());
            ch.referrer = ch.referrer.or(referrer.take());
            if ch.name.is_empty() {
                ch.name = ch.tvg_id.clone().unwrap_or_else(|| url.to_string());
            }
            ch.adult = crate::parental::is_adult(&ch.name, ch.group.as_deref());
            ch.languages = crate::lang::detect(&ch.name, ch.group.as_deref(), ch.language.as_deref(), ch.country.as_deref());
            ch.catchup = catchup_from_attrs(&pending_attrs, header_catchup.as_ref());
            ch.id = format!("{}:{}", source_id, stable_key(&[ch.tvg_id.as_deref().unwrap_or(""), &ch.name, &ch.url]));
            match crate::vod::classify_m3u(&ch) {
                Some(kind) => vod_entries.push((kind, ch)),
                None => pl.channels.push(ch),
            }
            group_override = None;
            ua = None;
            referrer = None;
        }
    }
    dedupe_ids(&mut pl.channels);
    pl.vod = crate::vod::from_m3u_entries(vod_entries, source_id);
    pl
}

fn catchup_from_attrs(attrs: &[(String, String)], header: Option<&(String, String, u32)>) -> Option<Catchup> {
    let kind = get(attrs, "catchup")
        .or_else(|| get(attrs, "catchup-type"))
        .cloned()
        .or_else(|| header.map(|h| h.0.clone()))?;
    let source = get(attrs, "catchup-source").cloned().or_else(|| header.map(|h| h.1.clone())).unwrap_or_default();
    let days = get(attrs, "catchup-days")
        .or_else(|| get(attrs, "tvg-rec"))
        .and_then(|d| d.parse().ok())
        .or_else(|| header.map(|h| h.2))
        .unwrap_or(7);
    match kind.to_ascii_lowercase().as_str() {
        "flussonic" | "flussonic-hls" | "flussonic-ts" | "fs" => Some(Catchup::Flussonic { days }),
        "append" if !source.is_empty() => Some(Catchup::Template { template: source, append: true, days }),
        "default" | "" if !source.is_empty() => Some(Catchup::Template { template: source, append: false, days }),
        "shift" | "timeshift" => Some(Catchup::Template {
            template: "?utc={utc}&lutc={lutc}".into(),
            append: true,
            days,
        }),
        _ => None,
    }
}

/// Garantit l'unicité des identifiants (doublons exacts dans une playlist).
fn dedupe_ids(channels: &mut [Channel]) {
    let mut seen = std::collections::HashMap::<String, u32>::new();
    for ch in channels.iter_mut() {
        let n = seen.entry(ch.id.clone()).or_insert(0);
        if *n > 0 {
            ch.id = format!("{}~{}", ch.id, n);
        }
        *n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"#EXTM3U url-tvg="https://example.com/guide.xml.gz" catchup="shift" catchup-days="3"
#EXTINF:-1 tvg-id="France24.fr" tvg-name="France 24" tvg-logo="https://l.png" group-title="News;Info",France 24 (1080p)
#EXTVLCOPT:http-user-agent=Mozilla/5.0
https://stream.example.com/f24/index.m3u8
#EXTINF:-1 tvg-id="Arte.fr" catchup="default" catchup-source="https://arc.example.com/arte?start={utc}&end={utcend}",Arte
#EXTGRP:Culture
http://arte.example.com/live.ts|Referer=https://arte.tv
#EXTINF:0,Sans attributs
http://x/y.m3u8
"#;

    #[test]
    fn parses_channels_and_header() {
        let pl = parse_m3u(SAMPLE, "s1");
        assert_eq!(pl.epg_urls, vec!["https://example.com/guide.xml.gz"]);
        assert_eq!(pl.channels.len(), 3);
        let f24 = &pl.channels[0];
        assert_eq!(f24.name, "France 24 (1080p)");
        assert_eq!(f24.tvg_id.as_deref(), Some("France24.fr"));
        assert_eq!(f24.group.as_deref(), Some("News;Info"));
        assert_eq!(f24.user_agent.as_deref(), Some("Mozilla/5.0"));
        assert!(matches!(f24.catchup, Some(Catchup::Template { append: true, days: 3, .. })));
        let arte = &pl.channels[1];
        assert_eq!(arte.group.as_deref(), Some("Culture"));
        assert_eq!(arte.url, "http://arte.example.com/live.ts");
        assert_eq!(arte.referrer.as_deref(), Some("https://arte.tv"));
        assert!(matches!(arte.catchup, Some(Catchup::Template { append: false, .. })));
        assert_eq!(pl.channels[2].name, "Sans attributs");
        assert!(pl.channels.iter().all(|c| c.id.starts_with("s1:")));
    }

    #[test]
    fn ids_are_stable_and_unique() {
        let a = parse_m3u(SAMPLE, "s1");
        let b = parse_m3u(SAMPLE, "s1");
        assert_eq!(a.channels[0].id, b.channels[0].id);
        let dup = format!("{SAMPLE}#EXTINF:0,Sans attributs\nhttp://x/y.m3u8\n");
        let c = parse_m3u(&dup, "s1");
        assert_ne!(c.channels[2].id, c.channels[3].id);
    }
}
