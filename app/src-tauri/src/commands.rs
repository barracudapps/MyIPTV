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
    /// Nombre de contenus par section (films, séries, radio…).
    pub vod_counts: HashMap<String, usize>,
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

/// JSON d'une API publique (en-tête User-Agent explicite : exigé par Radio Browser).
pub(crate) async fn get_json(st: &AppState, url: &str, headers: Option<reqwest::header::HeaderMap>) -> Res<serde_json::Value> {
    let mut req = st.http.get(url).header(reqwest::header::USER_AGENT, "MyIPTV/0.1").timeout(Duration::from_secs(60));
    if let Some(h) = headers {
        req = req.headers(h);
    }
    let r = req.send().await.map_err(|e| format!("Téléchargement impossible : {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Le serveur a répondu {}", r.status()));
    }
    let bytes = r.bytes().await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Réponse invalide : {e}"))
}

async fn fetch_playlist(st: &AppState, src: &Source) -> Res<Playlist> {
    use iptv_core::catalogs as cat;
    let sid = src.id.as_str();
    match &src.kind {
        SourceKind::M3uUrl { url } => {
            let text = get_text(st, url).await?;
            if !text.trim_start().trim_start_matches('\u{feff}').starts_with("#EXTM3U") && !text.contains("#EXTINF") {
                return Err("Ce fichier n'est pas une playlist M3U.".into());
            }
            Ok(iptv_core::parse_m3u(&text, sid))
        }
        SourceKind::M3uText { content } => Ok(iptv_core::parse_m3u(content, sid)),
        SourceKind::Xtream { server, username, password, output } => {
            let acc = XtreamAccount { server, username, password, output: output.as_deref().unwrap_or("ts") };
            let info: serde_json::Value = serde_json::from_str(&get_text(st, &acc.api_url(None)).await?).map_err(|_| "Réponse Xtream invalide (vérifiez l'adresse du serveur).")?;
            if info.get("user_info").and_then(|u| u.get("auth")).and_then(|a| a.as_i64().or_else(|| a.as_str().and_then(|s| s.parse().ok()))) == Some(0) {
                return Err("Identifiants Xtream refusés.".into());
            }
            let json = |action: &'static str| {
                let url = acc.api_url(Some(action));
                async move { get_text(st, &url).await.ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).unwrap_or_default() }
            };
            let (cats, streams, vcats, vstreams, scats, series) = tokio::join!(
                json("get_live_categories"),
                json("get_live_streams"),
                json("get_vod_categories"),
                json("get_vod_streams"),
                json("get_series_categories"),
                json("get_series"),
            );
            let mut vod = iptv_core::xtream::vod_items(&acc, sid, &vcats, &vstreams);
            vod.extend(iptv_core::xtream::series_items(&acc, sid, &scats, &series));
            Ok(Playlist { channels: live_channels(&acc, sid, &cats, &streams), vod, epg_urls: vec![acc.xmltv_url()] })
        }
        SourceKind::Archive { collection, mediatype, content, rows } => {
            let j = get_json(st, &cat::archive_search_url(collection, mediatype, *rows), None).await?;
            Ok(Playlist { vod: cat::archive_items(&j, *content, sid), ..Default::default() })
        }
        SourceKind::RadioBrowser { countries } => {
            let mut urls: Vec<String> = countries.iter().take(8).map(|c| cat::radio_search_url(Some(c), 300)).collect();
            urls.push(cat::radio_search_url(None, 300));
            let mut vod: Vec<iptv_core::VodItem> = Vec::new();
            for u in urls {
                if let Ok(j) = get_json(st, &u, None).await {
                    vod.extend(cat::radio_items(&j, sid));
                }
            }
            let mut seen = std::collections::HashSet::new();
            vod.retain(|i| seen.insert(i.id.clone()));
            if vod.is_empty() {
                return Err("Annuaire des radios injoignable.".into());
            }
            Ok(Playlist { vod, ..Default::default() })
        }
        SourceKind::Podcasts { countries } => {
            let mut vod = Vec::new();
            for c in countries.iter().take(6) {
                let lang = iptv_core::lang::lang_from_country(c);
                let Ok(chart) = get_json(st, &cat::podcast_chart_url(c, 200), None).await else { continue };
                for ids in cat::podcast_chart_ids(&chart).chunks(100) {
                    if let Ok(j) = get_json(st, &cat::podcast_lookup_url(ids, c), None).await {
                        vod.extend(cat::podcast_items(&j, sid, lang));
                    }
                }
            }
            let mut seen = std::collections::HashSet::new();
            vod.retain(|i| seen.insert(i.id.clone()));
            Ok(Playlist { vod, ..Default::default() })
        }
        SourceKind::Librivox { languages } => {
            let mut vod = Vec::new();
            let langs: Vec<Option<&str>> = if languages.is_empty() { vec![None] } else { languages.iter().map(|l| Some(l.as_str())).collect() };
            for l in langs.into_iter().take(6) {
                if let Ok(j) = get_json(st, &cat::librivox_archive_url(l, 400), None).await {
                    let mut items = cat::archive_items(&j, iptv_core::VodKind::Audiobook, sid);
                    for i in items.iter_mut().filter(|i| i.languages.is_empty()) {
                        i.languages = l.map(|x| vec![x.to_string()]).unwrap_or_default();
                    }
                    vod.extend(items);
                }
            }
            Ok(Playlist { vod, ..Default::default() })
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
    let risk = iptv_core::analyze(&risk_input(&playlist));
    let vod_counts = counts(&playlist.vod);
    st.channels.write().await.insert(source.id.clone(), playlist.channels.clone());
    st.set_vod(&source.id, playlist.vod).await;
    Ok(SourceResult { channels: playlist.channels, vod_counts, epg_urls, risk, fetched_at })
}

