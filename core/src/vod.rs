//! Films, séries et musique : modèle, nettoyage des titres, regroupement des
//! épisodes, catégories et recherche par critère avec tri par langues favorites.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::lang;
use crate::model::Channel;
use crate::util::stable_key;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum VodKind {
    Movie,
    Series,
    /// Émissions (télévision, replays).
    Show,
    Music,
    Radio,
    Podcast,
    Audiobook,
}

impl VodKind {
    /// Contenu composé d'épisodes / chapitres / pistes chargés à la demande.
    pub fn is_episodic(self) -> bool {
        matches!(self, VodKind::Series | VodKind::Podcast | VodKind::Audiobook)
    }
}

/// Comment obtenir les détails et les flux d'un contenu.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum VodRef {
    #[default]
    None,
    Xtream { server: String, username: String, password: String, id: u64, container: Option<String> },
    Archive { identifier: String },
    /// Serveur Jellyfin / Emby de l'utilisateur.
    Jellyfin { server: String, token: String, id: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: String,
    pub season: u32,
    pub episode: u32,
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub still: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub air_date: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VodItem {
    pub id: String,
    pub source_id: String,
    pub kind: Option<VodKind>,
    pub title: String,
    /// Nom brut fourni par la source.
    pub raw_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
    /// Flux direct (film, morceau, radio). Les séries passent par leurs épisodes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backdrop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub languages: Vec<String>,
    /// Pays d'origine (ISO 3166-1 alpha-2), quand la source l'indique.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub countries: Vec<String>,
    /// Note sur 10.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cast: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub directors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imdb_id: Option<String>,
    /// Identifiant YouTube de la bande-annonce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trailer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
    /// Flux continu (radio) : pas de reprise de lecture.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub live: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub adult: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub episodes: Vec<Episode>,
    #[serde(default, skip_serializing_if = "is_none_ref")]
    pub source_ref: VodRef,
    /// Autres copies du même contenu (autres sources), regroupées sous celle-ci.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternates: Vec<VodItem>,
}

fn is_none_ref(r: &VodRef) -> bool {
    *r == VodRef::None
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb_id: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Season {
    pub number: u32,
    pub name: String,
    pub episodes: Vec<Episode>,
}

/// Fiche complète, assemblée à la demande (source + métadonnées externes).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodDetail {
    pub item: VodItem,
    pub cast: Vec<Person>,
    pub crew: Vec<Person>,
    pub seasons: Vec<Season>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imdb_rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imdb_votes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb_rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    #[serde(default)]
    pub countries: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age: Option<u8>,
}

// ------------------------------------------------------------------ Copies

/// Types regroupés : un même titre y désigne le même contenu. Les morceaux, podcasts
/// et livres audio portent souvent des titres communs à des œuvres différentes.
fn groupable(kind: Option<VodKind>) -> bool {
    matches!(kind, Some(VodKind::Movie) | Some(VodKind::Series) | Some(VodKind::Radio))
}

/// Copie la plus documentée : elle représente le groupe.
fn richness(i: &VodItem) -> u32 {
    (i.poster.is_some() as u32) * 4 + (i.tmdb_id.is_some() as u32) * 3 + (i.plot.is_some() as u32) * 2 + (i.year.is_some() as u32) + (i.rating.is_some() as u32)
}

/// Regroupe les copies d'un même film, d'une même série ou d'une même radio venant de
/// plusieurs sources : même type, même titre nettoyé, et même année quand les deux la
/// donnent. La copie la plus documentée représente le groupe, à la place de la première.
pub fn group_copies(items: Vec<VodItem>) -> Vec<VodItem> {
    let mut groups: Vec<Vec<VodItem>> = Vec::with_capacity(items.len());
    let mut by_key: std::collections::HashMap<(Option<VodKind>, String), Vec<usize>> = std::collections::HashMap::new();
    for it in items {
        if !groupable(it.kind) || it.title.trim().is_empty() {
            groups.push(vec![it]);
            continue;
        }
        let key = (it.kind, fold(&it.title));
        let slot = by_key.get(&key).and_then(|idx| {
            idx.iter().copied().find(|&g| {
                let head = &groups[g][0];
                head.adult == it.adult && (head.year.is_none() || it.year.is_none() || head.year == it.year)
            })
        });
        match slot {
            Some(g) => groups[g].push(it),
            None => {
                by_key.entry(key).or_default().push(groups.len());
                groups.push(vec![it]);
            }
        }
    }
    groups
        .into_iter()
        .map(|mut g| {
            if g.len() == 1 {
                return g.pop().unwrap();
            }
            let best = (0..g.len()).max_by_key(|&i| (richness(&g[i]), std::cmp::Reverse(i))).unwrap_or(0);
            let mut head = g.remove(best);
            for alt in &g {
                for l in &alt.languages {
                    if !head.languages.contains(l) {
                        head.languages.push(l.clone());
                    }
                }
                head.year = head.year.or(alt.year);
                head.poster = head.poster.take().or_else(|| alt.poster.clone());
                head.plot = head.plot.take().or_else(|| alt.plot.clone());
            }
            head.alternates = g;
            head
        })
        .collect()
}

/// Contenus correspondant à des identifiants TMDB (copies comprises), pour la synchronisation.
pub fn by_tmdb(items: &[VodItem], ids: &[u64]) -> Vec<VodItem> {
    let wanted: std::collections::HashSet<u64> = ids.iter().copied().collect();
    items
        .iter()
        .filter(|i| i.tmdb_id.is_some_and(|t| wanted.contains(&t)) || i.alternates.iter().any(|a| a.tmdb_id.is_some_and(|t| wanted.contains(&t))))
        .map(|i| VodItem { episodes: vec![], alternates: vec![], tmdb_id: i.tmdb_id.or_else(|| i.alternates.iter().find_map(|a| a.tmdb_id)), ..i.clone() })
        .collect()
}

/// Contenu par identifiant : l'entrée regroupée, ou la copie exacte quand l'identifiant
/// est celui d'une copie (historique, favoris, épisodes lus depuis une autre source).
pub fn find_copy<'a>(items: &'a [VodItem], id: &str) -> Option<&'a VodItem> {
    items.iter().find(|i| i.id == id).or_else(|| items.iter().flat_map(|i| i.alternates.iter()).find(|a| a.id == id))
}

