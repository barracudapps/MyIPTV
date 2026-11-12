//! Partage de configuration sur le réseau local : serveur HTTP temporaire, ouvert
//! seulement pendant un partage, qui sert la configuration chiffrée par le code.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use iptv_core::share;
use serde::Serialize;
use tokio::sync::oneshot;

pub const SHARE_PORT: u16 = 47820;
const LIFETIME: Duration = Duration::from_secs(10 * 60);
/// Au-delà, le partage se ferme : quelqu'un essaie des codes au hasard.
const MAX_FAILURES: u32 = 10;

struct Session {
    serial: u64,
    id: String,
    blob: Arc<Vec<u8>>,
    expires_at: u64,
    downloads: u32,
    failures: u32,
    stop: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct ShareState {
    inner: Mutex<Option<Session>>,
    serial: Mutex<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    code: String,
    addresses: Vec<String>,
    port: u16,
    expires_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareStatus {
    active: bool,
    downloads: u32,
    expires_at: u64,
    closed_reason: Option<String>,
}

type Shared = Arc<ShareState>;
type Res<T> = Result<T, String>;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Adresse locale de l'interface qui sort vers le réseau (aucun paquet n'est envoyé).
fn local_addresses() -> Vec<String> {
    let mut out = Vec::new();
    for probe in ["192.168.0.1:9", "10.0.0.1:9", "8.8.8.8:9"] {
        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(probe).is_ok() {
                if let Ok(addr) = sock.local_addr() {
                    let ip = addr.ip();
                    if !ip.is_loopback() && !ip.is_unspecified() && !out.contains(&ip.to_string()) {
                        out.push(ip.to_string());
                    }
                }
            }
        }
    }
    out
}

fn with_cors(mut r: Response) -> Response {
    let h = r.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert("access-control-allow-private-network", HeaderValue::from_static("true"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

fn stop_session(st: &ShareState) {
    if let Some(mut s) = st.inner.lock().unwrap().take() {
        if let Some(tx) = s.stop.take() {
            let _ = tx.send(());
        }
    }
}

async fn serve(State(st): State<Shared>, Path(id): Path<String>) -> Response {
    let mut guard = st.inner.lock().unwrap();
    let Some(s) = guard.as_mut() else { return with_cors(StatusCode::GONE.into_response()) };
    if now() > s.expires_at {
        drop(guard);
        stop_session(&st);
        return with_cors(StatusCode::GONE.into_response());
    }
    if s.id != id {
        s.failures += 1;
        let too_many = s.failures >= MAX_FAILURES;
        drop(guard);
        if too_many {
            stop_session(&st);
        }
        return with_cors(StatusCode::NOT_FOUND.into_response());
    }
    s.downloads += 1;
    let body = s.blob.as_ref().clone();
    with_cors(([(header::CONTENT_TYPE, "application/octet-stream")], body).into_response())
}

async fn preflight() -> Response {
    let mut r = with_cors(StatusCode::NO_CONTENT.into_response());
    r.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET"));
    r
}

/// Ouvre un partage : chiffre `payload` (JSON) et l'expose sur le réseau local.
#[tauri::command]
pub async fn share_start(st: tauri::State<'_, Shared>, payload: String) -> Res<ShareInfo> {
    stop_session(&st);
    let mut random = [0u8; 20];
    getrandom::getrandom(&mut random).map_err(|e| e.to_string())?;
    let code = share::code_from_random(&random[..8]);
    let nonce: [u8; 12] = random[8..].try_into().unwrap();
    let blob = {
        let code = code.clone();
        tokio::task::spawn_blocking(move || share::seal(&code, payload.as_bytes(), nonce)).await.map_err(|e| e.to_string())?
    };
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", SHARE_PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| format!("Réseau indisponible : {e}"))?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = oneshot::channel();
    let serial = {
        let mut n = st.serial.lock().unwrap();
        *n += 1;
        *n
    };
    let expires_at = now() + LIFETIME.as_secs();
    *st.inner.lock().unwrap() = Some(Session { serial, id: share::share_id(&code), blob: Arc::new(blob), expires_at, downloads: 0, failures: 0, stop: Some(tx) });

    let shared: Shared = st.inner().clone();
    let router = Router::new()
        .route("/myiptv-share/:id", get(serve).options(preflight))
        .route("/myiptv-share", get(|| async { with_cors("MyIPTV".into_response()) }))
        .with_state(shared.clone());
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = rx.await; }).await;
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LIFETIME).await;
        let same = shared.inner.lock().unwrap().as_ref().is_some_and(|s| s.serial == serial);
        if same {
            stop_session(&shared);
        }
    });
    Ok(ShareInfo { code, addresses: local_addresses(), port, expires_at })
}