/// Télécharge une source sans l'enregistrer, pour l'analyse de risque avant import.
#[tauri::command]
pub async fn preview_source(st: St<'_>, source: Source) -> Res<SourceResult> {
    let p = fetch_playlist(&st, &source).await?;
    let risk = iptv_core::analyze(&risk_input(&p));
    Ok(SourceResult { risk, vod_counts: counts(&p.vod), epg_urls: p.epg_urls, channels: vec![], fetched_at: now() })
}

/// L'analyse de risque porte sur les chaînes et sur les films/séries (catalogues VOD pirates).
fn risk_input(p: &Playlist) -> Vec<Channel> {
    let mut all = p.channels.clone();
    all.extend(p.vod.iter().map(|v| Channel {
        name: v.raw_name.clone(),
        group: v.category.clone(),
        url: v.url.clone().unwrap_or_else(|| "http://vod/movie/x".into()),
        ..Default::default()
    }));
    all
}

fn counts(vod: &[iptv_core::VodItem]) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    for v in vod {
        if let Some(k) = v.kind {
            *m.entry(serde_json::to_value(k).ok().and_then(|x| x.as_str().map(str::to_string)).unwrap_or_default()).or_default() += 1;
        }
    }
    m
}

/// Retire une source de la mémoire ; `purge` efface aussi son cache (suppression définitive).
#[tauri::command]
pub async fn remove_source(st: St<'_>, id: String, purge: bool) -> Res<()> {
    st.channels.write().await.remove(&id);
    st.set_vod(&id, vec![]).await;
    if !purge {
        return Ok(());
    }
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
    // Les agrégats « toutes sources » pèsent plusieurs centaines de Mo : les guides par pays suffisent.
    for url in urls.into_iter().filter(|u| !u.contains("ALL_SOURCES") && !u.contains("DUMMY_CHANNELS") && seen.insert(u.clone())) {
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
    /// Film, épisode ou piste : le format est analysé et converti si la webview ne sait pas le lire.
    #[serde(default)]
    pub media: bool,
}

fn default_window() -> u32 {
    120
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayInfo {
    pub url: String,
    /// `hls`, `mpegts`, `native` ou `remux` (conversion à la volée, `?start=` et `&audio=`).
    pub kind: &'static str,
    pub timeshift: bool,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub audio_tracks: Vec<crate::transcode::StreamTrack>,
    /// Format du flux converti : `mpegts` ou `mp4`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remux_format: Option<&'static str>,
}

impl PlayInfo {
    fn simple(url: String, kind: &'static str, timeshift: bool, error: Option<String>) -> Self {
        PlayInfo { url, kind, timeshift, error, duration: None, audio_tracks: vec![], remux_format: None }
    }
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
                return Ok(PlayInfo::simple(url, "hls", true, None));
            }
            Err(e) => ts_error = Some(e), // repli : lecture directe
        }
    }

    *st.remux.lock().await = None;
    let mut warning = ts_error;
    if req.media && !req.url.to_lowercase().contains(".m3u8") {
        if crate::transcode::find_tool("ffmpeg").is_some() {
            match crate::transcode::probe(&up).await {
                Ok(p) if !p.web_playable() => {
                    let sid = format!("{:x}", SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
                    let info = PlayInfo {
                        url: format!("{}/remux/{sid}", st.base_url()),
                        kind: "remux",
                        timeshift: false,
                        error: None,
                        duration: p.duration,
                        audio_tracks: p.audio.clone(),
                        remux_format: Some(p.remux_format()),
                    };
                    *st.remux.lock().await = Some((sid, up.clone(), p));
                    return Ok(info);
                }
                Ok(_) => {}
                Err(e) => log::warn!("analyse ffprobe : {e}"),
            }
        } else if ["mkv", "avi", "wmv", "flv"].iter().any(|e| req.url.to_lowercase().split('?').next().unwrap_or("").ends_with(e)) {
            warning = Some("ce format nécessite ffmpeg (non installé) : la lecture risque d'échouer".into());
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
    Ok(PlayInfo::simple(crate::server::proxy_url(&st.base_url(), &req.url, &up), kind, false, warning))
}

#[tauri::command]
pub async fn stop_playback(st: St<'_>) -> Res<()> {
    st.session.lock().await.take();
    st.remux.lock().await.take();
    Ok(())
}

#[tauri::command]
pub async fn timeshift_status(st: St<'_>) -> Res<Option<f64>> {
    Ok(st.session.lock().await.as_ref().map(|s| s.buffered_secs()))
}

// ------------------------------------------------------------------ Enregistrements

#[tauri::command]
pub async fn rec_list(st: St<'_>) -> Res<Vec<crate::recorder::Recording>> {
    let mut list = st.recorder.list.lock().await.clone();
    list.sort_by_key(|r| std::cmp::Reverse(r.start));
    Ok(list)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecRequest {
    pub channel: Channel,
    pub title: String,
    pub subtitle: Option<String>,
    pub start: i64,
    pub stop: i64,
    #[serde(default = "pad_before")]
    pub pad_before: i64,
    #[serde(default = "pad_after")]
    pub pad_after: i64,
    pub profile_id: Option<String>,
}

fn pad_before() -> i64 {
    120
}
fn pad_after() -> i64 {
    300
}

/// Programme un enregistrement ; un doublon (même chaîne, même début) n'est pas recréé.
#[tauri::command]
pub async fn rec_schedule(st: St<'_>, req: RecRequest) -> Res<crate::recorder::Recording> {
    if req.stop <= now() {
        return Err("Ce programme est déjà terminé.".into());
    }
    if let Some(r) = st.recorder.list.lock().await.iter().find(|r| r.channel.id == req.channel.id && r.start == req.start && r.status != crate::recorder::RecStatus::Cancelled) {
        return Ok(r.clone());
    }
    let r = crate::recorder::Recording {
        id: format!("{:x}", SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)),
        channel: req.channel,
        title: req.title,
        subtitle: req.subtitle,
        start: req.start,
        stop: req.stop,
        pad_before: req.pad_before.clamp(0, 1800),
        pad_after: req.pad_after.clamp(0, 3600),
        status: crate::recorder::RecStatus::Scheduled,
        file: None,
        size: 0,
        error: None,
        profile_id: req.profile_id,
    };
    Ok(st.recorder.schedule(r).await)
}

#[tauri::command]
pub async fn rec_cancel(st: St<'_>, id: String, delete_file: bool) -> Res<()> {
    st.recorder.cancel(&id, delete_file).await;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecInfo {
    pub dir: String,
    pub ffmpeg: bool,
    /// URL de lecture des fichiers : `<base>/rec/<nom de fichier>`.
    pub base: String,
}

#[tauri::command]
pub fn rec_info(st: St<'_>) -> RecInfo {
    RecInfo { dir: st.recorder.dir.to_string_lossy().into(), ffmpeg: crate::transcode::find_tool("ffmpeg").is_some(), base: format!("{}/rec", st.base_url()) }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use iptv_core::VodKind;

    /// `cargo test -p myiptv live_catalogs -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_catalogs_load() {
        let st = AppState::new(std::env::temp_dir().join("myiptv-cat-test"), std::env::temp_dir().join("myiptv-rec-test"), 1);
        let src = |kind: SourceKind| Source { id: "t".into(), name: "t".into(), kind, epg_urls: vec![] };
        let cases = vec![
            ("films", src(SourceKind::Archive { collection: "feature_films".into(), mediatype: "movies".into(), content: VodKind::Movie, rows: 50 })),
            ("radio", src(SourceKind::RadioBrowser { countries: vec!["FR".into()] })),
            ("podcasts", src(SourceKind::Podcasts { countries: vec!["fr".into()] })),
            ("livres", src(SourceKind::Librivox { languages: vec!["fr".into()] })),
        ];
        for (name, s) in cases {
            let p = fetch_playlist(&st, &s).await.unwrap_or_else(|e| panic!("{name}: {e}"));
            let first = p.vod.first().map(|i| (i.title.clone(), i.languages.clone()));
            println!("{name}: {} contenus, ex. {first:?}", p.vod.len());
            assert!(!p.vod.is_empty(), "{name} vide");
        }
    }
}
