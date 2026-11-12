//! Moteur de timeshift : enregistre le direct sur disque en segments et le
//! re-diffuse sous forme de playlist HLS locale. Le lecteur peut ainsi mettre
//! en pause, revenir en arrière dans toute la fenêtre enregistrée, puis
//! rattraper le direct, que la source soit en HLS ou en MPEG-TS continu.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, REFERER, USER_AGENT};
use tokio::sync::Notify;
use url::Url;

pub const DEFAULT_UA: &str = "VLC/3.0.21 LibVLC/3.0.21";

#[derive(Clone, Debug)]
pub struct Upstream {
    pub url: String,
    pub user_agent: Option<String>,
    pub referrer: Option<String>,
}

impl Upstream {
    pub fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        let ua = self.user_agent.as_deref().unwrap_or(DEFAULT_UA);
        if let Ok(v) = HeaderValue::from_str(ua) {
            h.insert(USER_AGENT, v);
        }
        if let Some(r) = self.referrer.as_deref().and_then(|r| HeaderValue::from_str(r).ok()) {
            h.insert(REFERER, r);
        }
        h
    }
}

#[derive(Debug, Clone)]
struct Segment {
    seq: u64,
    file: String,
    duration: f64,
    discontinuity: bool,
    /// Heure murale (ms) du début du segment, exposée via EXT-X-PROGRAM-DATE-TIME.
    wall_ms: i64,
    /// Ligne #EXT-X-KEY (déjà réécrite) applicable à ce segment.
    key: Option<String>,
}

#[derive(Default)]
struct SessionState {
    segments: VecDeque<Segment>,
    next_seq: u64,
    discontinuity_seq: u64,
    init_file: Option<String>,
    ended: bool,
    error: Option<String>,
    pending_discontinuity: bool,
}

pub struct Session {
    pub id: String,
    pub dir: PathBuf,
    state: Arc<Mutex<SessionState>>,
    ready: Arc<Notify>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Clone)]
struct Recorder {
    http: reqwest::Client,
    up: Upstream,
    dir: PathBuf,
    state: Arc<Mutex<SessionState>>,
    ready: Arc<Notify>,
    window_secs: f64,
    proxy_base: String,
}

impl Recorder {
    fn push_segment(&self, bytes: &[u8], ext: &str, duration: f64, wall_ms: i64, key: Option<String>) -> std::io::Result<()> {
        let mut st = self.state.lock().unwrap();
        let seq = st.next_seq;
        let file = format!("{seq}.{ext}");
        std::fs::write(self.dir.join(&file), bytes)?;
        let discontinuity = std::mem::take(&mut st.pending_discontinuity) && !st.segments.is_empty();
        st.segments.push_back(Segment { seq, file, duration, discontinuity, wall_ms, key });
        st.next_seq += 1;
        // Fenêtre glissante : on supprime les segments les plus anciens.
        let mut total: f64 = st.segments.iter().map(|s| s.duration).sum();
        while total > self.window_secs && st.segments.len() > 3 {
            let old = st.segments.pop_front().unwrap();
            total -= old.duration;
            if st.segments.front().is_some_and(|s| s.discontinuity) {
                st.discontinuity_seq += 1;
            }
            let _ = std::fs::remove_file(self.dir.join(&old.file));
        }
        drop(st);
        self.ready.notify_waiters();
        Ok(())
    }

    fn mark_discontinuity(&self) {
        self.state.lock().unwrap().pending_discontinuity = true;
    }

    fn fail(&self, msg: String) {
        log::warn!("timeshift: {msg}");
        self.state.lock().unwrap().error = Some(msg);
        self.ready.notify_waiters();
    }

    fn proxied(&self, url: &str) -> String {
        crate::server::proxy_url(&self.proxy_base, url, &self.up)
    }

