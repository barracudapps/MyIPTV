//! Télécommande sur téléphone : un serveur HTTP du réseau local sert une page de
//! télécommande, protégée par un jeton aléatoire présent dans l'adresse (QR code).
//! Les commandes reçues sont transmises à l'interface par l'événement `remote-command`.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

pub const REMOTE_PORT: u16 = 47821;
const PAGE: &str = include_str!("remote.html");
/// Sans téléphone connecté depuis ce délai, la télécommande se ferme.
const IDLE_SECS: u64 = 2 * 3600;

struct Session {
    token: String,
    info: RemoteInfo,
    last_seen: u64,
    stop: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct RemoteState {
    inner: Mutex<Option<Session>>,
    /// État affiché sur le téléphone (titre en cours…), fourni par l'interface.
    now_playing: Mutex<serde_json::Value>,
}

type Shared = Arc<RemoteState>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    url: String,
    addresses: Vec<String>,
    port: u16,
    qr_svg: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct RemoteCommand {
    /// `key` (touche), `text` (recherche), `view` (écran), `action` (lecture…).
    #[serde(rename = "type")]
    kind: String,
    value: String,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn check(st: &RemoteState, token: &str) -> bool {
    let mut guard = st.inner.lock().unwrap();
    match guard.as_mut() {
        Some(s) if s.token == token => {
            s.last_seen = now();
            true
        }
        _ => false,
    }
}

#[derive(Clone)]
struct Ctx {
    st: Shared,
    app: AppHandle,
}

async fn page(State(c): State<Ctx>, Path(token): Path<String>) -> Response {
    if !check(&c.st, &token) {
        return (StatusCode::NOT_FOUND, "Télécommande fermée : rouvrez-la depuis MyIPTV.").into_response();
    }
    ([(header::CACHE_CONTROL, "no-store")], Html(PAGE)).into_response()
}

async fn state(State(c): State<Ctx>, Path(token): Path<String>) -> Response {
    if !check(&c.st, &token) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let v = c.st.now_playing.lock().unwrap().clone();
    ([(header::CACHE_CONTROL, "no-store")], Json(v)).into_response()
}

async fn command(State(c): State<Ctx>, Path(token): Path<String>, Json(cmd): Json<RemoteCommand>) -> Response {
    if !check(&c.st, &token) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if cmd.value.len() > 200 || !matches!(cmd.kind.as_str(), "key" | "text" | "view" | "action") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let _ = c.app.emit("remote-command", cmd);
    StatusCode::NO_CONTENT.into_response()
}

fn stop_session(st: &RemoteState) {
    if let Some(mut s) = st.inner.lock().unwrap().take() {
        if let Some(tx) = s.stop.take() {
            let _ = tx.send(());
        }
    }
}

fn qr_svg(url: &str) -> String {
    qrcode::QrCode::new(url.as_bytes())
        .map(|code| code.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).build())
        .unwrap_or_default()
}

/// Ouvre la télécommande et renvoie son adresse et son QR code.
#[tauri::command]
pub async fn remote_start(app: AppHandle, st: tauri::State<'_, Shared>) -> Result<RemoteInfo, String> {
    stop_session(&st);
    let mut random = [0u8; 12];
    getrandom::getrandom(&mut random).map_err(|e| e.to_string())?;
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", REMOTE_PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| format!("Réseau indisponible : {e}"))?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = oneshot::channel();
    let addresses = crate::share::local_addresses();
    let host = addresses.first().cloned().unwrap_or_else(|| "127.0.0.1".into());
    let url = format!("http://{host}:{port}/r/{token}");
    let info = RemoteInfo { qr_svg: qr_svg(&url), url, addresses, port };
    *st.inner.lock().unwrap() = Some(Session { token: token.clone(), info: info.clone(), last_seen: now(), stop: Some(tx) });

    let shared: Shared = st.inner().clone();
    let router = Router::new()
        .route("/r/:token", get(page))
        .route("/r/:token/state", get(state))
        .route("/r/:token/cmd", post(command))
        .with_state(Ctx { st: shared.clone(), app });
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = rx.await; }).await;
    });
    // Fermeture après une longue inactivité.
    let watch = shared.clone();
    let mine = token.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            let idle = match watch.inner.lock().unwrap().as_ref() {
                Some(s) if s.token == mine => now().saturating_sub(s.last_seen) > IDLE_SECS,
                _ => return,
            };
            if idle {
                stop_session(&watch);
                return;
            }
        }
    });

    Ok(info)
}

#[tauri::command]
pub fn remote_stop(st: tauri::State<'_, Shared>) {
    stop_session(&st);
}

/// Télécommande ouverte : son adresse et son QR code, pour les réafficher.
#[tauri::command]
pub fn remote_active(st: tauri::State<'_, Shared>) -> Option<RemoteInfo> {
    st.inner.lock().unwrap().as_ref().map(|s| s.info.clone())
}

/// L'interface publie ce que le téléphone affiche (programme en cours…).
#[tauri::command]
pub fn remote_publish(st: tauri::State<'_, Shared>, state: serde_json::Value) {
    *st.now_playing.lock().unwrap() = state;
}
