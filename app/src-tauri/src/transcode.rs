//! Lecture des formats que la webview ne sait pas lire (MKV, AVI, son AC3/DTS…) :
//! ffprobe analyse le fichier, ffmpeg le rediffuse à la volée en MP4 fragmenté.
//! La vidéo est copiée sans perte quand son codec est lisible ; seul le son est
//! converti si nécessaire, ce qui reste léger pour le processeur.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;

use crate::timeshift::{Upstream, DEFAULT_UA};

/// ffmpeg / ffprobe : les applications graphiques macOS n'héritent pas du PATH du terminal.
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin", "C:\\ffmpeg\\bin"].map(PathBuf::from));
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamTrack {
    /// Index parmi les pistes du même type.
    pub index: usize,
    pub codec: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub container: String,
    pub duration: Option<f64>,
    pub video_codec: Option<String>,
    pub audio: Vec<StreamTrack>,
    pub subtitles: Vec<StreamTrack>,
}

const WEB_VIDEO: &[&str] = &["h264", "hevc", "vp9", "vp8", "av1"];
const WEB_AUDIO: &[&str] = &["aac", "mp3"];

impl Probe {
    /// La webview peut-elle lire le fichier tel quel ?
    /// MPEG-TS pour H.264/HEVC (lu par mpegts.js sans requêtes par plages, que WebKit
    /// exige pour un MP4) ; MP4 fragmenté pour VP9/AV1, que le MPEG-TS ne transporte pas.
    pub fn remux_format(&self) -> &'static str {
        match self.video_codec.as_deref() {
            Some("vp9") | Some("vp8") | Some("av1") => "mp4",
            _ => "mpegts",
        }
    }

    pub fn web_playable(&self) -> bool {
        let container_ok = self.container.starts_with("mov,mp4") || self.container == "mp3" || self.container == "aac";
        let video_ok = self.video_codec.as_deref().map_or(true, |c| WEB_VIDEO.contains(&c));
        let audio_ok = self.audio.first().map_or(true, |a| WEB_AUDIO.contains(&a.codec.as_str()));
        container_ok && video_ok && audio_ok
    }
}

pub fn parse_probe(v: &Value) -> Probe {
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let mut audio = vec![];
    let mut subtitles = vec![];
    let mut video_codec = None;
    for s in &streams {
        let codec = s["codec_name"].as_str().unwrap_or("").to_string();
        let tag = |k: &str| s["tags"][k].as_str().map(str::to_string).filter(|x| !x.is_empty() && x != "und");
        match s["codec_type"].as_str() {
            Some("video") if video_codec.is_none() && s["disposition"]["attached_pic"].as_i64() != Some(1) => video_codec = Some(codec),
            Some("audio") => audio.push(StreamTrack { index: audio.len(), codec, language: tag("language"), title: tag("title"), channels: s["channels"].as_u64() }),
            Some("subtitle") => subtitles.push(StreamTrack { index: subtitles.len(), codec, language: tag("language"), title: tag("title"), channels: None }),
            _ => {}
        }
    }
    Probe {
        container: v["format"]["format_name"].as_str().unwrap_or("").to_string(),
        duration: v["format"]["duration"].as_str().and_then(|d| d.parse().ok()),
        video_codec,
        audio,
        subtitles,
    }
}

fn is_network(up: &Upstream) -> bool {
    up.url.starts_with("http://") || up.url.starts_with("https://")
}

/// Options HTTP : refusées par ffmpeg pour un fichier local.
fn header_args(up: &Upstream) -> Vec<String> {
    if !is_network(up) {
        return vec![];
    }
    let mut a = vec!["-user_agent".to_string(), up.user_agent.clone().unwrap_or_else(|| DEFAULT_UA.into())];
    if let Some(r) = &up.referrer {
        a.push("-headers".into());
        a.push(format!("Referer: {r}\r\n"));
    }
    a
}

pub async fn probe(up: &Upstream) -> Result<Probe, String> {
    let ffprobe = find_tool("ffprobe").ok_or("ffprobe introuvable")?;
    let mut cmd = Command::new(ffprobe);
    cmd.args(["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,channels:stream_tags=language,title:stream_disposition=attached_pic", "-of", "json"])
        .args(header_args(up))
        .arg(&up.url)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(20), cmd.output()).await.map_err(|_| "analyse du fichier trop longue")?.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("fichier illisible".into());
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    Ok(parse_probe(&v))
}