    async fn run(self) {
        let mut backoff = 1u64;
        loop {
            let started = Instant::now();
            let res = self.http.get(&self.up.url).headers(self.up.headers()).send().await;
            let outcome = match res {
                Err(e) => Err(format!("connexion impossible : {e}")),
                Ok(r) if !r.status().is_success() => Err(format!("le serveur a répondu {}", r.status())),
                Ok(r) => {
                    let final_url = r.url().clone();
                    let ct = r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
                    let looks_hls = ct.contains("mpegurl") || final_url.path().ends_with(".m3u8") || final_url.path().ends_with(".m3u");
                    if looks_hls {
                        match r.text().await {
                            Ok(body) if body.trim_start().starts_with("#EXTM3U") => self.hls_loop(final_url, body).await,
                            Ok(_) => Err("playlist HLS invalide".into()),
                            Err(e) => Err(e.to_string()),
                        }
                    } else {
                        self.ts_loop(r).await
                    }
                }
            };
            if self.state.lock().unwrap().ended {
                return;
            }
            match outcome {
                Ok(()) => backoff = 1,
                Err(e) => {
                    let has_data = !self.state.lock().unwrap().segments.is_empty();
                    if !has_data && backoff >= 8 {
                        return self.fail(e);
                    }
                    log::warn!("timeshift: {e}, reconnexion…");
                }
            }
            if started.elapsed() > Duration::from_secs(30) {
                backoff = 1;
            }
            self.mark_discontinuity();
            tokio::time::sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(16);
        }
    }

    // ---------------------------------------------------------------- HLS

    async fn fetch_text(&self, url: &Url) -> Result<(Url, String), String> {
        let r = self.http.get(url.as_str()).headers(self.up.headers()).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() {
            return Err(format!("playlist : HTTP {}", r.status()));
        }
        let u = r.url().clone();
        Ok((u, r.text().await.map_err(|e| e.to_string())?))
    }

    async fn hls_loop(&self, mut url: Url, mut body: String) -> Result<(), String> {
        // Playlist maître : on choisit la variante de plus haut débit.
        if body.contains("#EXT-X-STREAM-INF") {
            let variant = best_variant(&url, &body).ok_or("aucune variante dans la playlist maître")?;
            let (u, b) = self.fetch_text(&variant).await?;
            url = u;
            body = b;
        }
        let mut last_seq: Option<u64> = None;
        let mut init_done = false;
        loop {
            let pl = parse_media_playlist(&url, &body);
            if !init_done {
                if let Some(map) = &pl.map {
                    let bytes = self.download(map).await?;
                    std::fs::write(self.dir.join("init.mp4"), &bytes).map_err(|e| e.to_string())?;
                    self.state.lock().unwrap().init_file = Some("init.mp4".into());
                }
                init_done = true;
            }
            // Au premier passage on ne garde que les ~3 derniers segments (point de direct).
            let skip = if last_seq.is_none() { pl.segments.len().saturating_sub(3) } else { 0 };
            // Le dernier segment de la playlist se termine au bord du direct : l'heure de début
            // de chaque segment s'en déduit, y compris pour ceux téléchargés en rafale.
            let fetched_at = now_ms();
            let mut remaining_ms: i64 = pl.segments.iter().skip(skip).map(|s| (s.duration * 1000.0) as i64).sum();
            let mut new_count = 0;
            for seg in pl.segments.iter().skip(skip) {
                let wall = fetched_at - remaining_ms;
                remaining_ms -= (seg.duration * 1000.0) as i64;
                if let Some(l) = last_seq {
                    // Remise à zéro de la séquence côté serveur : on accepte avec discontinuité.
                    if seg.seq <= l && l - seg.seq < 1000 {
                        continue;
                    }
                    if seg.seq <= l {
                        self.mark_discontinuity();
                    }
                }
                let bytes = self.download(&seg.uri).await?;
                if seg.discontinuity {
                    self.mark_discontinuity();
                }
                let key = seg.key.as_ref().map(|(method, uri, rest)| format!("#EXT-X-KEY:METHOD={method},URI=\"{}\"{rest}", self.proxied(uri.as_str())));
                self.push_segment(&bytes, &seg.ext, seg.duration, wall, key).map_err(|e| e.to_string())?;
                last_seq = Some(seg.seq);
                new_count += 1;
            }
            if pl.ended {
                self.state.lock().unwrap().ended = true;
                self.ready.notify_waiters();
                return Ok(());
            }
            let wait = if new_count == 0 { (pl.target / 2.0).max(1.0) } else { (pl.target / 2.0).clamp(0.5, 2.0) };
            tokio::time::sleep(Duration::from_secs_f64(wait)).await;
            let (u, b) = self.fetch_text(&url).await?;
            url = u;
            body = b;
        }
    }

