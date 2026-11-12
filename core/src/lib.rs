//! `iptv-core` : logique métier partagée de MyIPTV.
//!
//! - compilée en natif pour l'application Tauri (macOS, Windows, Linux, Android) ;
//! - compilée en WebAssembly (`--features wasm`) pour les smart TV (Tizen, webOS) et le navigateur.
//!
//! Aucune dépendance réseau : la plateforme télécharge, le cœur analyse.

pub mod catalogs;
pub mod catchup;
pub mod jellyfin;
pub mod lang;
pub mod m3u;
pub mod model;
pub mod parental;
pub mod risk;
pub mod tmdb;
pub mod util;
pub mod vod;
pub mod xmltv;
pub mod xtream;
pub mod youtube;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use catchup::catchup_url;
pub use m3u::parse_m3u;
pub use model::*;
pub use risk::{analyze, RiskLevel, RiskReport};
pub use vod::{VodDetail, VodItem, VodKind};
pub use xmltv::{parse_xmltv, Epg, EpgFilter};
