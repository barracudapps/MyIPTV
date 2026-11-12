//! Détection des langues d'une chaîne ou d'un contenu (codes ISO 639-1).
//!
//! Sources, par ordre de fiabilité : attribut `tvg-language`, préfixes et
//! balises usuels des listes IPTV (« FR| », « [VF] », « VOSTFR »…), pays.

/// (code ISO 639-1, alias reconnus : codes 639-2/3, noms anglais, natifs et français)
const LANGS: &[(&str, &[&str])] = &[
    ("fr", &["fr", "fra", "fre", "french", "français", "francais"]),
    ("en", &["en", "eng", "english", "anglais"]),
    ("es", &["es", "spa", "spanish", "español", "espanol", "espagnol", "castellano"]),
    ("de", &["de", "deu", "ger", "german", "deutsch", "allemand"]),
    ("it", &["it", "ita", "italian", "italiano", "italien"]),
    ("pt", &["pt", "por", "portuguese", "português", "portugues", "portugais"]),
    ("nl", &["nl", "nld", "dut", "dutch", "nederlands", "néerlandais", "neerlandais", "flemish"]),
    ("ar", &["ar", "ara", "arabic", "عربي", "arabe"]),
    ("tr", &["tr", "tur", "turkish", "türkçe", "turc"]),
    ("ru", &["ru", "rus", "russian", "русский", "russe"]),
    ("pl", &["pl", "pol", "polish", "polski", "polonais"]),
    ("ro", &["ro", "ron", "rum", "romanian", "română", "roumain"]),
    ("el", &["el", "ell", "gre", "greek", "ελληνικά", "grec"]),
    ("sv", &["sv", "swe", "swedish", "svenska", "suédois"]),
    ("da", &["da", "dan", "danish", "dansk", "danois"]),
    ("no", &["no", "nor", "nob", "norwegian", "norsk", "norvégien"]),
    ("fi", &["fi", "fin", "finnish", "suomi", "finnois"]),
    ("hu", &["hu", "hun", "hungarian", "magyar", "hongrois"]),
    ("cs", &["cs", "ces", "cze", "czech", "čeština", "tchèque"]),
    ("uk", &["uk", "ukr", "ukrainian", "українська", "ukrainien"]),
    ("he", &["he", "heb", "hebrew", "עברית", "hébreu"]),
    ("fa", &["fa", "fas", "per", "persian", "farsi", "persan"]),
    ("hi", &["hi", "hin", "hindi"]),
    ("ur", &["ur", "urd", "urdu", "ourdou"]),
    ("bn", &["bn", "ben", "bengali"]),
    ("ta", &["ta", "tam", "tamil", "tamoul"]),
    ("zh", &["zh", "zho", "chi", "chinese", "mandarin", "中文", "chinois"]),
    ("ja", &["ja", "jpn", "japanese", "日本語", "japonais"]),
    ("ko", &["ko", "kor", "korean", "한국어", "coréen"]),
    ("vi", &["vi", "vie", "vietnamese", "tiếng việt", "vietnamien"]),
    ("th", &["th", "tha", "thai", "thaï"]),
    ("id", &["id", "ind", "indonesian", "bahasa indonesia", "indonésien"]),
    ("sq", &["sq", "sqi", "alb", "albanian", "shqip", "albanais"]),
    ("sr", &["sr", "srp", "serbian", "srpski", "serbe"]),
    ("hr", &["hr", "hrv", "croatian", "hrvatski", "croate"]),
    ("bg", &["bg", "bul", "bulgarian", "български", "bulgare"]),
    ("ku", &["ku", "kur", "kurdish", "kurdî", "kurde"]),
];

/// Préfixes de pays utilisés dans les listes, convertis en langue.
const COUNTRY_LANG: &[(&str, &str)] = &[
    ("fr", "fr"), ("uk", "en"), ("gb", "en"), ("us", "en"), ("usa", "en"), ("au", "en"), ("ie", "en"), ("nz", "en"),
    ("de", "de"), ("at", "de"), ("es", "es"), ("mx", "es"), ("ar", "ar"), ("it", "it"), ("pt", "pt"), ("br", "pt"),
    ("nl", "nl"), ("tr", "tr"), ("ru", "ru"), ("pl", "pl"), ("ro", "ro"), ("gr", "el"), ("se", "sv"), ("dk", "da"),
    ("no", "no"), ("fi", "fi"), ("hu", "hu"), ("cz", "cs"), ("ua", "uk"), ("il", "he"), ("ir", "fa"), ("in", "hi"),
    ("pk", "ur"), ("cn", "zh"), ("tw", "zh"), ("hk", "zh"), ("jp", "ja"), ("kr", "ko"), ("vn", "vi"), ("th", "th"),
    ("al", "sq"), ("rs", "sr"), ("hr", "hr"), ("bg", "bg"), ("ma", "ar"), ("dz", "ar"), ("tn", "ar"), ("eg", "ar"),
    ("sa", "ar"), ("ae", "ar"), ("qa", "ar"), ("lb", "ar"), ("ex-yu", "sr"), ("latino", "es"), ("lat", "es"),
    ("quebec", "fr"), ("qc", "fr"), ("arab", "ar"), ("afr", "fr"),
];

