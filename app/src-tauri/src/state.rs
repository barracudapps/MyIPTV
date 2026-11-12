use std::collections::HashMap;
use std::path::PathBuf;

use iptv_core::{Channel, Epg};
use tokio::sync::{Mutex, RwLock};

use crate::timeshift::Session;

pub struct AppState {
    pub http: reqwest::Client,
    pub cache_dir: PathBuf,
    pub port: u16,
    /// Chaînes chargées, par source.
    pub channels: RwLock<HashMap<String, Vec<Channel>>>,
    pub epg: RwLock<Epg>,
    /// Session de lecture en direct (une seule à la fois).
    pub session: Mutex<Option<Session>>,
}

impl AppState {
    pub fn new(cache_dir: PathBuf, port: u16) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .pool_idle_timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("client HTTP");
        let _ = std::fs::create_dir_all(cache_dir.join("sources"));
        let _ = std::fs::create_dir_all(cache_dir.join("epg"));
        // Les sessions de timeshift d'un lancement précédent sont obsolètes.
        let _ = std::fs::remove_dir_all(cache_dir.join("timeshift"));
        Self {
            http,
            cache_dir,
            port,
            channels: RwLock::new(HashMap::new()),
            epg: RwLock::new(Epg::default()),
            session: Mutex::new(None),
        }
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}