// ------------------------------------------------------------------ Titres

/// Minuscules, sans accents ni ponctuation, espaces conservés.
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.to_lowercase().chars() {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' | 'ø' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            'œ' => 'o',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        };
        if c != ' ' || !out.ends_with(' ') {
            out.push(c);
        }
    }
    out.trim().to_string()
}

const NOISE: &[&str] = &[
    "1080p", "720p", "480p", "2160p", "4k", "uhd", "fhd", "hd", "sd", "hdr", "hdr10", "dv", "x264", "x265", "h264", "h265", "hevc",
    "multi", "vf", "vff", "vfq", "vfi", "vo", "vost", "vostfr", "truefrench", "french", "subfrench", "web", "webrip", "web-dl",
    "bluray", "brrip", "dvdrip", "hdtv", "hdcam", "cam", "ac3", "aac", "dts", "atmos", "10bit", "remux", "imax",
];

#[derive(Debug, Default, PartialEq)]
pub struct ParsedTitle {
    pub title: String,
    pub year: Option<u16>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
}

/// « FR| Le Film (2019) [1080p] » -> titre « Le Film », année 2019.
/// « Ma Série S02 E05 » -> titre « Ma Série », saison 2, épisode 5.
pub fn parse_title(raw: &str) -> ParsedTitle {
    let mut s = raw.trim().to_string();
    // Préfixe de langue/pays (« FR| », « [EN] »).
    if let Some(p) = lang::leading_prefix(&s) {
        if lang::lang_from_country(&p).or_else(|| lang::code_from_alias(&p)).is_some() {
            if let Some(i) = s.to_lowercase().find(&p) {
                s = s[i + p.len()..].trim_start_matches(|c: char| "|]):-. ".contains(c)).to_string();
            }
        }
    }
    let mut out = ParsedTitle::default();

    // Saison / épisode : S01E02, S1 E2, 1x02.
    let lower = s.to_lowercase();
    let b = lower.as_bytes();
    let mut cut: Option<usize> = None;
    let mut marker_end = 0;
    for i in 0..b.len() {
        let at_word = i == 0 || !b[i - 1].is_ascii_alphanumeric();
        if !at_word {
            continue;
        }
        if b[i] == b's' {
            let mut j = i + 1;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j - i <= 4 {
                let season: u32 = lower[i + 1..j].parse().unwrap_or(0);
                let mut k = j;
                while k < b.len() && (b[k] == b' ' || b[k] == b'.' || b[k] == b'-') {
                    k += 1;
                }
                if k < b.len() && b[k] == b'e' {
                    let mut m = k + 1;
                    while m < b.len() && b[m].is_ascii_digit() {
                        m += 1;
                    }
                    if m > k + 1 {
                        out.season = Some(season);
                        out.episode = lower[k + 1..m].parse().ok();
                        cut = Some(i);
                        marker_end = m;
                        break;
                    }
                }
            }
        } else if b[i].is_ascii_digit() {
            let mut j = i;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j - i <= 2 && j < b.len() && b[j] == b'x' {
                let mut m = j + 1;
                while m < b.len() && b[m].is_ascii_digit() {
                    m += 1;
                }
                if m - j - 1 >= 2 && (m == b.len() || !b[m].is_ascii_alphanumeric()) {
                    out.season = lower[i..j].parse().ok();
                    out.episode = lower[j + 1..m].parse().ok();
                    cut = Some(i);
                    marker_end = m;
                    break;
                }
            }
        }
    }
    match cut {
        // Marqueur en tête (« s01e19-Titre ») : le titre est ce qui suit.
        Some(0) => s = s[marker_end..].trim_start_matches(|c: char| " -_.:".contains(c)).to_string(),
        Some(c) => s.truncate(c),
        None => {}
    }
    // Noms de fichiers « THE_CAPTAIN_S_GUEST » : les tirets bas séparent les mots.
    if s.contains('_') && s.matches(' ').count() < s.matches('_').count() {
        s = s.replace('_', " ");
    }

    // Année : (2019), [2019], - 2019 en fin de titre.
    let year_re = |t: &str| -> Option<(usize, u16)> {
        let bytes = t.as_bytes();
        let mut i = bytes.len();
        while i >= 4 {
            let w = &bytes[i - 4..i];
            if w.iter().all(u8::is_ascii_digit) {
                let y: u16 = std::str::from_utf8(w).ok()?.parse().ok()?;
                // Année délimitée : « (2019) », « [2019] », « - 2019 », « .2019 ». Un simple espace
                // ne suffit pas (« Blade Runner 2049 »).
                let mut k = i - 4;
                while k > 0 && bytes[k - 1] == b' ' {
                    k -= 1;
                }
                let before_ok = k > 0 && b"([-.|_".contains(&bytes[k - 1]);
                let after_ok = i == bytes.len() || !bytes[i].is_ascii_alphanumeric();
                if (1900..=2100).contains(&y) && before_ok && after_ok && i - 4 > 0 {
                    return Some((i - 4, y));
                }
            }
            i -= 1;
        }
        None
    };
    if let Some((pos, y)) = year_re(&s) {
        out.year = Some(y);
        s.truncate(pos);
    }

    // Balises techniques entre crochets ou en fin de titre.
    let mut words: Vec<&str> = s.split_whitespace().collect();
    while let Some(last) = words.last() {
        let w = last.trim_matches(|c: char| "[](){}-|.".contains(c)).to_lowercase();
        if w.is_empty() || NOISE.contains(&w.as_str()) {
            words.pop();
        } else {
            break;
        }
    }
    let mut joined = words.join(" ");
    // Noms de fichiers « Show.Name.2019 » : les points séparent les mots.
    if !joined.contains(' ') && joined.matches('.').count() >= 1 {
        joined = joined.replace('.', " ");
    }
    out.title = joined.trim_matches(|c: char| " -|:([.".contains(c)).to_string();
    // Parenthèse ouverte par l'année retirée : « Film ( Auteur » -> « Film (Auteur) ».
    if out.title.matches('(').count() > out.title.matches(')').count() {
        out.title = format!("{})", out.title.replace("( ", "(").trim_end());
    }
    if out.title.is_empty() {
        out.title = raw.trim().to_string();
    }
    out
}

