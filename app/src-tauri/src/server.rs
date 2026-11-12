//! Serveur HTTP local (127.0.0.1) :
//! - `/proxy?u=…` relaie un flux distant (contourne CORS, ajoute User-Agent/Referer,
//!   réécrit les playlists HLS pour que tous les sous-flux passent aussi par le proxy) ;
//! - `/ts/<session>/<fichier>` sert la playlist et les segments du timeshift.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use url::Url;

use crate::state::AppState;
use crate::timeshift::Upstream;

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

pub fn proxy_url(base: &str, target: &str, up: &Upstream) -> String {
    let mut u = format!("{base}/proxy?u={}", enc(target));
    if let Some(ua) = &up.user_agent {
        u.push_str(&format!("&ua={}", enc(ua)));
    }
    if let Some(r) = &up.referrer {
        u.push_str(&format!("&ref={}", enc(r)));
    }
    u
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/proxy", get(proxy))
        .route("/ts/:sid/:file", get(ts_file))
        .route("/remux/:sid", get(remux))
        .route("/rec/:file", get(rec_file))
        .route("/health", get(|| async { "ok" }))
        .route("/embed", get(embed_page))
        .with_state(state)
}

fn cors(mut r: Response) -> Response {
    let h = r.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("Content-Length, Content-Range"));
    r
}

fn error(status: StatusCode, msg: impl Into<String>) -> Response {
    cors((status, msg.into()).into_response())
}

#[derive(Deserialize)]
struct ProxyQuery {
    u: String,
    ua: Option<String>,
    #[serde(rename = "ref")]
    referrer: Option<String>,
}

async fn proxy(State(st): State<Arc<AppState>>, Query(q): Query<ProxyQuery>, headers: HeaderMap) -> Response {
    let up = Upstream { url: q.u.clone(), user_agent: q.ua, referrer: q.referrer };
    let mut req = st.http.get(&up.url).headers(up.headers());
    if let Some(range) = headers.get(header::RANGE) {
        req = req.header(header::RANGE, range.clone());
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return error(StatusCode::BAD_GATEWAY, format!("source injoignable : {e}")),
    };
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let final_url = resp.url().clone();
    let ct = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let is_playlist = ct.to_lowercase().contains("mpegurl") || final_url.path().ends_with(".m3u8");

    if is_playlist && status.is_success() {
        let body = match resp.text().await {
            Ok(b) => b,
            Err(e) => return error(StatusCode::BAD_GATEWAY, e.to_string()),
        };
        let rewritten = rewrite_playlist(&st.base_url(), &final_url, &body, &up);
        let mut r = Response::new(Body::from(rewritten));
        r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/vnd.apple.mpegurl"));
        r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        return cors(r);
    }

    let mut out = Response::builder().status(status);
    for name in [header::CONTENT_TYPE, header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES] {
        if let Some(v) = resp.headers().get(name.as_str()) {
            out = out.header(name, v.as_bytes());
        }
    }
    let r = out.body(Body::from_stream(resp.bytes_stream())).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    cors(r)
}

/// Réécrit chaque URI (lignes simples et attributs `URI="…"`) pour passer par le proxy.
pub fn rewrite_playlist(base: &str, playlist_url: &Url, body: &str, up: &Upstream) -> String {
    let mut out = String::with_capacity(body.len() * 2);
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            out.push('\n');
            continue;
        }
        if !t.starts_with('#') {
            match playlist_url.join(t) {
                Ok(abs) => out.push_str(&proxy_url(base, abs.as_str(), up)),
                Err(_) => out.push_str(t),
            }
        } else if let Some(i) = t.find("URI=\"") {
            let start = i + 5;
            let end = t[start..].find('"').map(|e| start + e).unwrap_or(t.len());
            let uri = &t[start..end];
            let abs = playlist_url.join(uri).map(|u| u.to_string()).unwrap_or_else(|_| uri.to_string());
            out.push_str(&t[..start]);
            out.push_str(&proxy_url(base, &abs, up));
            out.push_str(&t[end..]);
        } else {
            out.push_str(t);
        }
        out.push('\n');
    }
    out
}

pub fn embed_page_url(base: &str, embed: &str) -> String {
    format!("{base}/embed?u={}", enc(embed))
}

#[derive(Deserialize)]
struct EmbedQuery {
    u: String,
}

