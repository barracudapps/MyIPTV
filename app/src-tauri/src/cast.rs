//! Diffusion vers un autre écran du réseau local :
//! - Chromecast / Google TV (protocole Cast v2, récepteur multimédia par défaut) ;
//! - téléviseurs et box DLNA / UPnP (AVTransport).
//!
//! L'écran récupère lui-même le flux. Quand il faut des en-têtes (User-Agent, Referer)
//! ou une adresse lisible depuis le réseau, le flux passe par un relais local ouvert
//! seulement pendant la diffusion, sous un chemin secret.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, Mutex};

use crate::state::AppState;
use crate::timeshift::Upstream;

type Res<T> = Result<T, String>;
type St<'a> = tauri::State<'a, Arc<AppState>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastDevice {
    pub id: String,
    pub name: String,
    /// `chromecast` ou `dlna`.
    pub kind: String,
    pub host: String,
    pub port: u16,
    /// DLNA : adresse de commande AVTransport.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastMedia {
    pub url: String,
    pub title: String,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
    /// Direct (pas de durée) ou contenu à la demande.
    pub live: bool,
    /// Position de départ (secondes).
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub poster: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CastStatus {
    pub active: bool,
    pub device: Option<String>,
    /// `PLAYING`, `PAUSED`, `BUFFERING`, `IDLE`…
    pub state: String,
    pub position: f64,
    pub duration: Option<f64>,
    pub error: Option<String>,
}

enum Command {
    Play,
    Pause,
    Seek(f64),
    Stop,
}

/// Diffusion en cours (une à la fois).
struct Session {
    device: CastDevice,
    commands: Option<mpsc::UnboundedSender<Command>>,
    status: Arc<Mutex<CastStatus>>,
    relay_stop: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct CastState {
    session: Mutex<Option<Session>>,
}

pub type SharedCast = Arc<CastState>;

// ------------------------------------------------------------------ Découverte

/// Écrans Chromecast (mDNS) et DLNA (SSDP) répondant dans les ~3 secondes.
#[tauri::command]
pub async fn cast_discover(st: St<'_>) -> Res<Vec<CastDevice>> {
    let (mut cc, mut dlna) = tokio::join!(discover_chromecast(), discover_dlna(&st.http));
    cc.append(&mut dlna);
    let mut seen = std::collections::HashSet::new();
    cc.retain(|d| seen.insert(d.id.clone()));
    cc.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(cc)
}

async fn discover_chromecast() -> Vec<CastDevice> {
    tokio::task::spawn_blocking(|| {
        let Ok(daemon) = mdns_sd::ServiceDaemon::new() else { return vec![] };
        let Ok(rx) = daemon.browse("_googlecast._tcp.local.") else { return vec![] };
        let deadline = std::time::Instant::now() + Duration::from_millis(3000);
        let mut out: Vec<CastDevice> = Vec::new();
        while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                    let Some(ip) = info.get_addresses().iter().find(|a| a.is_ipv4()).or_else(|| info.get_addresses().iter().next()) else { continue };
                    let name = info.get_property_val_str("fn").unwrap_or_else(|| info.get_hostname()).to_string();
                    let id = info.get_property_val_str("id").map(str::to_string).unwrap_or_else(|| info.get_fullname().to_string());
                    out.push(CastDevice {
                        id: format!("cc:{id}"),
                        name,
                        kind: "chromecast".into(),
                        host: ip.to_string(),
                        port: info.get_port(),
                        control_url: None,
                        model: info.get_property_val_str("md").map(str::to_string),
                    });
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = daemon.shutdown();
        out
    })
    .await
    .unwrap_or_default()
}

fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{name}>"))? + start;
    Some(xml[start..end].trim())
}

async fn discover_dlna(http: &reqwest::Client) -> Vec<CastDevice> {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { return vec![] };
    let search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n";
    for _ in 0..2 {
        let _ = sock.send_to(search.as_bytes(), "239.255.255.250:1900").await;
    }
    let mut locations = std::collections::BTreeSet::new();
    let mut buf = [0u8; 2048];
    let deadline = tokio::time::Instant::now() + Duration::from_millis(2800);
    while let Ok(Ok((n, _))) = tokio::time::timeout_at(deadline, sock.recv_from(&mut buf)).await {
        let text = String::from_utf8_lossy(&buf[..n]);
        if let Some(loc) = text.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("location")).map(|(_, v)| v.trim().to_string())) {
            locations.insert(loc);
        }
    }
    let mut out = Vec::new();
    for loc in locations {
        let Ok(r) = http.get(&loc).timeout(Duration::from_secs(3)).send().await else { continue };
        let Ok(xml) = r.text().await else { continue };
        let Some(service) = xml.split("<service>").find(|s| s.contains("AVTransport")) else { continue };
        let Some(control) = tag(service, "controlURL") else { continue };
        let Ok(base) = url::Url::parse(tag(&xml, "URLBase").unwrap_or(&loc)) else { continue };
        let Ok(control_url) = base.join(control) else { continue };
        let name = tag(&xml, "friendlyName").unwrap_or("Écran DLNA").to_string();
        let udn = tag(&xml, "UDN").unwrap_or(&loc).to_string();
        out.push(CastDevice {
            id: format!("dlna:{udn}"),
            name,
            kind: "dlna".into(),
            host: base.host_str().unwrap_or_default().to_string(),
            port: base.port_or_known_default().unwrap_or(80),
            control_url: Some(control_url.to_string()),
            model: tag(&xml, "modelName").map(str::to_string),
        });
    }
    out
}