// ------------------------------------------------------------------ M3U

const VIDEO_EXT: &[&str] = &["mp4", "mkv", "avi", "mov", "m4v", "wmv", "webm", "mpg", "mpeg"];
const AUDIO_EXT: &[&str] = &["mp3", "flac", "aac", "m4a", "ogg", "opus", "wav"];

fn url_ext(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let file = path.rsplit('/').next().unwrap_or("");
    match file.rsplit_once('.') {
        Some((_, e)) if e.len() <= 5 => e.to_lowercase(),
        _ => String::new(),
    }
}

/// Une entrée M3U est-elle un film, un épisode ou de la musique plutôt qu'une chaîne ?
pub fn classify_m3u(ch: &Channel) -> Option<VodKind> {
    let url = ch.url.to_lowercase();
    let ext = url_ext(&url);
    let group = ch.group.as_deref().unwrap_or("").to_lowercase();
    let parsed_has_ep = parse_title(&ch.name).episode.is_some();
    if url.contains("/series/") || (parsed_has_ep && (VIDEO_EXT.contains(&ext.as_str()) || group.contains("serie") || group.contains("série"))) {
        return Some(VodKind::Series);
    }
    if url.contains("/movie/") || VIDEO_EXT.contains(&ext.as_str()) {
        return Some(VodKind::Movie);
    }
    if AUDIO_EXT.contains(&ext.as_str()) {
        return Some(if group.contains("podcast") { VodKind::Podcast } else if group.contains("livre") || group.contains("audiobook") { VodKind::Audiobook } else { VodKind::Music });
    }
    if group.contains("radio") {
        return Some(VodKind::Radio);
    }
    None
}

