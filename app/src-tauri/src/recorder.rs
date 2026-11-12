//! Enregistrements programmés : le direct d'une chaîne est copié sur disque entre
//! deux heures (avec marges). ffmpeg gère HLS et MPEG-TS ; sans ffmpeg, les flux
//! MPEG-TS sont copiés directement.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use iptv_core::Channel;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::timeshift::Upstream;
use crate::transcode::find_tool;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecStatus {
    Scheduled,
    Recording,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub channel: Channel,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    /// Heures du programme (timestamps Unix) ; l'enregistrement ajoute les marges.
    pub start: i64,
    pub stop: i64,
    pub pad_before: i64,
    pub pad_after: i64,
    pub status: RecStatus,
    pub file: Option<String>,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Profil qui a programmé l'enregistrement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
}

impl Recording {
    pub fn window(&self) -> (i64, i64) {
        (self.start - self.pad_before, self.stop + self.pad_after)
    }
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Nom de fichier lisible : « 2026-11-12 20h50 - Chaîne - Titre.ts ».
pub fn file_name(r: &Recording) -> String {
    let date = chrono::DateTime::<chrono::Utc>::from_timestamp(r.start, 0)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %Hh%M").to_string())
        .unwrap_or_default();
    let clean = |s: &str| s.chars().map(|c| if r#"/\:*?"<>|"#.contains(c) || c.is_control() { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    let mut name = format!("{date} - {} - {}", clean(&r.channel.name), clean(&r.title));
    name.truncate(150);
    format!("{name}.ts")
}

pub struct Recorder {
    pub dir: PathBuf,
    index: PathBuf,
    pub list: Mutex<Vec<Recording>>,
    http: reqwest::Client,
    /// Tâches en cours (une par enregistrement actif).
    running: Mutex<std::collections::HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl Recorder {
    pub fn new(dir: PathBuf, http: reqwest::Client) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&dir);
        let index = dir.join("recordings.json");
        let mut list: Vec<Recording> = std::fs::read(&index).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        // Un enregistrement interrompu par la fermeture de l'application reprend s'il n'est pas terminé.
        for r in list.iter_mut().filter(|r| r.status == RecStatus::Recording) {
            r.status = if r.window().1 > now() { RecStatus::Scheduled } else { RecStatus::Done };
        }
        Arc::new(Recorder { dir, index, list: Mutex::new(list), http, running: Mutex::new(Default::default()) })
    }

    async fn save(&self) {
        let list = self.list.lock().await;
        let _ = std::fs::write(&self.index, serde_json::to_vec_pretty(&*list).unwrap_or_default());
    }

    pub async fn schedule(self: &Arc<Self>, mut r: Recording) -> Recording {
        r.status = RecStatus::Scheduled;
        self.list.lock().await.push(r.clone());
        self.save().await;
        self.tick().await;
        r
    }

    pub async fn cancel(self: &Arc<Self>, id: &str, delete_file: bool) {
        if let Some(h) = self.running.lock().await.remove(id) {
            h.abort();
        }
        let mut list = self.list.lock().await;
        if let Some(pos) = list.iter().position(|r| r.id == id) {
            let r = &mut list[pos];
            if delete_file {
                if let Some(f) = &r.file {
                    let _ = std::fs::remove_file(self.dir.join(f));
                }
                list.remove(pos);
            } else if matches!(r.status, RecStatus::Scheduled | RecStatus::Recording) {
                r.status = if r.status == RecStatus::Recording { RecStatus::Done } else { RecStatus::Cancelled };
            }
        }
        drop(list);
        self.save().await;
    }

    /// Démarre les enregistrements dont l'heure est venue ; appelé toutes les 10 s.
    pub async fn tick(self: &Arc<Self>) {
        let t = now();
        let due: Vec<Recording> = {
            let mut list = self.list.lock().await;
            list.iter_mut()
                .filter(|r| r.status == RecStatus::Scheduled && r.window().0 <= t)
                .map(|r| {
                    if r.window().1 <= t {
                        r.status = RecStatus::Failed;
                        r.error = Some("Heure de fin dépassée (application fermée ?)".into());
                        None
                    } else {
                        r.status = RecStatus::Recording;
                        r.file = Some(file_name(r));
                        Some(r.clone())
                    }
                })
                .flatten()
                .collect()
        };
        for r in due {
            let me = self.clone();
            let id = r.id.clone();
            let h = tokio::spawn(async move { me.run(r).await });
            self.running.lock().await.insert(id, h);
        }
        // Taille des fichiers en cours.
        let mut list = self.list.lock().await;
        for r in list.iter_mut().filter(|r| r.status == RecStatus::Recording) {
            if let Some(f) = &r.file {
                r.size = std::fs::metadata(self.dir.join(f)).map(|m| m.len()).unwrap_or(0);
            }
        }
        drop(list);
        self.save().await;
    }

    async fn run(self: Arc<Self>, r: Recording) {
        let path = self.dir.join(r.file.as_deref().unwrap_or("enregistrement.ts"));
        let up = Upstream { url: r.channel.url.clone(), user_agent: r.channel.user_agent.clone(), referrer: r.channel.referrer.clone() };
        let end = r.window().1;
        let result = match find_tool("ffmpeg") {
            Some(ffmpeg) => record_ffmpeg(&ffmpeg, &self.http, &up, &path, end).await,
            None => record_raw(&self.http, &up, &path, end).await,
        };
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let mut list = self.list.lock().await;
        if let Some(x) = list.iter_mut().find(|x| x.id == r.id) {
            x.size = size;
            match result {
                Ok(()) if size > 0 => x.status = RecStatus::Done,
                Ok(()) => {
                    x.status = RecStatus::Failed;
                    x.error = Some("Aucune donnée reçue de la chaîne.".into());
                }
                Err(e) => {
                    x.status = if size > 1_000_000 { RecStatus::Done } else { RecStatus::Failed };
                    x.error = Some(e);
                }
            }
        }
        drop(list);
        self.running.lock().await.remove(&r.id);
        self.save().await;
    }

    pub fn start_loop(self: &Arc<Self>) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                me.tick().await;
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });
    }
}

