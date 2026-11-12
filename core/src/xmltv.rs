//! Parser XMLTV en flux (supporte les guides de plusieurs centaines de Mo, gzip ou non).

use std::collections::{HashMap, HashSet};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::model::{Channel, Programme};
use crate::util::normalize_name;

/// Guide des programmes indexé par identifiant de chaîne XMLTV.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Epg {
    /// id XMLTV -> programmes triés par heure de début.
    pub programmes: HashMap<String, Vec<Programme>>,
    /// clé de correspondance (id en minuscules ou nom normalisé) -> id XMLTV.
    pub index: HashMap<String, String>,
    /// id XMLTV -> logo annoncé par le guide.
    pub icons: HashMap<String, String>,
}

/// Restreint l'analyse aux chaînes réellement présentes dans les sources (économie mémoire).
#[derive(Debug, Default, Clone)]
pub struct EpgFilter {
    pub ids: HashSet<String>,
    pub names: HashSet<String>,
    /// Fenêtre conservée, en timestamps Unix.
    pub from: i64,
    pub to: i64,
}

impl EpgFilter {
    pub fn for_channels(channels: &[Channel], from: i64, to: i64) -> Self {
        let mut f = EpgFilter { from, to, ..Default::default() };
        for c in channels {
            if let Some(id) = &c.tvg_id {
                f.ids.insert(id.to_lowercase());
            }
            f.names.insert(normalize_name(c.tvg_name.as_deref().unwrap_or(&c.name)));
            f.names.insert(normalize_name(&c.name));
        }
        f
    }
}

impl Epg {
    /// Trouve l'identifiant XMLTV d'une chaîne : par `tvg-id`, puis par nom.
    pub fn resolve(&self, ch: &Channel) -> Option<&str> {
        let candidates = [
            ch.tvg_id.as_ref().map(|s| s.to_lowercase()),
            ch.tvg_name.as_deref().map(normalize_name),
            Some(normalize_name(&ch.name)),
        ];
        candidates.into_iter().flatten().find_map(|k| self.index.get(&k).map(String::as_str))
    }

    pub fn for_channel(&self, ch: &Channel, from: i64, to: i64) -> Vec<Programme> {
        let Some(id) = self.resolve(ch) else { return vec![] };
        let Some(list) = self.programmes.get(id) else { return vec![] };
        let first = list.partition_point(|p| p.stop <= from);
        list[first..].iter().take_while(|p| p.start < to).cloned().collect()
    }

    /// Fusionne un autre guide (plusieurs URL d'EPG). Les programmes existants priment.
    pub fn merge(&mut self, other: Epg) {
        for (k, v) in other.index {
            self.index.entry(k).or_insert(v);
        }
        for (k, v) in other.icons {
            self.icons.entry(k).or_insert(v);
        }
        for (id, list) in other.programmes {
            self.programmes.entry(id).or_insert(list);
        }
    }
}

/// Convertit `20241112150000 +0100` (décalage optionnel) en timestamp Unix.
pub fn parse_xmltv_time(s: &str) -> Option<i64> {
    let s = s.trim();
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() < 12 {
        return None;
    }
    let n = |a: usize, b: usize| digits.get(a..b).and_then(|x| x.parse::<i64>().ok());
    let (y, mo, d, h, mi) = (n(0, 4)?, n(4, 6)?, n(6, 8)?, n(8, 10)?, n(10, 12)?);
    let sec = n(12, 14).unwrap_or(0);
    let date = chrono::NaiveDate::from_ymd_opt(y as i32, mo as u32, d as u32)?;
    let base = date.and_hms_opt(h as u32, mi as u32, sec as u32)?.and_utc().timestamp();
    let rest = s[digits.len()..].trim();
    let offset = if rest.len() >= 5 && (rest.starts_with('+') || rest.starts_with('-')) {
        let sign = if rest.starts_with('-') { -1 } else { 1 };
        let oh: i64 = rest.get(1..3)?.parse().ok()?;
        let om: i64 = rest.get(3..5)?.parse().ok()?;
        sign * (oh * 3600 + om * 60)
    } else {
        0
    };
    Some(base - offset)
}