/// Page minimale contenant le lecteur intégré officiel (YouTube, Dailymotion) : servie en HTTP
/// local, elle lui donne l'origine web et le référent qu'il exige.
async fn embed_page(Query(q): Query<EmbedQuery>) -> Response {
    let allowed = ["https://www.youtube-nocookie.com/embed/", "https://www.dailymotion.com/embed/video/"];
    if !allowed.iter().any(|p| q.u.starts_with(p)) {
        return error(StatusCode::BAD_REQUEST, "lecteur non autorisé");
    }
    let src = q.u.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    let html = format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body{{margin:0;height:100%;background:#000;overflow:hidden}}iframe{{border:0;width:100%;height:100%}}</style></head><body><iframe src="{src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>"#
    );
    let mut r = Response::new(Body::from(html));
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    r
}

#[derive(Deserialize)]
struct RemuxQuery {
    #[serde(default)]
    start: f64,
    #[serde(default)]
    audio: usize,
}

/// Flux MP4 fragmenté produit par ffmpeg ; le processus s'arrête quand le lecteur se déconnecte.
async fn remux(State(st): State<Arc<AppState>>, Path(sid): Path<String>, Query(q): Query<RemuxQuery>) -> Response {
    let Some((up, probe)) = st.remux.lock().await.as_ref().filter(|(id, ..)| *id == sid).map(|(_, u, p)| (u.clone(), p.clone())) else {
        return error(StatusCode::NOT_FOUND, "conversion terminée");
    };
    let mut child = match crate::transcode::spawn_remux(&up, &probe, q.start, q.audio) {
        Ok(c) => c,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let Some(stdout) = child.stdout.take() else {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "ffmpeg sans sortie");
    };
    // Le processus vit tant que le corps de la réponse est lu (kill_on_drop).
    let stream = futures_util::StreamExt::map(tokio_util::io::ReaderStream::new(stdout), move |chunk| {
        let _keep = &child;
        chunk
    });
    let mut r = Response::new(Body::from_stream(stream));
    let ct = match probe.remux_format() {
        "mpegts" => "video/mp2t",
        "mp3" => "audio/mpeg",
        _ => "video/mp4",
    };
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(ct));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    cors(r)
}

/// Fichier enregistré (MPEG-TS), lu par mpegts.js.
async fn rec_file(State(st): State<Arc<AppState>>, Path(file): Path<String>) -> Response {
    if file.contains('/') || file.contains("..") || !file.ends_with(".ts") {
        return error(StatusCode::BAD_REQUEST, "nom invalide");
    }
    match tokio::fs::File::open(st.recorder.dir.join(&file)).await {
        Ok(f) => {
            let mut r = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(f)));
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("video/mp2t"));
            cors(r)
        }
        Err(_) => error(StatusCode::NOT_FOUND, "enregistrement introuvable"),
    }
}

async fn ts_file(State(st): State<Arc<AppState>>, Path((sid, file)): Path<(String, String)>) -> Response {
    let guard = st.session.lock().await;
    let Some(sess) = guard.as_ref().filter(|s| s.id == sid) else {
        return error(StatusCode::NOT_FOUND, "session terminée");
    };
    if file == "index.m3u8" {
        let mut r = Response::new(Body::from(sess.playlist()));
        r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/vnd.apple.mpegurl"));
        r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        return cors(r);
    }
    if file.contains('/') || file.contains("..") {
        return error(StatusCode::BAD_REQUEST, "nom invalide");
    }
    let path = sess.dir.join(&file);
    drop(guard);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let ct = match file.rsplit('.').next() {
                Some("ts") => "video/mp2t",
                Some("mp4" | "m4s") => "video/mp4",
                Some("aac") => "audio/aac",
                _ => "application/octet-stream",
            };
            let mut r = Response::new(Body::from(bytes));
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(ct));
            cors(r)
        }
        Err(_) => error(StatusCode::NOT_FOUND, "segment expiré"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_relative_and_attribute_uris() {
        let pl = Url::parse("https://cdn.example/a/index.m3u8?t=1").unwrap();
        let up = Upstream { url: String::new(), user_agent: Some("UA".into()), referrer: None };
        let body = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\nseg1.ts\nhttps://other/seg2.ts\n";
        let out = rewrite_playlist("http://127.0.0.1:1", &pl, body, &up);
        assert!(out.contains("URI=\"http://127.0.0.1:1/proxy?u=https%3A%2F%2Fcdn.example%2Fa%2Fkey.bin&ua=UA\""));
        assert!(out.contains("http://127.0.0.1:1/proxy?u=https%3A%2F%2Fcdn.example%2Fa%2Fseg1.ts&ua=UA\n"));
        assert!(out.contains("u=https%3A%2F%2Fother%2Fseg2.ts"));
    }
}