    async fn download(&self, url: &Url) -> Result<bytes::Bytes, String> {
        let mut last = String::new();
        for attempt in 0..3 {
            match self.http.get(url.as_str()).headers(self.up.headers()).send().await {
                Ok(r) if r.status().is_success() => return r.bytes().await.map_err(|e| e.to_string()),
                Ok(r) => last = format!("segment : HTTP {}", r.status()),
                Err(e) => last = e.to_string(),
            }
            tokio::time::sleep(Duration::from_millis(400 * (attempt + 1))).await;
        }
        Err(last)
    }

    // ---------------------------------------------------------------- MPEG-TS

    async fn ts_loop(&self, resp: reqwest::Response) -> Result<(), String> {
        let mut stream = resp.bytes_stream();
        let mut seg = TsSegmenter::default();
        let mut carry: Vec<u8> = Vec::with_capacity(188 * 1024);
        let mut checked = false;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("flux interrompu : {e}"))?;
            carry.extend_from_slice(&chunk);
            if !checked && carry.len() >= 188 * 4 {
                // Vérifie qu'il s'agit bien de MPEG-TS (octet de synchro 0x47 tous les 188 octets).
                let sync = (0..188).find(|&o| (0..4).all(|k| carry.get(o + k * 188) == Some(&0x47)));
                match sync {
                    Some(o) => {
                        carry.drain(..o);
                    }
                    None => return Err("format de flux non pris en charge pour le timeshift".into()),
                }
                checked = true;
            }
            if !checked {
                continue;
            }
            let mut off = 0;
            while carry.len() - off >= 188 {
                if carry[off] != 0x47 {
                    off += 1; // resynchronisation
                    continue;
                }
                let pkt: &[u8; 188] = carry[off..off + 188].try_into().unwrap();
                if let Some((bytes, duration, wall)) = seg.push(pkt) {
                    self.push_segment(&bytes, "ts", duration, wall, None).map_err(|e| e.to_string())?;
                }
                off += 188;
            }
            carry.drain(..off);
        }
        if let Some((bytes, duration, wall)) = seg.flush() {
            self.push_segment(&bytes, "ts", duration, wall, None).map_err(|e| e.to_string())?;
        }
        Err("fin du flux".into())
    }
}

/// Découpe un flux MPEG-TS continu en segments alignés sur les images clés,
/// en mesurant leur durée grâce aux PCR (horloge du flux).
#[derive(Default)]
pub struct TsSegmenter {
    buf: Vec<u8>,
    pat: Option<[u8; 188]>,
    pmt: Option<[u8; 188]>,
    pmt_pid: Option<u16>,
    first_pcr: Option<f64>,
    last_pcr: Option<f64>,
    started_at: Option<Instant>,
    started_wall: i64,
}

const TARGET_SEG: f64 = 4.0;
const MAX_SEG: f64 = 10.0;

impl TsSegmenter {
    fn pcr(pkt: &[u8; 188]) -> Option<f64> {
        let afc = (pkt[3] >> 4) & 0x3;
        if afc & 0x2 == 0 || pkt[4] < 7 || pkt[5] & 0x10 == 0 {
            return None;
        }
        let b = &pkt[6..11];
        let base = ((b[0] as u64) << 25) | ((b[1] as u64) << 17) | ((b[2] as u64) << 9) | ((b[3] as u64) << 1) | ((b[4] as u64) >> 7);
        Some(base as f64 / 90_000.0)
    }

    fn random_access(pkt: &[u8; 188]) -> bool {
        let afc = (pkt[3] >> 4) & 0x3;
        afc & 0x2 != 0 && pkt[4] > 0 && pkt[5] & 0x40 != 0
    }

    fn elapsed(&self) -> f64 {
        match (self.first_pcr, self.last_pcr) {
            (Some(a), Some(b)) if b >= a && b - a < 60.0 => b - a,
            _ => self.started_at.map(|t| t.elapsed().as_secs_f64()).unwrap_or(0.0),
        }
    }