#[tauri::command]
pub fn share_status(st: tauri::State<'_, Shared>) -> ShareStatus {
    match st.inner.lock().unwrap().as_ref() {
        Some(s) if now() <= s.expires_at => ShareStatus { active: true, downloads: s.downloads, expires_at: s.expires_at, closed_reason: None },
        Some(s) => ShareStatus { active: false, downloads: s.downloads, expires_at: s.expires_at, closed_reason: Some("expired".into()) },
        None => ShareStatus { active: false, downloads: 0, expires_at: 0, closed_reason: None },
    }
}

#[tauri::command]
pub fn share_stop(st: tauri::State<'_, Shared>) {
    stop_session(&st);
}

/// Adresse saisie (« 192.168.1.20 », « 192.168.1.20:47820 », « http://… ») -> base HTTP.
pub fn share_base(address: &str) -> String {
    let a = address.trim().trim_end_matches('/');
    let a = a.strip_prefix("http://").unwrap_or(a);
    if a.rsplit_once(':').is_some_and(|(_, p)| p.parse::<u16>().is_ok()) && !a.ends_with(']') {
        format!("http://{a}")
    } else {
        format!("http://{a}:{SHARE_PORT}")
    }
}

/// Récupère et déchiffre la configuration partagée par un autre appareil.
#[tauri::command]
pub async fn share_fetch(app: tauri::State<'_, Arc<crate::state::AppState>>, address: String, code: String) -> Res<String> {
    let url = format!("{}/myiptv-share/{}", share_base(&address), share::share_id(&code));
    let r = app
        .http
        .get(&url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Appareil injoignable : vérifiez l'adresse et que les deux appareils sont sur le même réseau.".to_string())?;
    match r.status().as_u16() {
        200 => {}
        404 => return Err("Code incorrect.".into()),
        410 => return Err("Ce partage est terminé ou a expiré.".into()),
        s => return Err(format!("L'appareil a répondu {s}.")),
    }
    let data = r.bytes().await.map_err(|e| e.to_string())?.to_vec();
    tokio::task::spawn_blocking(move || share::open(&code, &data).and_then(|p| String::from_utf8(p).map_err(|e| e.to_string())))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_forms() {
        assert_eq!(share_base("192.168.1.20"), "http://192.168.1.20:47820");
        assert_eq!(share_base(" 192.168.1.20:5000/ "), "http://192.168.1.20:5000");
        assert_eq!(share_base("http://tv.local"), "http://tv.local:47820");
    }

    #[tokio::test]
    async fn serves_sealed_config_and_closes_after_bad_codes() {
        let st: Shared = Arc::new(ShareState::default());
        let blob = share::seal("ABCD-EFGH", b"{}", [1; 12]);
        let (tx, _rx) = oneshot::channel();
        *st.inner.lock().unwrap() = Some(Session { serial: 1, id: share::share_id("ABCD-EFGH"), blob: Arc::new(blob), expires_at: now() + 60, downloads: 0, failures: 0, stop: Some(tx) });
        let ok = serve(State(st.clone()), Path(share::share_id("abcd efgh"))).await;
        assert_eq!(ok.status(), StatusCode::OK);
        let body = axum::body::to_bytes(ok.into_body(), 1 << 20).await.unwrap();
        assert_eq!(share::open("ABCD-EFGH", &body).unwrap(), b"{}");
        for _ in 0..MAX_FAILURES {
            assert_eq!(serve(State(st.clone()), Path("bad".into())).await.status(), StatusCode::NOT_FOUND);
        }
        assert!(st.inner.lock().unwrap().is_none());
        assert_eq!(serve(State(st.clone()), Path(share::share_id("ABCD-EFGH"))).await.status(), StatusCode::GONE);
    }
}
