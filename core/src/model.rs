use serde::{Deserialize, Serialize};

/// Une chaîne (ou un flux) issue d'une source de l'utilisateur.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    /// Identifiant stable : `<source_id>:<clé>`.
    pub id: String,
    pub source_id: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// `tvg-id` : clé de correspondance avec le guide XMLTV.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvg_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvg_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catchup: Option<Catchup>,
    /// Langues détectées (ISO 639-1), la plus probable d'abord.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub languages: Vec<String>,
    /// Pays (ISO 3166-1 alpha-2).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub countries: Vec<String>,
    /// Chaîne explicitement destinée aux adultes (nom, groupe ou indicateur de la source).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub adult: bool,
}

/// Capacité de replay (catch-up) annoncée par la source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Catchup {
    /// Modèle d'URL M3U (`catchup-source`) avec variables `{utc}`, `${start}`, etc.
    /// `append` = vrai si le modèle s'ajoute à l'URL du flux (catchup="append").
    Template { template: String, append: bool, days: u32 },
    /// Archive Xtream Codes (`tv_archive=1`).
    Xtream { server: String, username: String, password: String, stream_id: u64, days: u32 },
    /// Style Flussonic : `<base>/index-<start>-<duration>.m3u8` ou `archive-...`.
    Flussonic { days: u32 },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub channels: Vec<Channel>,
    /// Films, épisodes, musique et radios trouvés dans la source.
    #[serde(default)]
    pub vod: Vec<crate::vod::VodItem>,
    /// URLs de guide annoncées dans l'en-tête (`url-tvg`, `x-tvg-url`).
    pub epg_urls: Vec<String>,
}

/// Un programme du guide. Les heures sont des timestamps Unix (secondes, UTC).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Programme {
    pub start: i64,
    pub stop: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode: Option<String>,
    /// Âge minimal recommandé (CSA, PEGI, FSK, MPAA, TV Parental Guidelines…).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age: Option<u8>,
}

/// Source configurée par l'utilisateur.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SourceKind {
    M3uUrl { url: String },
    M3uText { content: String },
    Xtream { server: String, username: String, password: String, #[serde(default)] output: Option<String> },
    /// Collection Internet Archive (domaine public / licences libres).
    Archive { collection: String, mediatype: String, content: crate::vod::VodKind, #[serde(default = "default_rows")] rows: usize },
    /// Annuaire Radio Browser, filtré par pays.
    RadioBrowser { #[serde(default)] countries: Vec<String> },
    /// Classement Apple Podcasts des pays donnés.
    Podcasts { #[serde(default)] countries: Vec<String> },
    /// Livres audio LibriVox dans les langues données.
    Librivox { #[serde(default)] languages: Vec<String> },
    /// Serveur multimédia personnel Jellyfin ou Emby (jeton obtenu à la connexion).
    Jellyfin { server: String, user_id: String, token: String },
}

fn default_rows() -> usize {
    1000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub kind: SourceKind,
    /// Guides XMLTV supplémentaires saisis par l'utilisateur.
    #[serde(default)]
    pub epg_urls: Vec<String>,
}
