//! Commandes exposées à l'interface (`invoke`).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use iptv_core::util::{maybe_gunzip, stable_key};
use iptv_core::xtream::{live_channels, XtreamAccount};
use iptv_core::{Channel, EpgFilter, Playlist, Programme, RiskReport, Source, SourceKind};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;
use crate::timeshift::{Session, Upstream};

type Res<T> = Result<T, String>;
type St<'a> = State<'a, Arc<AppState>>;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResult {
    pub channels: Vec<Channel>,
    pub epg_urls: Vec<String>,
    pub risk: RiskReport,
    pub fetched_at: i64,
}

#[derive(Serialize, Deserialize)]
struct CachedSource {
    key: String,
    fetched_at: i64,
    playlist: Playlist,
}

const SOURCE_TTL: i64 = 24 * 3600;
const EPG_TTL: u64 = 12 * 3600;

async fn get_text(st: &AppState, url: &str) -> Res<String> {
    let up = Upstream { url: url.into(), user_agent: None, referrer: None };
    let r = st.http.get(url).headers(up.headers()).timeout(Duration::from_secs(120)).send().await.map_err(|e| format!("Téléchargement impossible : {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Le serveur a répondu {}", r.status()));
    }
    let bytes = r.bytes().await.map_err(|e| e.to_string())?;
    let bytes = maybe_gunzip(&bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

async fn fetch_playlist(st: &AppState, src: &Source) -> Res<Playlist> {
    match &src.kind {
        SourceKind::M3uUrl { url } => {
            let text = get_text(st, url).await?;
            if !text.trim_start().trim_start_matches('\u{feff}').starts_with("#EXTM3U") && !text.contains("#EXTINF") {
                return Err("Ce fichier n'est pas une playlist M3U.".into());
            }
            Ok(iptv_core::parse_m3u(&text, &src.id))
        }
        SourceKind::M3uText { content } => Ok(iptv_core::parse_m3u(content, &src.id)),
        SourceKind::Xtream { server, username, password, output } => {
            let acc = XtreamAccount { server, username, password, output: output.as_deref().unwrap_or("ts") };
            let info: serde_json::Value = serde_json::from_str(&get_text(st, &acc.api_url(None)).await?).map_err(|_| "Réponse Xtream invalide (vérifiez l'adresse du serveur).")?;
            if info.get("user_info").and_then(|u| u.get("auth")).and_then(|a| a.as_i64().or_else(|| a.as_str().and_then(|s| s.parse().ok()))) == Some(0) {
                return Err("Identifiants Xtream refusés.".into());
            }
            let cats: serde_json::Value = serde_json::from_str(&get_text(st, &acc.api_url(Some("get_live_categories"))).await?).unwrap_or_default();
            let streams: serde_json::Value = serde_json::from_str(&get_text(st, &acc.api_url(Some("get_live_streams"))).await?).map_err(|e| e.to_string())?;
            Ok(Playlist { channels: live_channels(&acc, &src.id, &cats, &streams), epg_urls: vec![acc.xmltv_url()] })
        }
    }
}

/// Charge une source (depuis le cache si récent). Renvoie aussi l'analyse de risque.
#[tauri::command]
pub async fn load_source(st: St<'_>, source: Source, force: bool) -> Res<SourceResult> {
    let key = stable_key(&[&serde_json::to_string(&source.kind).unwrap_or_default()]);
    let path = st.cache_dir.join("sources").join(format!("{}.json", stable_key(&[&source.id])));
    let cached: Option<CachedSource> = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(|c: &CachedSource| c.key == key);

    let (playlist, fetched_at) = match cached {
        Some(c) if !force && now() - c.fetched_at < SOURCE_TTL => (c.playlist, c.fetched_at),
        cached => match fetch_playlist(&st, &source).await {
            Ok(p) => {
                let c = CachedSource { key, fetched_at: now(), playlist: p };
                let _ = std::fs::write(&path, serde_json::to_vec(&c).unwrap_or_default());
                (c.playlist, c.fetched_at)
            }
            // Hors ligne : on garde la dernière version connue.
            Err(e) => match cached {
                Some(c) => (c.playlist, c.fetched_at),
                None => return Err(e),
            },
        },
    };

    let mut epg_urls = playlist.epg_urls.clone();
    epg_urls.extend(source.epg_urls.iter().cloned());
    let risk = iptv_core::analyze(&playlist.channels);
    st.channels.write().await.insert(source.id.clone(), playlist.channels.clone());
    Ok(SourceResult { channels: playlist.channels, epg_urls, risk, fetched_at })
}

/// Télécharge une source sans l'enregistrer, pour l'analyse de risque avant import.
#[tauri::command]
pub async fn preview_source(st: St<'_>, source: Source) -> Res<SourceResult> {
    let p = fetch_playlist(&st, &source).await?;
    let risk = iptv_core::analyze(&p.channels);
    Ok(SourceResult { risk, epg_urls: p.epg_urls, channels: vec![], fetched_at: now() })
}

#[tauri::command]
pub async fn remove_source(st: St<'_>, id: String) -> Res<()> {
    st.channels.write().await.remove(&id);
    let _ = std::fs::remove_file(st.cache_dir.join("sources").join(format!("{}.json", stable_key(&[&id]))));
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgStats {
    pub channels: usize,
    pub programmes: usize,
    pub errors: Vec<String>,
}

/// Télécharge (ou relit du cache) les guides XMLTV et les indexe pour les chaînes chargées.
#[tauri::command]
pub async fn load_epg(st: St<'_>, urls: Vec<String>, force: bool) -> Res<EpgStats> {
    let all: Vec<Channel> = st.channels.read().await.values().flatten().cloned().collect();
    let filter = EpgFilter::for_channels(&all, now() - 8 * 86_400, now() + 4 * 86_400);
    let mut epg = iptv_core::Epg::default();
    let mut errors = vec![];
    let mut seen = std::collections::HashSet::new();
    for url in urls.into_iter().filter(|u| seen.insert(u.clone())) {
        let path = st.cache_dir.join("epg").join(stable_key(&[&url]));
        let fresh = std::fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() < EPG_TTL);
        let bytes = if fresh && !force {
            std::fs::read(&path).map_err(|e| e.to_string())
        } else {
            match get_text(&st, &url).await {
                Ok(t) => {
                    let _ = std::fs::write(&path, t.as_bytes());
                    Ok(t.into_bytes())
                }
                Err(e) => std::fs::read(&path).map_err(|_| e),
            }
        };
        let bytes = match bytes {
            Ok(b) => b,
            Err(e) => {
                errors.push(format!("{url} : {e}"));
                continue;
            }
        };
        let f = filter.clone();
        match tokio::task::spawn_blocking(move || iptv_core::parse_xmltv(&bytes, Some(&f))).await {
            Ok(Ok(parsed)) => epg.merge(parsed),
            Ok(Err(e)) => errors.push(format!("{url} : {e}")),
            Err(e) => errors.push(e.to_string()),
        }
    }
    let stats = EpgStats { channels: epg.programmes.len(), programmes: epg.programmes.values().map(Vec::len).sum(), errors };
    *st.epg.write().await = epg;
    Ok(stats)
}

#[tauri::command]
pub async fn programmes(st: St<'_>, channels: Vec<Channel>, from: i64, to: i64) -> Res<HashMap<String, Vec<Programme>>> {
    let epg = st.epg.read().await;
    Ok(channels.iter().map(|c| (c.id.clone(), epg.for_channel(c, from, to))).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgrammeHit {
    pub channel_id: String,
    pub programme: Programme,
}

/// Recherche plein texte dans le guide (titres et sous-titres), de l'archive aux jours à venir.
#[tauri::command]
pub async fn search_programmes(st: St<'_>, query: String, limit: usize) -> Res<Vec<ProgrammeHit>> {
    let q = iptv_core::util::normalize_name(&query);
    if q.len() < 2 {
        return Ok(vec![]);
    }
    let channels = st.channels.read().await;
    let epg = st.epg.read().await;
    let from = now() - 7 * 86_400;
    let mut hits = Vec::new();
    let mut seen_epg_ids = std::collections::HashSet::new();
    for ch in channels.values().flatten() {
        let Some(id) = epg.resolve(ch) else { continue };
        // Plusieurs chaînes (qualités, sources) partagent le même guide : un seul résultat.
        if !seen_epg_ids.insert(id.to_string()) {
            continue;
        }
        for p in epg.programmes.get(id).into_iter().flatten() {
            if p.stop > from && (iptv_core::util::normalize_name(&p.title).contains(&q) || p.subtitle.as_deref().is_some_and(|s| iptv_core::util::normalize_name(s).contains(&q))) {
                hits.push(ProgrammeHit { channel_id: ch.id.clone(), programme: p.clone() });
            }
        }
    }
    // Les programmes en cours et à venir d'abord, puis les replays récents.
    let t = now();
    hits.sort_by_key(|h| if h.programme.stop > t { h.programme.start - t } else { (t - h.programme.start) + 100 * 86_400 });
    hits.truncate(limit.min(500));
    Ok(hits)
}

#[tauri::command]
pub fn catchup_url(channel: Channel, start: i64, stop: i64) -> Option<String> {
    iptv_core::catchup_url(&channel, start, stop, now())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    pub url: String,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
    /// Direct avec timeshift (enregistrement local) ; sinon lecture simple via le proxy.
    pub timeshift: bool,
    #[serde(default = "default_window")]
    pub window_minutes: u32,
}

fn default_window() -> u32 {
    120
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayInfo {
    pub url: String,
    /// `hls`, `mpegts` ou `native`.
    pub kind: &'static str,
    pub timeshift: bool,
    pub error: Option<String>,
}

fn guess_kind(url: &str, content_type: Option<&str>) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
    let ct = content_type.unwrap_or("").to_lowercase();
    if path.ends_with(".m3u8") || path.ends_with(".m3u") || ct.contains("mpegurl") {
        "hls"
    } else if [".mp4", ".mkv", ".webm", ".mov", ".m4v", ".mp3", ".aac"].iter().any(|e| path.ends_with(e)) || ct.starts_with("video/mp4") || ct.starts_with("audio/") {
        "native"
    } else {
        "mpegts"
    }
}

#[tauri::command]
pub async fn play(st: St<'_>, req: PlayRequest) -> Res<PlayInfo> {
    // Arrête la lecture précédente (supprime son enregistrement).
    st.session.lock().await.take();
    let up = Upstream { url: req.url.clone(), user_agent: req.user_agent.clone(), referrer: req.referrer.clone() };

    let mut ts_error = None;
    if req.timeshift {
        let root = st.cache_dir.join("timeshift");
        let sess = Session::start(st.http.clone(), up.clone(), root, req.window_minutes.max(5) as f64 * 60.0, st.base_url()).map_err(|e| e.to_string())?;
        match sess.wait_ready(Duration::from_secs(20)).await {
            Ok(()) => {
                let url = format!("{}/ts/{}/index.m3u8", st.base_url(), sess.id);
                *st.session.lock().await = Some(sess);
                return Ok(PlayInfo { url, kind: "hls", timeshift: true, error: None });
            }
            Err(e) => ts_error = Some(e), // repli : lecture directe
        }
    }

    let kind = match guess_kind(&req.url, None) {
        "mpegts" if !req.url.to_lowercase().contains(".ts") => {
            // Extension inconnue : on interroge le serveur.
            let ct = st.http.head(&req.url).headers(up.headers()).timeout(Duration::from_secs(8)).send().await.ok()
                .and_then(|r| r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string));
            guess_kind(&req.url, ct.as_deref())
        }
        k => k,
    };
    Ok(PlayInfo { url: crate::server::proxy_url(&st.base_url(), &req.url, &up), kind, timeshift: false, error: ts_error })
}

#[tauri::command]
pub async fn stop_playback(st: St<'_>) -> Res<()> {
    st.session.lock().await.take();
    Ok(())
}

#[tauri::command]
pub async fn timeshift_status(st: St<'_>) -> Res<Option<f64>> {
    Ok(st.session.lock().await.as_ref().map(|s| s.buffered_secs()))
}