    /// Ajoute un paquet ; renvoie un segment terminé le cas échéant.
    pub fn push(&mut self, pkt: &[u8; 188]) -> Option<(Vec<u8>, f64, i64)> {
        let pid = (((pkt[1] & 0x1f) as u16) << 8) | pkt[2] as u16;
        let pusi = pkt[1] & 0x40 != 0;
        if pid == 0 && pusi {
            self.pat = Some(*pkt);
            // PAT : on récupère le PID de la PMT du premier programme.
            let start = 4 + if (pkt[3] >> 4) & 0x2 != 0 { 1 + pkt[4] as usize } else { 0 };
            if let Some(&ptr) = pkt.get(start) {
                let t = start + 1 + ptr as usize;
                let mut i = t + 8;
                while i + 4 <= (t + 3 + ((((pkt.get(t + 1)? & 0x0f) as usize) << 8) | *pkt.get(t + 2)? as usize)).saturating_sub(4).min(188) {
                    let prog = ((pkt[i] as u16) << 8) | pkt[i + 1] as u16;
                    if prog != 0 {
                        self.pmt_pid = Some((((pkt[i + 2] & 0x1f) as u16) << 8) | pkt[i + 3] as u16);
                        break;
                    }
                    i += 4;
                }
            }
        } else if Some(pid) == self.pmt_pid && pusi {
            self.pmt = Some(*pkt);
        }

        let pcr = Self::pcr(pkt);
        let mut out = None;
        if !self.buf.is_empty() {
            // L'horloge du paquet courant compte : c'est lui qui ouvrirait le segment suivant.
            if pcr.is_some() && self.first_pcr.is_some() {
                self.last_pcr = pcr;
            }
            let elapsed = self.elapsed();
            if (Self::random_access(pkt) && elapsed >= TARGET_SEG) || elapsed >= MAX_SEG {
                out = self.flush();
            }
        }
        if self.buf.is_empty() {
            self.started_at = Some(Instant::now());
            self.started_wall = now_ms();
            self.first_pcr = pcr;
            self.last_pcr = pcr;
            // Chaque segment commence par PAT + PMT pour être décodable seul.
            if pid != 0 {
                if let (Some(pat), Some(pmt)) = (&self.pat, &self.pmt) {
                    self.buf.extend_from_slice(pat);
                    self.buf.extend_from_slice(pmt);
                }
            }
        }
        if let Some(p) = pcr {
            if self.first_pcr.is_none() {
                self.first_pcr = Some(p);
            }
            self.last_pcr = Some(p);
        }
        self.buf.extend_from_slice(pkt);
        out
    }

    pub fn flush(&mut self) -> Option<(Vec<u8>, f64, i64)> {
        if self.buf.len() < 188 * 8 {
            return None;
        }
        let d = self.elapsed().max(0.1);
        self.first_pcr = None;
        self.last_pcr = None;
        Some((std::mem::take(&mut self.buf), d, self.started_wall))
    }
}

// ---------------------------------------------------------------- Parsing HLS

pub fn best_variant(base: &Url, body: &str) -> Option<Url> {
    let mut best: Option<(u64, Url)> = None;
    let mut pending_bw: Option<u64> = None;
    for line in body.lines().map(str::trim) {
        if let Some(attrs) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let bw = attrs
                .split(',')
                .find_map(|kv| kv.trim().strip_prefix("BANDWIDTH="))
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            pending_bw = Some(bw);
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Some(bw) = pending_bw.take() {
                if let Ok(u) = base.join(line) {
                    if best.as_ref().map_or(true, |(b, _)| bw > *b) {
                        best = Some((bw, u));
                    }
                }
            }
        }
    }
    best.map(|(_, u)| u)
}

struct MediaSeg {
    seq: u64,
    uri: Url,
    ext: String,
    duration: f64,
    discontinuity: bool,
    key: Option<(String, Url, String)>,
}

struct MediaPlaylist {
    target: f64,
    segments: Vec<MediaSeg>,
    map: Option<Url>,
    ended: bool,
}

fn attr_value<'a>(attrs: &'a str, name: &str) -> Option<&'a str> {
    let i = attrs.find(&format!("{name}="))? + name.len() + 1;
    let rest = &attrs[i..];
    if let Some(r) = rest.strip_prefix('"') {
        r.split('"').next()
    } else {
        rest.split(',').next()
    }
}