/// Balises de version courantes.
const TAGS: &[(&str, &[&str])] = &[
    ("fr", &["vf", "vff", "vfq", "vfi", "truefrench", "vostfr", "multi-fr"]),
    ("en", &["vo", "vost-en", "eng-sub"]),
];

pub fn aliases(code: &str) -> Option<&'static [&'static str]> {
    LANGS.iter().find(|(c, _)| *c == code).map(|(_, a)| *a)
}

pub fn code_from_alias(s: &str) -> Option<&'static str> {
    let s = s.trim().to_lowercase();
    LANGS.iter().find(|(_, aliases)| aliases.contains(&s.as_str())).map(|(c, _)| *c)
}

pub fn lang_from_country(country: &str) -> Option<&'static str> {
    let c = country.trim().to_lowercase();
    COUNTRY_LANG.iter().find(|(k, _)| *k == c).map(|(_, l)| *l)
}

fn push(out: &mut Vec<String>, code: &str) {
    if !out.iter().any(|c| c == code) {
        out.push(code.to_string());
    }
}

/// Préfixe en tête du nom : « FR| », « FR: », « FR - », « [FR] », « (FR) », « |FR| ».
pub(crate) fn leading_prefix(name: &str) -> Option<String> {
    let t = name.trim_start().trim_start_matches(['|', '[', '(', '#', '★', '•', ' ']);
    let end = t.find(['|', ']', ')', ':', '-', ' ', '.'])?;
    let token = &t[..end];
    let sep = t[end..].chars().next()?;
    // Un mot isolé suivi d'un espace n'est un préfixe que s'il est en majuscules (« FR Film »).
    if sep == ' ' && token.chars().any(|c| c.is_lowercase()) {
        return None;
    }
    (2..=6).contains(&token.chars().count()).then(|| token.to_lowercase())
}

/// Langues détectées, la plus probable d'abord.
pub fn detect(name: &str, group: Option<&str>, tvg_language: Option<&str>, country: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(l) = tvg_language {
        for part in l.split([';', ',', '/']) {
            if let Some(c) = code_from_alias(part) {
                push(&mut out, c);
            }
        }
    }
    for text in [Some(name), group].into_iter().flatten() {
        if let Some(p) = leading_prefix(text) {
            if let Some(c) = lang_from_country(&p).or_else(|| code_from_alias(&p)) {
                push(&mut out, c);
            }
        }
        let lower = text.to_lowercase();
        for word in lower.split(|c: char| !c.is_alphanumeric() && c != '-') {
            for (code, tags) in TAGS {
                if tags.contains(&word) {
                    push(&mut out, code);
                }
            }
        }
    }
    if out.is_empty() {
        if let Some(c) = country {
            for part in c.split([';', ',']) {
                if let Some(l) = lang_from_country(part) {
                    push(&mut out, l);
                }
            }
        }
    }
    out
}

/// Rang d'un contenu selon les langues favorites (0 = première langue favorite).
/// Les contenus sans langue favorite passent après, dans l'ordre d'origine.
pub fn rank(langs: &[String], prefs: &[String]) -> usize {
    prefs.iter().position(|p| langs.iter().any(|l| l == p)).unwrap_or(prefs.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_from_attributes_prefixes_tags_and_country() {
        assert_eq!(detect("TF1", None, Some("French"), None), vec!["fr"]);
        assert_eq!(detect("FR| Canal Info HD", None, None, None), vec!["fr"]);
        assert_eq!(detect("[UK] News 24", None, None, None), vec!["en"]);
        assert_eq!(detect("Un film (2020) VOSTFR", Some("Films"), None, None), vec!["fr"]);
        assert_eq!(detect("Rai 1", None, None, Some("IT")), vec!["it"]);
        assert_eq!(detect("AR: قناة", Some("Arabic"), None, None), vec!["ar"]);
        assert!(detect("Frozen Planet", None, None, None).is_empty(), "un mot ordinaire n'est pas un préfixe");
        assert_eq!(detect("Eurosport", None, Some("English;French"), None), vec!["en", "fr"]);
    }

    #[test]
    fn ranks_by_preference_order() {
        let prefs = vec!["fr".to_string(), "en".to_string()];
        assert_eq!(rank(&["en".into()], &prefs), 1);
        assert_eq!(rank(&["de".into(), "fr".into()], &prefs), 0);
        assert_eq!(rank(&[], &prefs), 2);
    }
}