// ------------------------------------------------------------------ Relais réseau

/// Adresse locale vue par l'écran (interface qui mène à lui).
fn local_ip_towards(host: &str, port: u16) -> Option<IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect((host, port)).ok()?;
    Some(sock.local_addr().ok()?.ip())
}

/// Ouvre le relais réseau et renvoie l'adresse du flux à donner à l'écran.
async fn open_relay(st: &Arc<AppState>, device: &CastDevice, media: &CastMedia) -> Res<(String, tokio::sync::oneshot::Sender<()>)> {
    let ip = local_ip_towards(&device.host, device.port).ok_or("Adresse locale introuvable : êtes-vous connecté au même réseau ?")?;
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(ip, 0)).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut secret = [0u8; 16];
    getrandom::getrandom(&mut secret).map_err(|e| e.to_string())?;
    let token: String = secret.iter().map(|b| format!("{b:02x}")).collect();
    let base = format!("http://{ip}:{port}/c/{token}");
    let router = crate::server::relay_router(st.clone(), token, base.clone());
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router).with_graceful_shutdown(async { let _ = rx.await; }).await;
    });
    let up = Upstream { url: media.url.clone(), user_agent: media.user_agent.clone(), referrer: media.referrer.clone() };
    Ok((crate::server::proxy_url(&base, &media.url, &up), tx))
}

fn content_type(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
    if path.ends_with(".m3u8") || path.ends_with(".m3u") {
        "application/x-mpegURL"
    } else if path.ends_with(".mp4") || path.ends_with(".m4v") {
        "video/mp4"
    } else if path.ends_with(".mkv") {
        "video/x-matroska"
    } else if path.ends_with(".webm") {
        "video/webm"
    } else if path.ends_with(".mp3") {
        "audio/mpeg"
    } else if path.ends_with(".aac") {
        "audio/aac"
    } else {
        "video/mp2t"
    }
}

// ------------------------------------------------------------------ Commandes

#[tauri::command]
pub async fn cast_start(st: St<'_>, cast: tauri::State<'_, SharedCast>, device: CastDevice, media: CastMedia) -> Res<()> {
    stop_session(&cast).await;
    let app: Arc<AppState> = st.inner().clone();
    // Toujours par le relais : en-têtes ajoutés et playlists HLS réécrites pour le réseau local.
    let (url, relay_stop) = open_relay(&app, &device, &media).await?;
    let status = Arc::new(Mutex::new(CastStatus { active: true, device: Some(device.name.clone()), state: "BUFFERING".into(), ..Default::default() }));
    let (tx, rx) = mpsc::unbounded_channel();
    let ctype = content_type(&media.url);
    match device.kind.as_str() {
        "chromecast" => {
            let conn = chromecast::Connection::open(&device.host, device.port).await?;
            let s = status.clone();
            let m = media.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = chromecast::run(conn, url, ctype, m, rx, s.clone()).await {
                    let mut st = s.lock().await;
                    st.error = Some(e);
                    st.state = "IDLE".into();
                    st.active = false;
                }
            });
        }
        "dlna" => {
            let control = device.control_url.clone().ok_or("Écran DLNA sans commande de lecture.")?;
            dlna::load(&app.http, &control, &url, ctype, &media).await?;
            let s = status.clone();
            let http = app.http.clone();
            tauri::async_runtime::spawn(dlna::run(http, control, media.start, rx, s));
        }
        other => return Err(format!("Type d'écran inconnu : {other}")),
    }
    *cast.session.lock().await = Some(Session { device, commands: Some(tx), status, relay_stop: Some(relay_stop) });
    Ok(())
}