fn parse_media_playlist(base: &Url, body: &str) -> MediaPlaylist {
    let mut pl = MediaPlaylist { target: 6.0, segments: vec![], map: None, ended: false };
    let mut seq = 0u64;
    let mut dur = 0.0;
    let mut disc = false;
    let mut key: Option<(String, Url, String)> = None;
    for line in body.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            pl.target = v.parse().unwrap_or(6.0);
        } else if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            seq = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("#EXTINF:") {
            dur = v.split(',').next().and_then(|d| d.parse().ok()).unwrap_or(pl.target);
        } else if line == "#EXT-X-DISCONTINUITY" {
            disc = true;
        } else if line == "#EXT-X-ENDLIST" {
            pl.ended = true;
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-MAP:") {
            pl.map = attr_value(attrs, "URI").and_then(|u| base.join(u).ok());
        } else if let Some(attrs) = line.strip_prefix("#EXT-X-KEY:") {
            let method = attr_value(attrs, "METHOD").unwrap_or("NONE").to_string();
            key = match (method.as_str(), attr_value(attrs, "URI").and_then(|u| base.join(u).ok())) {
                ("NONE", _) | (_, None) => None,
                (_, Some(u)) => {
                    let iv = attr_value(attrs, "IV").map(|iv| format!(",IV={iv}")).unwrap_or_default();
                    Some((method, u, iv))
                }
            };
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Ok(uri) = base.join(line) {
                let ext = uri
                    .path()
                    .rsplit('.')
                    .next()
                    .filter(|e| e.len() <= 4 && e.chars().all(|c| c.is_ascii_alphanumeric()))
                    .unwrap_or("ts")
                    .to_string();
                pl.segments.push(MediaSeg { seq, uri, ext, duration: dur, discontinuity: std::mem::take(&mut disc), key: key.clone() });
            }
            seq += 1;
        }
    }
    pl
}

// ---------------------------------------------------------------- API

impl Session {
    pub fn start(http: reqwest::Client, up: Upstream, root: PathBuf, window_secs: f64, proxy_base: String) -> std::io::Result<Session> {
        let id = format!("{:x}", now_ms());
        let dir = root.join(&id);
        std::fs::create_dir_all(&dir)?;
        let state = Arc::new(Mutex::new(SessionState::default()));
        let ready = Arc::new(Notify::new());
        let rec = Recorder { http, up, dir: dir.clone(), state: state.clone(), ready: ready.clone(), window_secs, proxy_base };
        let task = tokio::spawn(rec.run());
        Ok(Session { id, dir, state, ready, task })
    }

    /// Attend que le premier segment soit disponible (ou une erreur).
    pub async fn wait_ready(&self, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        loop {
            let notified = self.ready.notified();
            {
                let st = self.state.lock().unwrap();
                if let Some(e) = &st.error {
                    return Err(e.clone());
                }
                if !st.segments.is_empty() || st.ended {
                    return Ok(());
                }
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("délai dépassé : la chaîne ne répond pas".into());
            }
            let _ = tokio::time::timeout(left.min(Duration::from_millis(500)), notified).await;
        }
    }

    pub fn playlist(&self) -> String {
        let st = self.state.lock().unwrap();
        let target = st.segments.iter().map(|s| s.duration).fold(1.0, f64::max).ceil() as u64;
        let mut out = String::with_capacity(st.segments.len() * 80 + 200);
        out.push_str("#EXTM3U\n");
        out.push_str(if st.init_file.is_some() { "#EXT-X-VERSION:7\n" } else { "#EXT-X-VERSION:3\n" });
        out.push_str(&format!("#EXT-X-TARGETDURATION:{target}\n"));
        out.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{}\n", st.segments.front().map_or(0, |s| s.seq)));
        out.push_str(&format!("#EXT-X-DISCONTINUITY-SEQUENCE:{}\n", st.discontinuity_seq));
        if let Some(init) = &st.init_file {
            out.push_str(&format!("#EXT-X-MAP:URI=\"{init}\"\n"));
        }
        let mut current_key: Option<&str> = None;
        for s in &st.segments {
            if s.discontinuity {
                out.push_str("#EXT-X-DISCONTINUITY\n");
            }
            if s.key.as_deref() != current_key {
                out.push_str(s.key.as_deref().unwrap_or("#EXT-X-KEY:METHOD=NONE"));
                out.push('\n');
                current_key = s.key.as_deref();
            }
            out.push_str(&format!("#EXT-X-PROGRAM-DATE-TIME:{}\n", iso8601(s.wall_ms)));
            out.push_str(&format!("#EXTINF:{:.3},\n{}\n", s.duration, s.file));
        }
        if st.ended {
            out.push_str("#EXT-X-ENDLIST\n");
        }
        out
    }