/// Convertit les entrées VOD d'une M3U ; les épisodes sont regroupés par série.
pub fn from_m3u_entries(entries: Vec<(VodKind, Channel)>, source_id: &str) -> Vec<VodItem> {
    let mut items = Vec::new();
    let mut series: BTreeMap<String, VodItem> = BTreeMap::new();
    for (kind, ch) in entries {
        let p = parse_title(&ch.name);
        let langs = if ch.languages.is_empty() { lang::detect(&ch.name, ch.group.as_deref(), None, None) } else { ch.languages.clone() };
        if kind == VodKind::Series {
            let key = fold(&p.title);
            let s = series.entry(key.clone()).or_insert_with(|| VodItem {
                id: format!("{source_id}:s{}", stable_key(&[&key])),
                source_id: source_id.into(),
                kind: Some(VodKind::Series),
                title: p.title.clone(),
                raw_name: p.title.clone(),
                year: p.year,
                poster: ch.logo.clone(),
                category: ch.group.clone(),
                languages: langs.clone(),
                user_agent: ch.user_agent.clone(),
                referrer: ch.referrer.clone(),
                adult: ch.adult,
                ..Default::default()
            });
            s.episodes.push(Episode {
                id: format!("{}:e{}", s.id, stable_key(&[&ch.url])),
                season: p.season.unwrap_or(1),
                episode: p.episode.unwrap_or(s.episodes.len() as u32 + 1),
                title: ch.name.clone(),
                url: ch.url.clone(),
                ..Default::default()
            });
        } else {
            items.push(VodItem {
                id: format!("{source_id}:{}", stable_key(&[&ch.url])),
                source_id: source_id.into(),
                kind: Some(kind),
                title: p.title,
                raw_name: ch.name.clone(),
                year: p.year,
                url: Some(ch.url.clone()),
                poster: ch.logo.clone(),
                category: ch.group.clone(),
                languages: langs,
                user_agent: ch.user_agent.clone(),
                referrer: ch.referrer.clone(),
                adult: ch.adult,
                live: kind == VodKind::Radio,
                ..Default::default()
            });
        }
    }
    for mut s in series.into_values() {
        s.episodes.sort_by_key(|e| (e.season, e.episode));
        items.push(s);
    }
    items
}

// ------------------------------------------------------------------ Recherche

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SearchField {
    #[default]
    All,
    Title,
    Actor,
    Director,
    Genre,
    Year,
    Category,
    Plot,
}

fn text_score(hay: &str, q: &str) -> u32 {
    if hay.is_empty() || q.is_empty() {
        return 0;
    }
    if hay == q {
        100
    } else if hay.starts_with(q) {
        85
    } else if hay.contains(&format!(" {q}")) {
        70
    } else if hay.contains(q) {
        50
    } else if q.split(' ').all(|w| hay.contains(w)) {
        40
    } else {
        0
    }
}

