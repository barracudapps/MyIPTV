//! Analyse d'une source importée par l'utilisateur : repère les signaux typiques
//! des listes IPTV illégales (chaînes premium payantes, catalogues VOD récents,
//! URL de revendeurs) afin d'avertir l'utilisateur AVANT l'import.
//! Ce module ne fournit et ne référence aucune liste : il n'inspecte que celle de l'utilisateur.

use serde::Serialize;

use crate::model::Channel;

/// Marques de chaînes ou services exclusivement payants dans la plupart des pays.
const PREMIUM: &[&str] = &[
    "bein", "canal+", "canal plus", "canalplus", "sky sport", "sky cinema", "sky atlantic", "dazn", "rmc sport",
    "hbo", "netflix", "disney+", "disney plus", "prime video", "amazon prime", "apple tv+", "paramount+", "ocs ",
    "showtime", "starz", "cinemax", "espn+", "movistar", "ziggo sport", "sport tv", "supersport", "osn ", "tnt sports",
    "bt sport", "eleven sports", "eurosport 2", "premier sports", "nfl game pass", "nba league pass", "ufc fight pass",
    "ppv", "pay per view", "golf+", "ciné+", "cine+", "multisports", "foot+", "infosport+",
];

const VOD_GROUP_HINTS: &[&str] = &["vod", "films", "movies", "séries", "series", "box office", "netflix", "cinéma", "cinema", "24/7"];

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskReport {
    pub level: RiskLevel,
    pub premium_count: usize,
    pub vod_count: usize,
    pub reseller_url_count: usize,
    pub total: usize,
    /// Quelques exemples de noms ayant déclenché l'alerte.
    pub examples: Vec<String>,
    /// Raisons lisibles, en français.
    pub reasons: Vec<String>,
}

fn is_reseller_url(url: &str) -> bool {
    // Schéma Xtream dans une M3U : /live/<user>/<pass>/<id>.ts, /movie/..., /series/...
    let path = url.split("://").nth(1).and_then(|r| r.split_once('/')).map(|(_, p)| p).unwrap_or("");
    let parts: Vec<&str> = path.split('/').collect();
    parts.len() == 4 && matches!(parts[0], "live" | "movie" | "series") && parts[3].split('.').next().is_some_and(|id| id.chars().all(|c| c.is_ascii_digit()))
}

pub fn analyze(channels: &[Channel]) -> RiskReport {
    let mut premium = 0;
    let mut vod = 0;
    let mut reseller = 0;
    let mut examples = Vec::new();
    for c in channels {
        let hay = format!(" {} | {} ", c.name.to_lowercase(), c.group.as_deref().unwrap_or("").to_lowercase());
        let is_premium = PREMIUM.iter().any(|k| hay.contains(k));
        let url_l = c.url.to_lowercase();
        let is_vod = url_l.contains("/movie/") || url_l.contains("/series/") || url_l.ends_with(".mkv") || url_l.ends_with(".mp4")
            || c.group.as_deref().is_some_and(|g| {
                let g = g.to_lowercase();
                VOD_GROUP_HINTS.iter().any(|h| g.contains(h))
            });
        if is_premium {
            premium += 1;
            if examples.len() < 8 {
                examples.push(c.name.clone());
            }
        }
        if is_vod {
            vod += 1;
        }
        if is_reseller_url(&c.url) {
            reseller += 1;
        }
    }

    let mut reasons = Vec::new();
    if premium > 0 {
        reasons.push(format!("{premium} chaîne(s) portant le nom de services payants (sport, cinéma, plateformes de streaming)."));
    }
    if vod > 20 {
        reasons.push(format!("{vod} films/séries ou groupes de type VOD : les catalogues récents ne sont jamais diffusés gratuitement en IPTV."));
    }
    if reseller > 20 {
        reasons.push(format!("{reseller} URL au format d'un panneau de revente (identifiant/mot de passe dans l'adresse)."));
    }

    let level = if premium >= 10 || (premium >= 3 && (vod > 50 || reseller > 50)) || vod > 200 {
        RiskLevel::High
    } else if premium >= 3 || vod > 20 || reseller > 20 {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    };

    RiskReport { level, premium_count: premium, vod_count: vod, reseller_url_count: reseller, total: channels.len(), examples, reasons }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(name: &str, group: &str, url: &str) -> Channel {
        Channel { name: name.into(), group: Some(group.into()), url: url.into(), ..Default::default() }
    }

    #[test]
    fn free_list_is_low() {
        let list = vec![c("France 24", "News", "https://a/f24.m3u8"), c("Arte", "Culture", "https://a/arte.m3u8")];
        assert_eq!(analyze(&list).level, RiskLevel::Low);
    }

    #[test]
    fn premium_reseller_list_is_high() {
        let mut list = Vec::new();
        for i in 0..12 {
            list.push(c(&format!("FR| BEIN SPORTS {i} FHD"), "SPORTS", &format!("http://h:8080/live/u/p/{i}.ts")));
        }
        let r = analyze(&list);
        assert_eq!(r.level, RiskLevel::High);
        assert_eq!(r.premium_count, 12);
        assert!(!r.reasons.is_empty());
    }
}