    /// Fenêtre enregistrée en secondes.
    pub fn buffered_secs(&self) -> f64 {
        self.state.lock().unwrap().segments.iter().map(|s| s.duration).sum()
    }
}

fn iso8601(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Conversion jour -> date civile (algorithme de Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso8601(1_794_488_400_123), "2026-11-12T13:00:00.123Z");
    }

    #[test]
    fn picks_best_variant_and_parses_media() {
        let base = Url::parse("https://cdn.example/live/master.m3u8").unwrap();
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nhigh/index.m3u8\n";
        assert_eq!(best_variant(&base, master).unwrap().as_str(), "https://cdn.example/live/high/index.m3u8");
        let media = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-KEY:METHOD=AES-128,URI=\"k.key\",IV=0x01\n#EXTINF:6.0,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:5.5,\nb.ts?x=1\n";
        let pl = parse_media_playlist(&base, media);
        assert_eq!(pl.segments.len(), 2);
        assert_eq!(pl.segments[1].seq, 101);
        assert!(pl.segments[1].discontinuity);
        assert_eq!(pl.segments[1].ext, "ts");
        assert_eq!(pl.segments[0].key.as_ref().unwrap().1.as_str(), "https://cdn.example/live/k.key");
    }

    #[test]
    fn ts_segmenter_cuts_on_keyframes_using_pcr() {
        let mut seg = TsSegmenter::default();
        let mut produced = vec![];
        // Paquet vidéo avec PCR ; image clé (RAI) toutes les 2 s, 100 paquets par seconde.
        for i in 0..1200u64 {
            let mut p = [0u8; 188];
            p[0] = 0x47;
            p[1] = 0x41;
            p[2] = 0x00; // PID 0x100
            p[3] = 0x30; // adaptation + payload
            p[4] = 7;
            let t = i as f64 / 100.0;
            p[5] = 0x10 | if i % 200 == 0 { 0x40 } else { 0 };
            let base = (t * 90_000.0) as u64;
            p[6] = (base >> 25) as u8;
            p[7] = (base >> 17) as u8;
            p[8] = (base >> 9) as u8;
            p[9] = (base >> 1) as u8;
            p[10] = ((base & 1) << 7) as u8;
            if let Some(s) = seg.push(&p) {
                produced.push(s.1);
            }
        }
        assert!(produced.len() >= 2, "{produced:?}");
        for d in produced {
            assert!((d - 4.0).abs() < 0.05, "durée {d}");
        }
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Test réseau : `STREAM_URL=… cargo test -p myiptv live_ -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_records_real_stream() {
        let url = std::env::var("STREAM_URL").expect("STREAM_URL");
        let root = std::env::temp_dir().join("myiptv-live-test");
        let sess = Session::start(reqwest::Client::new(), Upstream { url, user_agent: None, referrer: None }, root, 300.0, "http://127.0.0.1:1".into()).unwrap();
        sess.wait_ready(Duration::from_secs(30)).await.expect("premier segment");
        tokio::time::sleep(Duration::from_secs(15)).await;
        let pl = sess.playlist();
        println!("{pl}");
        let segs: Vec<_> = pl.lines().filter(|l| !l.starts_with('#') && !l.is_empty()).collect();
        assert!(segs.len() >= 2, "au moins deux segments enregistrés");
        for s in &segs {
            let len = std::fs::metadata(sess.dir.join(s)).unwrap().len();
            assert!(len > 1000, "segment {s} vide");
        }
        assert!(sess.buffered_secs() > 5.0);
    }
}