/// Arguments ffmpeg de la rediffusion en MP4 fragmenté.
pub fn remux_args(up: &Upstream, p: &Probe, start: f64, audio: usize) -> Vec<String> {
    let mut a: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into(), "-nostdin".into()];
    a.extend(header_args(up));
    if is_network(up) {
        a.extend(["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"].map(String::from));
    }
    if start > 0.5 {
        a.extend(["-ss".into(), format!("{start:.3}")]);
    }
    a.extend(["-i".into(), up.url.clone()]);
    a.extend(["-map".into(), "0:v:0?".into(), "-map".into(), format!("0:a:{audio}?"), "-sn".into(), "-dn".into()]);
    match p.video_codec.as_deref() {
        Some(c) if WEB_VIDEO.contains(&c) => {
            a.extend(["-c:v", "copy"].map(String::from));
            if c == "hevc" && p.remux_format() == "mp4" {
                // Étiquette requise par Safari/WebKit pour le HEVC en MP4.
                a.extend(["-tag:v", "hvc1"].map(String::from));
            }
        }
        // Codec vidéo ancien (MPEG-2, MPEG-4 Part 2…) : conversion rapide.
        Some(_) => a.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"].map(String::from)),
        // Codec inconnu (analyse impossible) : copie, plutôt que le MPEG-2 par défaut de ffmpeg.
        None => a.extend(["-c:v", "copy"].map(String::from)),
    }
    let acodec = p.audio.get(audio).map(|t| t.codec.as_str()).unwrap_or("");
    if p.audio.is_empty() && p.video_codec.is_none() {
        // Rien n'est connu du flux : AAC est sûr pour tout son d'entrée.
        a.extend(["-c:a", "aac", "-b:a", "192k"].map(String::from));
    } else if WEB_AUDIO.contains(&acodec) {
        a.extend(["-c:a", "copy"].map(String::from));
    } else {
        // Le 5.1 est conservé : AAC le gère et les webviews le décodent.
        a.extend(["-c:a", "aac", "-b:a", "256k"].map(String::from));
    }
    if p.remux_format() == "mpegts" {
        a.extend(["-f", "mpegts", "-muxdelay", "0", "-muxpreload", "0", "pipe:1"].map(String::from));
    } else {
        a.extend(["-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"].map(String::from));
    }
    a
}

pub fn spawn_remux(up: &Upstream, p: &Probe, start: f64, audio: usize) -> Result<tokio::process::Child, String> {
    let ffmpeg = find_tool("ffmpeg").ok_or("ffmpeg introuvable")?;
    Command::new(ffmpeg)
        .args(remux_args(up, p, start, audio))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("ffmpeg : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mkv() -> Probe {
        parse_probe(&json!({
            "format": { "format_name": "matroska,webm", "duration": "5400.5" },
            "streams": [
                { "codec_type": "video", "codec_name": "hevc" },
                { "codec_type": "audio", "codec_name": "eac3", "channels": 6, "tags": { "language": "fre", "title": "VF 5.1" } },
                { "codec_type": "audio", "codec_name": "aac", "tags": { "language": "eng" } },
                { "codec_type": "subtitle", "codec_name": "subrip", "tags": { "language": "fre" } }
            ]
        }))
    }

    #[test]
    fn parses_probe_and_decides() {
        let p = mkv();
        assert_eq!(p.duration, Some(5400.5));
        assert_eq!(p.audio.len(), 2);
        assert_eq!(p.audio[0].language.as_deref(), Some("fre"));
        assert_eq!(p.subtitles.len(), 1);
        assert!(!p.web_playable(), "MKV + E-AC3");
        let mp4 = parse_probe(&json!({ "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" }, "streams": [ { "codec_type": "video", "codec_name": "h264" }, { "codec_type": "audio", "codec_name": "aac" } ] }));
        assert!(mp4.web_playable());
        let ac3 = parse_probe(&json!({ "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2" }, "streams": [ { "codec_type": "video", "codec_name": "h264" }, { "codec_type": "audio", "codec_name": "ac3" } ] }));
        assert!(!ac3.web_playable(), "AC3 dans un MP4");
    }

    #[test]
    fn builds_remux_arguments() {
        let up = Upstream { url: "http://x/f.mkv".into(), user_agent: None, referrer: Some("http://r".into()) };
        let a = remux_args(&up, &mkv(), 120.0, 1).join(" ");
        assert!(a.contains("-ss 120.000 -i http://x/f.mkv"));
        assert!(a.contains("-map 0:a:1?"));
        assert!(a.contains("-c:v copy"));
        assert!(a.ends_with("-f mpegts -muxdelay 0 -muxpreload 0 pipe:1"), "HEVC : MPEG-TS");
        assert!(a.contains("-c:a copy"), "la piste 1 est déjà en AAC");
        assert!(remux_args(&up, &mkv(), 0.0, 0).join(" ").contains("-c:a aac"));
        assert!(a.contains("Referer: http://r"));
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    /// Nécessite ffmpeg : `cargo test -p myiptv live_remux -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn live_remux_mkv_ac3_to_fmp4() {
        let dir = std::env::temp_dir().join("myiptv-remux-test");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("film.mkv");
        let ok = std::process::Command::new(find_tool("ffmpeg").unwrap())
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-ac", "6", "-t", "6", "-c:v", "libx264", "-c:a", "ac3", "-metadata:s:a:0", "language=fre"])
            .arg(&src)
            .status()
            .unwrap()
            .success();
        assert!(ok, "génération du MKV");
        let up = Upstream { url: src.to_string_lossy().into(), user_agent: None, referrer: None };
        let p = probe(&up).await.unwrap();
        assert!(!p.web_playable());
        assert_eq!(p.audio[0].codec, "ac3");
        let mut child = spawn_remux(&up, &p, 2.0, 0).unwrap();
        let mut out = Vec::new();
        child.stdout.take().unwrap().read_to_end(&mut out).await.unwrap();
        let dst = dir.join("out.ts");
        std::fs::write(&dst, &out).unwrap();
        let back = probe(&Upstream { url: dst.to_string_lossy().into(), user_agent: None, referrer: None }).await.unwrap();
        assert_eq!(back.container, "mpegts");
        assert_eq!(back.video_codec.as_deref(), Some("h264"));
        assert_eq!(back.audio[0].codec, "aac");
        assert!(back.duration.unwrap_or(0.0) > 3.0, "lecture à partir de 2 s d'un fichier de 6 s");
    }
}
