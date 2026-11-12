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
            Some(Channel {
                id: format!("{}:{}", source_id, stable_key(&[&stream_id.to_string()])),
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
}