async fn stop_session(cast: &CastState) {
    if let Some(mut s) = cast.session.lock().await.take() {
        if let Some(tx) = s.commands.take() {
            let _ = tx.send(Command::Stop);
        }
        // Laisse le temps à l'ordre d'arrêt de partir avant de couper le relais.
        let stop = s.relay_stop.take();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if let Some(stop) = stop {
                let _ = stop.send(());
            }
        });
    }
}

#[tauri::command]
pub async fn cast_control(cast: tauri::State<'_, SharedCast>, action: String, position: Option<f64>) -> Res<()> {
    let guard = cast.session.lock().await;
    let Some(s) = guard.as_ref() else { return Err("Aucune diffusion en cours.".into()) };
    let cmd = match action.as_str() {
        "play" => Command::Play,
        "pause" => Command::Pause,
        "seek" => Command::Seek(position.unwrap_or(0.0)),
        _ => return Err(format!("Commande inconnue : {action}")),
    };
    s.commands.as_ref().ok_or("Diffusion terminée.")?.send(cmd).map_err(|_| "Diffusion terminée.".to_string())
}

#[tauri::command]
pub async fn cast_stop(cast: tauri::State<'_, SharedCast>) -> Res<()> {
    stop_session(&cast).await;
    Ok(())
}

#[tauri::command]
pub async fn cast_status(cast: tauri::State<'_, SharedCast>) -> Res<CastStatus> {
    let guard = cast.session.lock().await;
    Ok(match guard.as_ref() {
        Some(s) => {
            let mut st = s.status.lock().await.clone();
            st.device = Some(s.device.name.clone());
            st
        }
        None => CastStatus::default(),
    })
}

// ------------------------------------------------------------------ DLNA

mod dlna {
    use super::*;

    const AVT: &str = "urn:schemas-upnp-org:service:AVTransport:1";

    fn esc(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    }

    async fn soap(http: &reqwest::Client, control: &str, action: &str, args: &str) -> Res<String> {
        let body = format!(
            r#"<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:{action} xmlns:u="{AVT}"><InstanceID>0</InstanceID>{args}</u:{action}></s:Body></s:Envelope>"#
        );
        let r = http
            .post(control)
            .header("Content-Type", "text/xml; charset=\"utf-8\"")
            .header("SOAPACTION", format!("\"{AVT}#{action}\""))
            .body(body)
            .timeout(Duration::from_secs(6))
            .send()
            .await
            .map_err(|e| format!("Écran injoignable : {e}"))?;
        let ok = r.status().is_success();
        let text = r.text().await.unwrap_or_default();
        if ok {
            Ok(text)
        } else {
            Err(format!("L'écran a refusé « {action} »{}", super::tag(&text, "errorDescription").map(|d| format!(" : {d}")).unwrap_or_default()))
        }
    }

