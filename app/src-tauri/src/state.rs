use std::collections::HashMap;
use std::path::PathBuf;

use iptv_core::{Channel, Epg, VodDetail, VodItem};
use tokio::sync::{Mutex, RwLock};

use crate::timeshift::{Session, Upstream};
use crate::transcode::Probe;

pub struct AppState {
    pub http: reqwest::Client,
    pub cache_dir: PathBuf,
    pub port: u16,
    /// Chaînes chargées, par source.
    pub channels: RwLock<HashMap<String, Vec<Channel>>>,
    pub epg: RwLock<Epg>,
    /// Films, séries, radios… par source, et vue à plat pour les requêtes.
    pub vod: RwLock<HashMap<String, Vec<VodItem>>>,
    pub vod_all: RwLock<Vec<VodItem>>,
    /// Fiches détaillées déjà assemblées pendant la session.
    pub details: Mutex<HashMap<String, VodDetail>>,
    /// Session de lecture en direct (une seule à la fois).
    pub session: Mutex<Option<Session>>,
    /// Fichier en cours de conversion à la volée (flux et analyse ffprobe).
    pub remux: Mutex<Option<(String, Upstream, Probe)>>,
    pub recorder: std::sync::Arc<crate::recorder::Recorder>,
    /// Source Jellyfin -> identifiant utilisateur (nécessaire aux requêtes de détail).
    pub jellyfin_users: Mutex<HashMap<String, String>>,
    /// Lien de chaîne YouTube -> lecteur intégré.
    pub youtube_cache: Mutex<HashMap<String, String>>,
}

impl AppState {
    pub fn new(cache_dir: PathBuf, recordings_dir: PathBuf, port: u16) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .pool_idle_timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("client HTTP");
        let _ = std::fs::create_dir_all(cache_dir.join("sources"));
        let _ = std::fs::create_dir_all(cache_dir.join("epg"));
        let _ = std::fs::create_dir_all(cache_dir.join("meta"));
        // Les sessions de timeshift d'un lancement précédent sont obsolètes.
        let _ = std::fs::remove_dir_all(cache_dir.join("timeshift"));
        let recorder = crate::recorder::Recorder::new(recordings_dir, http.clone());
        Self {
            recorder,
            http,
            cache_dir,
            port,
            channels: RwLock::new(HashMap::new()),
            epg: RwLock::new(Epg::default()),
            vod: RwLock::new(HashMap::new()),
            vod_all: RwLock::new(Vec::new()),
            details: Mutex::new(HashMap::new()),
            session: Mutex::new(None),
            remux: Mutex::new(None),
            jellyfin_users: Mutex::new(HashMap::new()),
            youtube_cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn set_vod(&self, source_id: &str, items: Vec<VodItem>) {
        let mut map = self.vod.write().await;
        if items.is_empty() {
            map.remove(source_id);
        } else {
            map.insert(source_id.to_string(), items);
        }
        let mut ids: Vec<&String> = map.keys().collect();
        ids.sort();
        *self.vod_all.write().await = ids.into_iter().flat_map(|k| map[k].iter().cloned()).collect();
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}