/// Pertinence d'un contenu pour une recherche (0 = ne correspond pas).
pub fn score(item: &VodItem, q: &str, field: SearchField) -> u32 {
    let best = |list: &[String]| list.iter().map(|x| text_score(&fold(x), q)).max().unwrap_or(0);
    let title = || text_score(&fold(&item.title), q).max(text_score(&fold(&item.raw_name), q));
    match field {
        SearchField::Title => title(),
        SearchField::Actor => best(&item.cast),
        SearchField::Director => best(&item.directors),
        SearchField::Genre => best(&item.genres).max(item.category.as_deref().map_or(0, |c| text_score(&fold(c), q) / 2)),
        SearchField::Category => item.category.as_deref().map_or(0, |c| text_score(&fold(c), q)),
        SearchField::Year => (item.year.map(|y| y.to_string()) == Some(q.to_string())) as u32 * 100,
        SearchField::Plot => item.plot.as_deref().map_or(0, |p| text_score(&fold(p), q) / 2),
        SearchField::All => {
            let t = title();
            let people = best(&item.cast).max(best(&item.directors)) * 9 / 10;
            let genre = best(&item.genres) * 7 / 10;
            let year = (item.year.map(|y| y.to_string()) == Some(q.to_string())) as u32 * 60;
            let plot = item.plot.as_deref().map_or(0, |p| text_score(&fold(p), q) / 4);
            t.max(people).max(genre).max(year).max(plot)
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VodSort {
    /// Langues favorites d'abord, puis ajout récent.
    #[default]
    Default,
    Added,
    Rating,
    Title,
    Year,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodQuery {
    pub kind: Option<VodKind>,
    pub category: Option<String>,
    pub genre: Option<String>,
    /// Filtre strict sur une langue.
    pub language: Option<String>,
    /// « Mes langues » : au moins une de ces langues.
    pub any_languages: Option<Vec<String>>,
    /// Filtre sur un pays (ISO 3166-1 alpha-2).
    pub country: Option<String>,
    /// Avec `any_languages` : garder aussi les contenus dont la langue n'a pas pu être identifiée.
    #[serde(default)]
    pub include_unknown_language: bool,
    /// Langues favorites, dans l'ordre : servent au tri.
    #[serde(default)]
    pub prefer_languages: Vec<String>,
    pub text: Option<String>,
    #[serde(default)]
    pub field: SearchField,
    /// Restreindre à une liste d'identifiants (favoris, historique, filmographie).
    pub ids: Option<Vec<String>>,
    #[serde(default)]
    pub sort: VodSort,
    #[serde(default)]
    pub include_adult: bool,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodPage {
    pub total: usize,
    pub items: Vec<VodItem>,
}

/// Version allégée pour les grilles (sans épisodes ni synopsis).
fn summary(i: &VodItem) -> VodItem {
    VodItem {
        episodes: vec![],
        plot: i.plot.as_ref().map(|p| p.chars().take(200).collect()),
        // Copies allégées : seule leur adresse sert (repli à la lecture).
        alternates: i.alternates.iter().map(|a| VodItem { episodes: vec![], plot: None, cast: vec![], alternates: vec![], ..a.clone() }).collect(),
        ..i.clone()
    }
}

/// Rang d'un contenu dans une liste d'identifiants, par lui-même ou l'une de ses copies.
fn id_rank(i: &VodItem, m: &HashMap<&str, usize>) -> Option<usize> {
    std::iter::once(i.id.as_str()).chain(i.alternates.iter().map(|a| a.id.as_str())).filter_map(|id| m.get(id).copied()).min()
}

pub fn query(items: &[VodItem], q: &VodQuery) -> VodPage {
    let text = q.text.as_deref().map(fold).filter(|t| !t.is_empty());
    let ids: Option<HashMap<&str, usize>> = q.ids.as_ref().map(|v| v.iter().enumerate().map(|(i, s)| (s.as_str(), i)).collect());
    let mut hits: Vec<(&VodItem, u32)> = items
        .iter()
        .filter(|i| q.include_adult || !i.adult)
        .filter(|i| q.kind.map_or(true, |k| i.kind == Some(k)))
        .filter(|i| q.category.as_ref().map_or(true, |c| i.category.as_ref() == Some(c)))
        .filter(|i| q.genre.as_ref().map_or(true, |g| i.genres.iter().any(|x| x.eq_ignore_ascii_case(g))))
        .filter(|i| q.language.as_ref().map_or(true, |l| i.languages.contains(l)))
        .filter(|i| {
            q.any_languages.as_ref().map_or(true, |ls| i.languages.iter().any(|l| ls.contains(l)) || (q.include_unknown_language && i.languages.is_empty()))
        })
        // Favoris et historique peuvent viser une copie regroupée sous une autre.
        .filter(|i| ids.as_ref().map_or(true, |m| id_rank(i, m).is_some()))
        .filter(|i| q.country.as_ref().map_or(true, |c| i.countries.contains(c)))
        .filter_map(|i| match &text {
            None => Some((i, 0)),
            Some(t) => Some((i, score(i, t, q.field))).filter(|(_, s)| *s > 0),
        })
        .collect();

    let prefs = &q.prefer_languages;
    let rank = |i: &VodItem| lang::rank(&i.languages, prefs);
    match (q.sort, &text, &ids) {
        // Liste explicite sans tri demandé (historique, favoris) : ordre fourni.
        (VodSort::Default, None, Some(m)) => hits.sort_by_key(|(i, _)| id_rank(i, m).unwrap_or(usize::MAX)),
        (VodSort::Default, Some(_), _) => hits.sort_by(|a, b| rank(a.0).cmp(&rank(b.0)).then(b.1.cmp(&a.1))),
        (VodSort::Default, None, None) => hits.sort_by(|a, b| rank(a.0).cmp(&rank(b.0)).then(b.0.added.cmp(&a.0.added))),
        (VodSort::Added, ..) => hits.sort_by(|a, b| b.0.added.cmp(&a.0.added)),
        (VodSort::Rating, ..) => hits.sort_by(|a, b| b.0.rating.partial_cmp(&a.0.rating).unwrap_or(std::cmp::Ordering::Equal)),
        (VodSort::Title, ..) => hits.sort_by_cached_key(|(i, _)| fold(&i.title)),
        (VodSort::Year, ..) => hits.sort_by(|a, b| b.0.year.cmp(&a.0.year)),
    }
    let total = hits.len();
    let limit = q.limit.unwrap_or(60).min(500);
    VodPage { total, items: hits.into_iter().skip(q.offset).take(limit).map(|(i, _)| summary(i)).collect() }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facet {
    pub name: String,
    pub count: usize,
    /// Libellé lisible (préfixe de langue retiré).
    pub label: String,
    /// Langue de la catégorie (préfixe ou langue majoritaire de ses contenus).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

impl Facet {
    fn plain(name: String, count: usize) -> Self {
        Facet { label: name.clone(), name, count, language: None }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodFacets {
    pub total: usize,
    pub categories: Vec<Facet>,
    pub genres: Vec<Facet>,
    pub languages: Vec<Facet>,
    pub countries: Vec<Facet>,
}

/// Catégories, genres et langues disponibles, les langues favorites en tête.
pub fn facets(items: &[VodItem], kind: Option<VodKind>, prefs: &[String], include_adult: bool) -> VodFacets {
    let mut cats: HashMap<&str, (usize, usize)> = HashMap::new();
    let mut cat_langs: HashMap<&str, HashMap<&str, usize>> = HashMap::new();
    let mut genres: HashMap<String, usize> = HashMap::new();
    let mut langs: HashMap<&str, usize> = HashMap::new();
    let mut countries: HashMap<&str, usize> = HashMap::new();
    let mut total = 0;
    for i in items.iter().filter(|i| kind.map_or(true, |k| i.kind == Some(k)) && (include_adult || !i.adult)) {
        total += 1;
        if let Some(c) = &i.category {
            let e = cats.entry(c).or_insert((0, usize::MAX));
            e.0 += 1;
            e.1 = e.1.min(lang::rank(&i.languages, prefs));
            if let Some(l) = i.languages.first() {
                *cat_langs.entry(c).or_default().entry(l).or_default() += 1;
            }
        }
        for g in &i.genres {
            *genres.entry(g.trim().to_string()).or_default() += 1;
        }
        for l in &i.languages {
            *langs.entry(l).or_default() += 1;
        }
        for c in &i.countries {
            *countries.entry(c).or_default() += 1;
        }
    }
    let mut categories: Vec<_> = cats
        .into_iter()
        .map(|(n, (c, r))| {
            let (prefix_lang, label) = lang::split_prefix(n);
            let majority = cat_langs.get(n).and_then(|m| m.iter().max_by_key(|(_, k)| **k)).map(|(l, _)| l.to_string());
            (r, Facet { name: n.to_string(), count: c, label, language: prefix_lang.map(str::to_string).or(majority) })
        })
        .collect();
    categories.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.count.cmp(&a.1.count)));
    let mut genres: Vec<_> = genres.into_iter().map(|(name, count)| Facet::plain(name, count)).collect();
    genres.sort_by(|a, b| b.count.cmp(&a.count));
    let mut languages: Vec<_> = langs.into_iter().map(|(n, c)| Facet { name: n.to_string(), count: c, label: n.to_string(), language: Some(n.to_string()) }).collect();
    languages.sort_by(|a, b| {
        let ra = prefs.iter().position(|p| p == &a.name).unwrap_or(usize::MAX);
        let rb = prefs.iter().position(|p| p == &b.name).unwrap_or(usize::MAX);
        ra.cmp(&rb).then(b.count.cmp(&a.count))
    });
    let mut countries: Vec<_> = countries.into_iter().map(|(n, c)| Facet { name: n.to_string(), count: c, label: n.to_string(), language: lang::lang_from_country(n).map(str::to_string) }).collect();
    // Pays des langues favorites d'abord, puis par nombre de contenus.
    countries.sort_by(|a, b| lang::rank(&a.language.clone().into_iter().collect::<Vec<_>>(), prefs).cmp(&lang::rank(&b.language.clone().into_iter().collect::<Vec<_>>(), prefs)).then(b.count.cmp(&a.count)));
    VodFacets { total, categories: categories.into_iter().map(|(_, f)| f).collect(), genres, languages, countries }
}

/// Contenus de la bibliothèque correspondant à une filmographie (TMDB ou titre + année).
pub fn match_filmography<'a>(items: &'a [VodItem], credits: &[(String, Option<u16>, Option<u64>)]) -> Vec<&'a VodItem> {
    let by_tmdb: HashMap<u64, ()> = credits.iter().filter_map(|c| c.2).map(|id| (id, ())).collect();
    let by_title: HashMap<String, Option<u16>> = credits.iter().map(|c| (fold(&c.0), c.1)).collect();
    items
        .iter()
        .filter(|i| {
            i.tmdb_id.is_some_and(|id| by_tmdb.contains_key(&id))
                || by_title.get(&fold(&i.title)).is_some_and(|y| y.is_none() || i.year.is_none() || y.zip(i.year).is_some_and(|(a, b)| a.abs_diff(b) <= 1))
        })
        .collect()
}

/// Contenus où une personne apparaît (casting ou réalisation) d'après les données de la source.
pub fn with_person<'a>(items: &'a [VodItem], name: &str) -> Vec<&'a VodItem> {
    let n = fold(name);
    items.iter().filter(|i| i.cast.iter().chain(&i.directors).any(|p| fold(p) == n)).collect()
}

#[cfg(test)]
mod tests {

    #[test]
    fn groups_copies_of_the_same_movie() {
        let mk = |id: &str, src: &str, title: &str, year: Option<u16>, poster: bool| VodItem {
            id: id.into(),
            source_id: src.into(),
            kind: Some(VodKind::Movie),
            title: title.into(),
            year,
            poster: poster.then(|| format!("{id}.jpg")),
            url: Some(format!("http://{src}/{id}.mp4")),
            ..Default::default()
        };
        let out = group_copies(vec![
            mk("a", "s1", "Le Grand Bleu", Some(1988), false),
            mk("b", "s2", "le grand bleu", None, true),
            mk("c", "s3", "Le Grand Bleu", Some(2024), true),
            VodItem { kind: Some(VodKind::Music), ..mk("d", "s1", "Intro", None, false) },
            VodItem { kind: Some(VodKind::Music), ..mk("e", "s2", "Intro", None, false) },
        ]);
        assert_eq!(out.len(), 4);
        // La copie avec affiche représente le groupe ; l'année connue est reprise.
        assert_eq!(out[0].id, "b");
        assert_eq!(out[0].year, Some(1988));
        assert_eq!(out[0].alternates.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["a"]);
        assert_eq!(out[1].id, "c");
        assert_eq!(find_copy(&out, "a").map(|i| i.id.as_str()), Some("a"));
    }
    use super::*;

    #[test]
    fn parses_titles() {
        assert_eq!(parse_title("FR| Le Grand Voyage (2019) [1080p]"), ParsedTitle { title: "Le Grand Voyage".into(), year: Some(2019), ..Default::default() });
        assert_eq!(parse_title("Ma Série S02 E05"), ParsedTitle { title: "Ma Série".into(), season: Some(2), episode: Some(5), ..Default::default() });
        assert_eq!(parse_title("Show.Name.1x03.VOSTFR"), ParsedTitle { title: "Show Name".into(), season: Some(1), episode: Some(3), ..Default::default() });
        assert_eq!(parse_title("Blade Runner 2049").year, None, "un nombre dans le titre n'est pas une année isolée en fin");
        assert_eq!(parse_title("Nosferatu - 1922").year, Some(1922));
        assert_eq!(parse_title("1917 (2019)").title, "1917");
        assert_eq!(parse_title("s01e19-THE_CAPTAIN_S_GUEST"), ParsedTitle { title: "THE CAPTAIN S GUEST".into(), season: Some(1), episode: Some(19), ..Default::default() });
        assert_eq!(parse_title("New Job! ( Charles Chaplin-1915)"), ParsedTitle { title: "New Job! (Charles Chaplin)".into(), year: Some(1915), ..Default::default() });
    }

    fn ch(name: &str, group: &str, url: &str) -> Channel {
        Channel { name: name.into(), group: Some(group.into()), url: url.into(), ..Default::default() }
    }

    #[test]
    fn classifies_and_groups_series() {
        assert_eq!(classify_m3u(&ch("News", "Info", "http://x/live.m3u8")), None);
        assert_eq!(classify_m3u(&ch("Film", "Films", "http://x/movie/u/p/1.mkv")), Some(VodKind::Movie));
        assert_eq!(classify_m3u(&ch("Track", "Music", "http://x/a.mp3")), Some(VodKind::Music));
        let e1 = ch("Show S01E02", "Séries", "http://x/series/u/p/2.mkv");
        let e2 = ch("Show S01E01", "Séries", "http://x/series/u/p/1.mkv");
        let items = from_m3u_entries(vec![(VodKind::Series, e1), (VodKind::Series, e2)], "s");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Show");
        assert_eq!(items[0].episodes.iter().map(|e| e.episode).collect::<Vec<_>>(), vec![1, 2]);
    }

    fn item(title: &str, langs: &[&str], cast: &[&str], added: i64) -> VodItem {
        VodItem {
            id: title.into(),
            title: title.into(),
            raw_name: title.into(),
            kind: Some(VodKind::Movie),
            languages: langs.iter().map(|s| s.to_string()).collect(),
            cast: cast.iter().map(|s| s.to_string()).collect(),
            added: Some(added),
            ..Default::default()
        }
    }

    #[test]
    fn searches_by_field_and_sorts_by_language() {
        let items = vec![
            item("La Nuit", &["en"], &["Jean Acteur"], 1),
            item("Nuit Blanche", &["fr"], &[], 2),
            item("Le Jour", &["de"], &["Jean Acteur"], 3),
        ];
        let prefs = vec!["fr".to_string(), "en".to_string()];
        let q = |text: &str, field| VodQuery { text: Some(text.into()), field, prefer_languages: prefs.clone(), ..Default::default() };
        let titles = |p: VodPage| p.items.into_iter().map(|i| i.title).collect::<Vec<_>>();
        assert_eq!(titles(query(&items, &q("nuit", SearchField::All))), vec!["Nuit Blanche", "La Nuit"]);
        assert_eq!(titles(query(&items, &q("jean acteur", SearchField::Actor))), vec!["La Nuit", "Le Jour"]);
        assert!(query(&items, &q("jean", SearchField::Title)).items.is_empty());
        let browse = query(&items, &VodQuery { prefer_languages: prefs.clone(), ..Default::default() });
        assert_eq!(titles(browse), vec!["Nuit Blanche", "La Nuit", "Le Jour"]);
        assert_eq!(with_person(&items, "JEAN ACTEUR").len(), 2);
        assert_eq!(match_filmography(&items, &[("le jour".into(), None, None)]).len(), 1);
        let mine = query(&items, &VodQuery { any_languages: Some(prefs.clone()), ..Default::default() });
        assert_eq!(mine.total, 2, "« Mes langues » exclut l'allemand");
    }
}