    fn hms(secs: f64) -> String {
        let s = secs.max(0.0) as u64;
        format!("{}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60)
    }

    fn secs(hms: &str) -> Option<f64> {
        let p: Vec<f64> = hms.split(':').filter_map(|x| x.parse().ok()).collect();
        (p.len() == 3).then(|| p[0] * 3600.0 + p[1] * 60.0 + p[2])
    }

    pub async fn load(http: &reqwest::Client, control: &str, url: &str, ctype: &str, media: &CastMedia) -> Res<()> {
        let didl = format!(
            r#"<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>{}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:{ctype}:*">{}</res></item></DIDL-Lite>"#,
            esc(&media.title),
            esc(url)
        );
        let _ = soap(http, control, "Stop", "").await;
        soap(http, control, "SetAVTransportURI", &format!("<CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>", esc(url), esc(&didl))).await?;
        soap(http, control, "Play", "<Speed>1</Speed>").await?;
        Ok(())
    }

    /// Commandes et suivi de l'état (toutes les 2 secondes).
    pub async fn run(http: reqwest::Client, control: String, start: f64, mut rx: mpsc::UnboundedReceiver<Command>, status: Arc<Mutex<CastStatus>>) {
        let mut seeked = start < 5.0;
        let mut tick = tokio::time::interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    let r = match cmd {
                        Some(Command::Play) => soap(&http, &control, "Play", "<Speed>1</Speed>").await.map(drop),
                        Some(Command::Pause) => soap(&http, &control, "Pause", "").await.map(drop),
                        Some(Command::Seek(p)) => soap(&http, &control, "Seek", &format!("<Unit>REL_TIME</Unit><Target>{}</Target>", hms(p))).await.map(drop),
                        Some(Command::Stop) | None => {
                            let _ = soap(&http, &control, "Stop", "").await;
                            let mut s = status.lock().await;
                            s.active = false;
                            s.state = "IDLE".into();
                            return;
                        }
                    };
                    if let Err(e) = r {
                        status.lock().await.error = Some(e);
                    }
                }
                _ = tick.tick() => {
                    let info = soap(&http, &control, "GetTransportInfo", "").await.ok();
                    let pos = soap(&http, &control, "GetPositionInfo", "").await.ok();
                    let mut s = status.lock().await;
                    if let Some(state) = info.as_deref().and_then(|x| super::tag(x, "CurrentTransportState")) {
                        s.state = match state { "PLAYING" => "PLAYING", "PAUSED_PLAYBACK" => "PAUSED", "TRANSITIONING" => "BUFFERING", _ => "IDLE" }.into();
                    }
                    if let Some(p) = pos.as_deref() {
                        s.position = super::tag(p, "RelTime").and_then(secs).unwrap_or(s.position);
                        s.duration = super::tag(p, "TrackDuration").and_then(secs).filter(|d| *d > 0.0);
                    }
                    // Reprise : une fois la lecture lancée, on se place à la position demandée.
                    if !seeked && s.state == "PLAYING" {
                        seeked = true;
                        drop(s);
                        let _ = soap(&http, &control, "Seek", &format!("<Unit>REL_TIME</Unit><Target>{}</Target>", hms(start))).await;
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ Chromecast (Cast v2)

mod chromecast {
    use super::*;
    use tokio_rustls::rustls;

    const SENDER: &str = "sender-0";
    const RECEIVER: &str = "receiver-0";
    const NS_CONN: &str = "urn:x-cast:com.google.cast.tp.connection";
    const NS_HEART: &str = "urn:x-cast:com.google.cast.tp.heartbeat";
    const NS_RECV: &str = "urn:x-cast:com.google.cast.receiver";
    const NS_MEDIA: &str = "urn:x-cast:com.google.cast.media";
    /// Récepteur multimédia par défaut de Google.
    const DEFAULT_APP: &str = "CC1AD845";

    /// Les Chromecast présentent un certificat auto-signé : la connexion est chiffrée
    /// mais l'identité n'est pas vérifiable (comme pour tous les émetteurs Cast tiers).
    #[derive(Debug)]
    struct AcceptAny(Arc<rustls::crypto::CryptoProvider>);

    impl rustls::client::danger::ServerCertVerifier for AcceptAny {
        fn verify_server_cert(&self, _: &rustls::pki_types::CertificateDer<'_>, _: &[rustls::pki_types::CertificateDer<'_>], _: &rustls::pki_types::ServerName<'_>, _: &[u8], _: rustls::pki_types::UnixTime) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(&self, m: &[u8], c: &rustls::pki_types::CertificateDer<'_>, d: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
        }
        fn verify_tls13_signature(&self, m: &[u8], c: &rustls::pki_types::CertificateDer<'_>, d: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
        }
        fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
            self.0.signature_verification_algorithms.supported_schemes()
        }
    }

    pub struct Connection {
        stream: tokio_rustls::client::TlsStream<TcpStream>,
    }

    fn varint(out: &mut Vec<u8>, mut v: u64) {
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                return;
            }
            out.push(b | 0x80);
        }
    }

    fn field_str(out: &mut Vec<u8>, field: u8, s: &str) {
        out.push((field << 3) | 2);
        varint(out, s.len() as u64);
        out.extend_from_slice(s.as_bytes());
    }

    /// CastMessage (protobuf) : version, source, destination, espace de noms, charge JSON.
    fn encode(dest: &str, ns: &str, payload: &Value) -> Vec<u8> {
        let mut m = Vec::new();
        m.extend_from_slice(&[0x08, 0x00]);
        field_str(&mut m, 2, SENDER);
        field_str(&mut m, 3, dest);
        field_str(&mut m, 4, ns);
        m.extend_from_slice(&[0x28, 0x00]);
        field_str(&mut m, 6, &payload.to_string());
        let mut framed = (m.len() as u32).to_be_bytes().to_vec();
        framed.extend(m);
        framed
    }