fn attr(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

#[derive(Default)]
struct ProgDraft {
    channel: String,
    p: Option<Programme>,
}

/// Analyse un document XMLTV. `filter = None` conserve tout.
pub fn parse_xmltv(xml: &[u8], filter: Option<&EpgFilter>) -> Result<Epg, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut epg = Epg::default();
    let mut kept: HashSet<String> = HashSet::new();

    let mut buf = Vec::new();
    let mut text_target: Option<&'static str> = None;
    let mut cur_channel: Option<(String, Vec<String>)> = None;
    let mut prog = ProgDraft::default();
    let mut text = String::new();
    let mut in_rating = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("XMLTV invalide à la position {}: {e}", reader.buffer_position())),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                match e.name().as_ref() {
                    b"channel" => {
                        cur_channel = attr(&e, b"id").map(|id| (id, vec![]));
                    }
                    b"programme" => {
                        prog = ProgDraft::default();
                        let ch = attr(&e, b"channel").unwrap_or_default();
                        let start = attr(&e, b"start").as_deref().and_then(parse_xmltv_time);
                        let stop = attr(&e, b"stop").as_deref().and_then(parse_xmltv_time);
                        let keep_channel = filter.is_none() || kept.contains(&ch);
                        if let (true, Some(start)) = (keep_channel, start) {
                            let stop = stop.unwrap_or(start + 1800);
                            let in_window = filter.map_or(true, |f| stop > f.from && start < f.to);
                            if in_window {
                                prog.channel = ch;
                                prog.p = Some(Programme {
                                    start,
                                    stop,
                                    title: String::new(),
                                    subtitle: None,
                                    desc: None,
                                    category: None,
                                    icon: None,
                                    episode: None,
                                    age: None,
                                });
                            }
                        }
                    }
                    b"display-name" if cur_channel.is_some() => text_target = Some("display-name"),
                    b"icon" => {
                        if let Some(src) = attr(&e, b"src") {
                            if let Some(p) = prog.p.as_mut() {
                                p.icon.get_or_insert(src);
                            } else if let Some((id, _)) = &cur_channel {
                                epg.icons.entry(id.clone()).or_insert(src);
                            }
                        }
                    }
                    b"title" if prog.p.is_some() => text_target = Some("title"),
                    b"sub-title" if prog.p.is_some() => text_target = Some("sub-title"),
                    b"desc" if prog.p.is_some() => text_target = Some("desc"),
                    b"category" if prog.p.is_some() => text_target = Some("category"),
                    b"value" if prog.p.is_some() && in_rating => text_target = Some("rating"),
                    b"rating" if prog.p.is_some() => in_rating = true,
                    b"episode-num" if prog.p.is_some() => {
                        text_target = if attr(&e, b"system").as_deref() == Some("onscreen") { Some("episode") } else { None }
                    }
                    _ => {}
                }
                text.clear();
            }
            Ok(Event::Text(t)) if text_target.is_some() => {
                text.push_str(&t.unescape().unwrap_or_default());
            }
            Ok(Event::CData(t)) if text_target.is_some() => {
                text.push_str(&String::from_utf8_lossy(&t));
            }
            Ok(Event::End(e)) => {
                match e.name().as_ref() {
                    b"channel" => {
                        if let Some((id, names)) = cur_channel.take() {
                            let lower = id.to_lowercase();
                            let wanted = match filter {
                                None => true,
                                Some(f) => f.ids.contains(&lower) || names.iter().any(|n| f.names.contains(&normalize_name(n))),
                            };
                            if wanted {
                                epg.index.insert(lower, id.clone());
                                for n in &names {
                                    epg.index.entry(normalize_name(n)).or_insert_with(|| id.clone());
                                }
                                kept.insert(id);
                            } else {
                                epg.icons.remove(&id);
                            }
                        }
                    }
                    b"rating" => in_rating = false,
                    b"programme" => {
                        if let Some(p) = prog.p.take() {
                            epg.programmes.entry(std::mem::take(&mut prog.channel)).or_default().push(p);
                        }
                    }
                    _ => {}
                }
                if let Some(target) = text_target.take() {
                    let value = std::mem::take(&mut text).trim().to_string();
                    if !value.is_empty() {
                        match target {
                            "display-name" => {
                                if let Some((_, names)) = cur_channel.as_mut() {
                                    names.push(value);
                                }
                            }
                            other => {
                                if let Some(p) = prog.p.as_mut() {
                                    match other {
                                        "title" if p.title.is_empty() => p.title = value,
                                        "sub-title" => p.subtitle = p.subtitle.take().or(Some(value)),
                                        "desc" => p.desc = p.desc.take().or(Some(value)),
                                        "category" => p.category = p.category.take().or(Some(value)),
                                        "episode" => p.episode = Some(value),
                                        "rating" => p.age = p.age.max(crate::parental::age_from_rating(&value)),
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        buf.clear();
    }

    for list in epg.programmes.values_mut() {
        list.sort_by_key(|p| p.start);
        list.dedup_by_key(|p| p.start);
    }
    Ok(epg)
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="France24.fr"><display-name>France 24</display-name><icon src="https://logo"/></channel>
  <channel id="Other.xx"><display-name>Autre</display-name></channel>
  <programme start="20261112140000 +0100" stop="20261112143000 +0100" channel="France24.fr">
    <title lang="fr">Journal</title><desc>Les infos &amp; la météo</desc><category>News</category>
    <episode-num system="onscreen">S1E2</episode-num>
    <rating system="CSA"><value>-12</value></rating>
  </programme>
  <programme start="20261112143000 +0100" stop="20261112150000 +0100" channel="France24.fr">
    <title><![CDATA[Débat]]></title>
  </programme>
  <programme start="20261112140000 +0000" stop="20261112150000 +0000" channel="Other.xx"><title>X</title></programme>
</tv>"#;

    #[test]
    fn parses_time() {
        assert_eq!(parse_xmltv_time("20261112140000 +0100"), Some(1_794_488_400));
        assert_eq!(parse_xmltv_time("20261112130000"), Some(1_794_488_400));
        assert_eq!(parse_xmltv_time("bad"), None);
    }

    #[test]
    fn parses_with_filter_and_resolves_by_name() {
        let ch = Channel { name: "France 24 HD".into(), ..Default::default() };
        let f = EpgFilter::for_channels(std::slice::from_ref(&ch), 0, i64::MAX);
        let epg = parse_xmltv(XML.as_bytes(), Some(&f)).unwrap();
        assert_eq!(epg.programmes.len(), 1, "la chaîne non demandée est ignorée");
        let progs = epg.for_channel(&ch, 0, i64::MAX);
        assert_eq!(progs.len(), 2);
        assert_eq!(progs[0].title, "Journal");
        assert_eq!(progs[0].desc.as_deref(), Some("Les infos & la météo"));
        assert_eq!(progs[0].episode.as_deref(), Some("S1E2"));
        assert_eq!(progs[0].age, Some(12));
        assert_eq!(progs[1].title, "Débat");
        assert_eq!(progs[1].age, None);
        assert_eq!(epg.icons.get("France24.fr").map(String::as_str), Some("https://logo"));
    }
}
