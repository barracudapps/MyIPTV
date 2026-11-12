//! Construction des URL de replay (catch-up) selon les conventions courantes
//! (Kodi pvr.iptvsimple, Xtream Codes, Flussonic).

use chrono::{DateTime, Utc};

use crate::model::{Catchup, Channel};

fn fmt_time(ts: i64, f: &str) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0).map(|d| d.format(f).to_string()).unwrap_or_default()
}

/// Remplace `{nom}`, `{nom:diviseur}` et `${nom}` dans un modèle d'URL.
fn fill_template(tpl: &str, start: i64, stop: i64, now: i64) -> String {
    let duration = (stop - start).max(0);
    let value = |name: &str, div: i64| -> Option<String> {
        let div = div.max(1);
        Some(match name {
            "utc" | "start" => start.to_string(),
            "utcend" | "end" => stop.to_string(),
            "lutc" | "now" | "timestamp" => now.to_string(),
            "duration" => (duration / div).to_string(),
            "offset" => ((now - start).max(0) / div).to_string(),
            "Y" => fmt_time(start, "%Y"),
            "m" => fmt_time(start, "%m"),
            "d" => fmt_time(start, "%d"),
            "H" => fmt_time(start, "%H"),
            "M" => fmt_time(start, "%M"),
            "S" => fmt_time(start, "%S"),
            _ => return None,
        })
    };
    let mut out = String::with_capacity(tpl.len() + 16);
    let mut rest = tpl;
    while let Some(pos) = rest.find('{') {
        let dollar = pos > 0 && rest.as_bytes()[pos - 1] == b'$';
        let Some(end) = rest[pos..].find('}') else { break };
        let inner = &rest[pos + 1..pos + end];
        let (name, div) = match inner.split_once(':') {
            Some((n, d)) => (n, d.parse().unwrap_or(1)),
            None => (inner, 1),
        };
        // Les variables `(Y)` style iptvsimple sont aussi acceptées entre accolades.
        match value(name, div) {
            Some(v) => {
                out.push_str(&rest[..if dollar { pos - 1 } else { pos }]);
                out.push_str(&v);
            }
            None => out.push_str(&rest[..pos + end + 1]),
        }
        rest = &rest[pos + end + 1..];
    }
    out.push_str(rest);
    out
}

/// URL de lecture du programme `[start, stop)` en replay, si la chaîne le permet
/// et si le programme est dans la fenêtre d'archive.
pub fn catchup_url(ch: &Channel, start: i64, stop: i64, now: i64) -> Option<String> {
    let c = ch.catchup.as_ref()?;
    let days = match c {
        Catchup::Template { days, .. } | Catchup::Xtream { days, .. } | Catchup::Flussonic { days } => *days,
    };
    if start >= now || start < now - (days as i64) * 86_400 {
        return None;
    }
    let stop = stop.min(now);
    Some(match c {
        Catchup::Template { template, append, .. } => {
            let filled = fill_template(template, start, stop, now);
            if *append {
                let sep = if ch.url.contains('?') && filled.starts_with('?') { "&" } else { "" };
                let filled = if sep == "&" { filled[1..].to_string() } else { filled };
                format!("{}{}{}", ch.url, sep, filled)
            } else {
                filled
            }
        }
        Catchup::Xtream { server, username, password, stream_id, .. } => {
            let minutes = ((stop - start) as f64 / 60.0).ceil() as i64;
            format!(
                "{}/timeshift/{}/{}/{}/{}/{}.ts",
                server,
                username,
                password,
                minutes.max(1),
                fmt_time(start, "%Y-%m-%d:%H-%M"),
                stream_id
            )
        }
        Catchup::Flussonic { .. } => {
            let duration = stop - start;
            let (path, query) = match ch.url.split_once('?') {
                Some((p, q)) => (p, format!("?{q}")),
                None => (ch.url.as_str(), String::new()),
            };
            let (dir, file) = path.rsplit_once('/')?;
            if file.ends_with(".m3u8") {
                let stem = file.trim_end_matches(".m3u8");
                format!("{dir}/{stem}-{start}-{duration}.m3u8{query}")
            } else {
                format!("{dir}/timeshift_abs-{start}.ts{query}")
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ch(url: &str, c: Catchup) -> Channel {
        Channel { url: url.into(), catchup: Some(c), ..Default::default() }
    }

    const NOW: i64 = 1_794_492_000; // 2026-11-12 14:00 UTC
    const START: i64 = NOW - 3600;

    #[test]
    fn template_default_and_append() {
        let c = ch("http://x/live", Catchup::Template { template: "http://a/b?s={utc}&e=${end}&d={duration:60}&y={Y}-{m}-{d}".into(), append: false, days: 2 });
        assert_eq!(catchup_url(&c, START, START + 1800, NOW).unwrap(), format!("http://a/b?s={START}&e={}&d=30&y=2026-11-12", START + 1800));
        let c = ch("http://x/live?tok=1", Catchup::Template { template: "?utc={utc}&lutc={lutc}".into(), append: true, days: 2 });
        assert_eq!(catchup_url(&c, START, START + 60, NOW).unwrap(), format!("http://x/live?tok=1&utc={START}&lutc={NOW}"));
    }

    #[test]
    fn xtream_and_window() {
        let c = ch("", Catchup::Xtream { server: "http://h:80".into(), username: "u".into(), password: "p".into(), stream_id: 7, days: 1 });
        assert_eq!(catchup_url(&c, START, START + 5400, NOW).unwrap(), "http://h:80/timeshift/u/p/60/2026-11-12:13-00/7.ts");
        assert!(catchup_url(&c, NOW + 10, NOW + 100, NOW).is_none(), "futur");
        assert!(catchup_url(&c, NOW - 2 * 86_400, NOW - 2 * 86_400 + 60, NOW).is_none(), "hors fenêtre");
    }

    #[test]
    fn flussonic() {
        let c = ch("http://f/ch1/index.m3u8?token=a", Catchup::Flussonic { days: 1 });
        assert_eq!(catchup_url(&c, START, START + 600, NOW).unwrap(), format!("http://f/ch1/index-{START}-600.m3u8?token=a"));
        let c = ch("http://f/ch1/mpegts", Catchup::Flussonic { days: 1 });
        assert_eq!(catchup_url(&c, START, START + 600, NOW).unwrap(), format!("http://f/ch1/timeshift_abs-{START}.ts"));
    }
}