/// Playlist HLS « maître » : on enregistre uniquement la meilleure qualité (sinon ffmpeg
/// enregistre toutes les variantes à la fois).
async fn resolve_variant(http: &reqwest::Client, up: &Upstream) -> String {
    if !up.url.to_lowercase().contains(".m3u8") {
        return up.url.clone();
    }
    let Ok(resp) = http.get(&up.url).headers(up.headers()).send().await else { return up.url.clone() };
    let base = resp.url().clone();
    match resp.text().await {
        Ok(body) if body.contains("#EXT-X-STREAM-INF") => crate::timeshift::best_variant(&base, &body).map(|u| u.to_string()).unwrap_or_else(|| up.url.clone()),
        _ => up.url.clone(),
    }
}

/// ffmpeg copie le flux sans réencodage jusqu'à l'heure de fin réelle. Il n'utilise pas `-t` :
/// sur un direct HLS il lit d'abord en accéléré les segments déjà publiés et s'arrêterait trop tôt.
/// En cas de coupure, l'enregistrement reprend dans un segment ajouté au fichier.
async fn record_ffmpeg(ffmpeg: &Path, http: &reqwest::Client, up: &Upstream, path: &Path, end: i64) -> Result<(), String> {
    let url = resolve_variant(http, up).await;
    let mut attempt = 0;
    let mut last_error = String::new();
    loop {
        if end - now() <= 2 {
            return Ok(());
        }
        let part = if attempt == 0 { path.to_path_buf() } else { path.with_extension(format!("part{attempt}.ts")) };
        let mut cmd = tokio::process::Command::new(ffmpeg);
        cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-user_agent", up.user_agent.as_deref().unwrap_or(crate::timeshift::DEFAULT_UA)]);
        if let Some(r) = &up.referrer {
            cmd.args(["-headers", &format!("Referer: {r}\r\n")]);
        }
        cmd.args(["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10", "-i", &url, "-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy", "-f", "mpegts"])
            .arg(&part)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| format!("ffmpeg : {e}"))?;
        let deadline = Duration::from_secs((end - now()).max(1) as u64);
        let finished_early = tokio::select! {
            out = child.wait() => {
                if let Some(mut err) = child.stderr.take() {
                    let mut buf = String::new();
                    let _ = tokio::io::AsyncReadExt::read_to_string(&mut err, &mut buf).await;
                    last_error = buf.lines().last().unwrap_or("flux interrompu").to_string();
                }
                out.is_ok()
            }
            _ = tokio::time::sleep(deadline) => {
                // MPEG-TS supporte un arrêt brutal : le fichier reste lisible.
                let _ = child.kill().await;
                false
            }
        };
        if attempt > 0 {
            append(path, &part).await;
        }
        if !finished_early || end - now() <= 5 {
            return Ok(());
        }
        attempt += 1;
        if attempt > 30 {
            return Err(last_error);
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn append(dst: &Path, part: &Path) {
    if let (Ok(bytes), Ok(mut f)) = (tokio::fs::read(part).await, tokio::fs::OpenOptions::new().append(true).create(true).open(dst).await) {
        let _ = f.write_all(&bytes).await;
    }
    let _ = tokio::fs::remove_file(part).await;
}

/// Sans ffmpeg : copie directe d'un flux MPEG-TS continu.
async fn record_raw(http: &reqwest::Client, up: &Upstream, path: &Path, end: i64) -> Result<(), String> {
    if up.url.to_lowercase().contains(".m3u8") {
        return Err("Enregistrer un flux HLS nécessite ffmpeg.".into());
    }
    let mut file = tokio::fs::OpenOptions::new().create(true).append(true).open(path).await.map_err(|e| e.to_string())?;
    while now() < end {
        let resp = http.get(&up.url).headers(up.headers()).send().await.map_err(|e| e.to_string())?;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(b) => file.write_all(&b).await.map_err(|e| e.to_string())?,
                Err(_) => break,
            }
            if now() >= end {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_safe_file_names() {
        let r = Recording {
            id: "1".into(),
            channel: Channel { name: "Chaîne/Info".into(), ..Default::default() },
            title: "Le \"grand\" débat : épisode 1?".into(),
            subtitle: None,
            start: 1_794_488_400,
            stop: 1_794_492_000,
            pad_before: 120,
            pad_after: 300,
            status: RecStatus::Scheduled,
            file: None,
            size: 0,
            error: None,
            profile_id: None,
        };
        let n = file_name(&r);
        assert!(n.ends_with(" - Chaîne Info - Le grand débat épisode 1.ts"), "{n}");
        assert_eq!(r.window(), (1_794_488_280, 1_794_492_300));
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// `STREAM_URL=… cargo test -p myiptv live_record -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn live_record_real_stream() {
        let url = std::env::var("STREAM_URL").expect("STREAM_URL");
        let dir = std::env::temp_dir().join("myiptv-rec-live");
        let _ = std::fs::remove_dir_all(&dir);
        let rec = Recorder::new(dir.clone(), reqwest::Client::new());
        let t = now();
        rec.schedule(Recording {
            id: "live".into(),
            channel: Channel { id: "c".into(), name: "Test".into(), url, ..Default::default() },
            title: "Essai".into(),
            subtitle: None,
            start: t,
            stop: t + 15,
            pad_before: 0,
            pad_after: 0,
            status: RecStatus::Scheduled,
            file: None,
            size: 0,
            error: None,
            profile_id: None,
        })
        .await;
        assert_eq!(rec.list.lock().await[0].status, RecStatus::Recording);
        tokio::time::sleep(Duration::from_secs(30)).await;
        let r = rec.list.lock().await[0].clone();
        assert_eq!(r.status, RecStatus::Done, "{:?}", r.error);
        assert!(r.size > 200_000 && r.size < 20_000_000, "taille {}", r.size);
        let probe = crate::transcode::probe(&Upstream { url: dir.join(r.file.unwrap()).to_string_lossy().into(), user_agent: None, referrer: None }).await.unwrap();
        assert!(probe.duration.unwrap_or(0.0) >= 10.0, "durée {:?}", probe.duration);
    }
}