    /// Espace de noms et charge JSON d'un message reçu.
    fn decode(buf: &[u8]) -> Option<(String, Value)> {
        let (mut i, mut ns, mut payload) = (0usize, None, None);
        while i < buf.len() {
            let key = buf[i];
            i += 1;
            let (field, wire) = (key >> 3, key & 7);
            let read_varint = |i: &mut usize| -> Option<u64> {
                let (mut v, mut shift) = (0u64, 0);
                loop {
                    let b = *buf.get(*i)?;
                    *i += 1;
                    v |= ((b & 0x7f) as u64) << shift;
                    if b & 0x80 == 0 {
                        return Some(v);
                    }
                    shift += 7;
                }
            };
            match wire {
                0 => {
                    read_varint(&mut i)?;
                }
                2 => {
                    let len = read_varint(&mut i)? as usize;
                    let bytes = buf.get(i..i + len)?;
                    i += len;
                    match field {
                        4 => ns = Some(String::from_utf8_lossy(bytes).into_owned()),
                        6 => payload = serde_json::from_slice(bytes).ok(),
                        _ => {}
                    }
                }
                _ => return None,
            }
        }
        Some((ns?, payload?))
    }

    impl Connection {
        pub async fn open(host: &str, port: u16) -> Res<Self> {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let config = rustls::ClientConfig::builder_with_provider(provider.clone())
                .with_safe_default_protocol_versions()
                .map_err(|e| e.to_string())?
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(AcceptAny(provider)))
                .with_no_client_auth();
            let tcp = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect((host, port))).await.map_err(|_| "Écran injoignable.".to_string())?.map_err(|e| format!("Écran injoignable : {e}"))?;
            let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
            let stream = tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp).await.map_err(|e| format!("Connexion chiffrée refusée : {e}"))?;
            Ok(Self { stream })
        }

        async fn send(&mut self, dest: &str, ns: &str, payload: Value) -> Res<()> {
            self.stream.write_all(&encode(dest, ns, &payload)).await.map_err(|e| e.to_string())
        }

        async fn recv(&mut self) -> Res<(String, Value)> {
            loop {
                let mut len = [0u8; 4];
                self.stream.read_exact(&mut len).await.map_err(|e| format!("Écran déconnecté : {e}"))?;
                let n = u32::from_be_bytes(len) as usize;
                if n > 1 << 20 {
                    return Err("Message Cast invalide.".into());
                }
                let mut buf = vec![0u8; n];
                self.stream.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
                if let Some(m) = decode(&buf) {
                    return Ok(m);
                }
            }
        }
    }

    pub async fn run(mut c: Connection, url: String, ctype: &'static str, media: CastMedia, mut rx: mpsc::UnboundedReceiver<Command>, status: Arc<Mutex<CastStatus>>) -> Res<()> {
        let mut req = 1u64;
        c.send(RECEIVER, NS_CONN, json!({ "type": "CONNECT" })).await?;
        c.send(RECEIVER, NS_RECV, json!({ "type": "LAUNCH", "appId": DEFAULT_APP, "requestId": req })).await?;
        // Attente de l'application lancée (identifiant de transport et de session).
        let (transport, session) = loop {
            let (ns, msg) = tokio::time::timeout(Duration::from_secs(20), c.recv()).await.map_err(|_| "L'écran n'a pas lancé le lecteur.".to_string())??;
            if ns == NS_HEART && msg["type"] == "PING" {
                c.send(RECEIVER, NS_HEART, json!({ "type": "PONG" })).await?;
            }
            if msg["type"] == "LAUNCH_ERROR" {
                return Err("L'écran a refusé de lancer le lecteur.".into());
            }
            let app = msg["status"]["applications"].as_array().and_then(|a| a.iter().find(|x| x["appId"] == DEFAULT_APP)).cloned();
            if let Some(app) = app {
                break (app["transportId"].as_str().unwrap_or_default().to_string(), app["sessionId"].as_str().unwrap_or_default().to_string());
            }
        };
        c.send(&transport, NS_CONN, json!({ "type": "CONNECT" })).await?;
        req += 1;
        let mut metadata = json!({ "metadataType": 0, "title": media.title });
        if let Some(p) = &media.poster {
            metadata["images"] = json!([{ "url": p }]);
        }
        c.send(
            &transport,
            NS_MEDIA,
            json!({
                "type": "LOAD",
                "requestId": req,
                "autoplay": true,
                "currentTime": media.start,
                "media": { "contentId": url, "contentUrl": url, "streamType": if media.live { "LIVE" } else { "BUFFERED" }, "contentType": ctype, "metadata": metadata },
            }),
        )
        .await?;
        let mut media_session: Option<u64> = None;
        let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
        let mut poll = tokio::time::interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    req += 1;
                    let Some(id) = media_session else {
                        if matches!(cmd, Some(Command::Stop) | None) {
                            let _ = c.send(RECEIVER, NS_RECV, json!({ "type": "STOP", "sessionId": session, "requestId": req })).await;
                            return Ok(());
                        }
                        continue;
                    };
                    match cmd {
                        Some(Command::Play) => c.send(&transport, NS_MEDIA, json!({ "type": "PLAY", "mediaSessionId": id, "requestId": req })).await?,
                        Some(Command::Pause) => c.send(&transport, NS_MEDIA, json!({ "type": "PAUSE", "mediaSessionId": id, "requestId": req })).await?,
                        Some(Command::Seek(p)) => c.send(&transport, NS_MEDIA, json!({ "type": "SEEK", "mediaSessionId": id, "currentTime": p, "requestId": req })).await?,
                        Some(Command::Stop) | None => {
                            let _ = c.send(RECEIVER, NS_RECV, json!({ "type": "STOP", "sessionId": session, "requestId": req })).await;
                            let mut s = status.lock().await;
                            s.active = false;
                            s.state = "IDLE".into();
                            return Ok(());
                        }
                    }
                }
                _ = heartbeat.tick() => c.send(RECEIVER, NS_HEART, json!({ "type": "PING" })).await?,
                _ = poll.tick() => {
                    if let Some(id) = media_session {
                        req += 1;
                        c.send(&transport, NS_MEDIA, json!({ "type": "GET_STATUS", "mediaSessionId": id, "requestId": req })).await?;
                    }
                }
                msg = c.recv() => {
                    let (ns, msg) = msg?;
                    if ns == NS_HEART && msg["type"] == "PING" {
                        c.send(RECEIVER, NS_HEART, json!({ "type": "PONG" })).await?;
                    } else if ns == NS_MEDIA && msg["type"] == "LOAD_FAILED" {
                        return Err("L'écran ne sait pas lire ce flux.".into());
                    } else if ns == NS_MEDIA && msg["type"] == "MEDIA_STATUS" {
                        if let Some(st) = msg["status"].as_array().and_then(|a| a.first()) {
                            media_session = st["mediaSessionId"].as_u64().or(media_session);
                            let mut s = status.lock().await;
                            s.state = st["playerState"].as_str().unwrap_or("IDLE").to_string();
                            s.position = st["currentTime"].as_f64().unwrap_or(s.position);
                            s.duration = st["media"]["duration"].as_f64().filter(|d| *d > 0.0).or(s.duration);
                            if s.state == "IDLE" && st["idleReason"] == "ERROR" {
                                s.error = Some("L'écran ne sait pas lire ce flux.".into());
                            }
                        }
                    } else if ns == NS_RECV && msg["type"] == "RECEIVER_STATUS" {
                        // Lecteur fermé depuis la télécommande ou une autre application.
                        let still = msg["status"]["applications"].as_array().is_some_and(|a| a.iter().any(|x| x["sessionId"] == session.as_str()));
                        if !still {
                            let mut s = status.lock().await;
                            s.active = false;
                            s.state = "IDLE".into();
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn encodes_and_decodes_messages() {
            let framed = encode("receiver-0", NS_HEART, &json!({ "type": "PING" }));
            let n = u32::from_be_bytes(framed[..4].try_into().unwrap()) as usize;
            assert_eq!(n, framed.len() - 4);
            let (ns, payload) = decode(&framed[4..]).unwrap();
            assert_eq!(ns, NS_HEART);
            assert_eq!(payload["type"], "PING");
        }
    }
}

#[cfg(test)]
mod discovery_tests {
    /// Découverte réelle sur le réseau local : `cargo test -p myiptv live_cast -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_cast_discovery() {
        let http = reqwest::Client::new();
        let (cc, dlna) = tokio::join!(super::discover_chromecast(), super::discover_dlna(&http));
        for d in cc.iter().chain(dlna.iter()) {
            println!("{} | {} | {}:{} | {:?}", d.kind, d.name, d.host, d.port, d.model);
        }
    }
}
