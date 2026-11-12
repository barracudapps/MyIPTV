import type Hls from "hls.js";
import type { AspectMode, AudioMode } from "./parental";
import { code639_1 } from "./trackLang";

// ------------------------------------------------------------------ Son (WebAudio)

interface Graph {
  ctx: AudioContext;
  compressor: DynamicsCompressorNode;
  voice: BiquadFilterNode;
  gain: GainNode;
}

const graphs = new WeakMap<HTMLMediaElement, Graph>();

/**
 * Dynamique du son. Le graphe n'est créé qu'au premier changement : une fois
 * branché, l'élément vidéo passe obligatoirement par WebAudio.
 */
export function applyAudioMode(el: HTMLMediaElement, mode: AudioMode) {
  let g = graphs.get(el);
  if (!g) {
    if (mode === "normal") return;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    const compressor = ctx.createDynamicsCompressor();
    const voice = ctx.createBiquadFilter();
    voice.type = "peaking";
    voice.frequency.value = 2400;
    voice.Q.value = 0.9;
    const gain = ctx.createGain();
    src.connect(compressor).connect(voice).connect(gain).connect(ctx.destination);
    g = { ctx, compressor, voice, gain };
    graphs.set(el, g);
  }
  void g.ctx.resume();
  const c = g.compressor;
  const set = (threshold: number, ratio: number, knee: number, voiceDb: number, gain: number) => {
    c.threshold.value = threshold;
    c.ratio.value = ratio;
    c.knee.value = knee;
    c.attack.value = 0.005;
    c.release.value = 0.25;
    g!.voice.gain.value = voiceDb;
    g!.gain.gain.value = gain;
  };
  switch (mode) {
    case "normal":
      set(0, 1, 0, 0, 1);
      break;
    case "night": // écarts réduits : dialogues audibles sans explosions
      set(-42, 12, 30, 2, 1.9);
      break;
    case "voice": // dialogues mis en avant
      set(-24, 4, 20, 7, 1.2);
      break;
    case "boost": // volume renforcé, limiteur pour éviter la saturation
      set(-10, 20, 0, 0, 2.4);
      break;
  }
}

// ------------------------------------------------------------------ Image

export function videoStyle(aspect: AspectMode, brightness: number, contrast: number, saturation: number): React.CSSProperties {
  const filter = brightness === 1 && contrast === 1 && saturation === 1 ? undefined : `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
  const ratios: Partial<Record<AspectMode, string>> = { "16:9": "16 / 9", "4:3": "4 / 3", "21:9": "21 / 9" };
  if (ratios[aspect]) {
    return { filter, objectFit: "fill", aspectRatio: ratios[aspect], width: "auto", height: "auto", maxWidth: "100%", maxHeight: "100%", margin: "auto" };
  }
  return { filter, objectFit: aspect as "contain" | "cover" | "fill" };
}

export const PICTURE_PRESETS: { id: string; label: string; brightness: number; contrast: number; saturation: number }[] = [
  { id: "standard", label: "Standard", brightness: 1, contrast: 1, saturation: 1 },
  { id: "cinema", label: "Cinéma", brightness: 0.95, contrast: 1.1, saturation: 0.92 },
  { id: "vivid", label: "Éclatant", brightness: 1.05, contrast: 1.15, saturation: 1.35 },
  { id: "sport", label: "Sport", brightness: 1.08, contrast: 1.1, saturation: 1.2 },
  { id: "dark", label: "Pièce sombre", brightness: 0.85, contrast: 1.05, saturation: 0.95 },
];

// ------------------------------------------------------------------ Pistes

export interface TrackOption {
  id: number;
  label: string;
  lang?: string;
}

export interface Tracks {
  audio: TrackOption[];
  audioCurrent: number;
  subtitles: TrackOption[];
  /** -1 = désactivés. */
  subtitleCurrent: number;
  qualities: TrackOption[];
  /** -1 = automatique. */
  qualityCurrent: number;
}

export const NO_TRACKS: Tracks = { audio: [], audioCurrent: -1, subtitles: [], subtitleCurrent: -1, qualities: [], qualityCurrent: -1 };

type NativeAudioTrack = { id: string; label: string; language: string; enabled: boolean };
type VideoWithTracks = HTMLVideoElement & { audioTracks?: ArrayLike<NativeAudioTrack> & { length: number } };

const label = (name: string | undefined, lang: string | undefined, i: number) => name?.trim() || (lang ? lang.toUpperCase() : `Piste ${i + 1}`);

export function readTracks(video: HTMLVideoElement, hls: Hls | null): Tracks {
  if (hls) {
    return {
      audio: hls.audioTracks.map((t, i) => ({ id: i, label: label(t.name, t.lang, i), lang: code639_1(t.lang) })),
      audioCurrent: hls.audioTrack,
      subtitles: hls.subtitleTracks.map((t, i) => ({ id: i, label: label(t.name, t.lang, i), lang: code639_1(t.lang) })),
      subtitleCurrent: hls.subtitleTrack,
      qualities: hls.levels.map((l, i) => ({ id: i, label: l.height ? `${l.height}p${l.bitrate ? ` · ${(l.bitrate / 1e6).toFixed(1)} Mb/s` : ""}` : `${Math.round(l.bitrate / 1000)} kb/s` })),
      qualityCurrent: hls.autoLevelEnabled ? -1 : hls.currentLevel,
    };
  }
  const v = video as VideoWithTracks;
  const audio: TrackOption[] = [];
  let audioCurrent = -1;
  if (v.audioTracks) {
    for (let i = 0; i < v.audioTracks.length; i++) {
      const t = v.audioTracks[i];
      audio.push({ id: i, label: label(t.label, t.language, i), lang: code639_1(t.language) });
      if (t.enabled) audioCurrent = i;
    }
  }
  const subtitles: TrackOption[] = [];
  let subtitleCurrent = -1;
  for (let i = 0; i < video.textTracks.length; i++) {
    const t = video.textTracks[i];
    if (t.kind !== "subtitles" && t.kind !== "captions") continue;
    subtitles.push({ id: i, label: label(t.label, t.language, i), lang: code639_1(t.language) });
    if (t.mode === "showing") subtitleCurrent = i;
  }
  return { ...NO_TRACKS, audio, audioCurrent, subtitles, subtitleCurrent };
}

export function setAudio(video: HTMLVideoElement, hls: Hls | null, id: number) {
  if (hls) hls.audioTrack = id;
  else {
    const v = video as VideoWithTracks;
    if (v.audioTracks) for (let i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = i === id;
  }
}

export function setSubtitle(video: HTMLVideoElement, hls: Hls | null, id: number) {
  if (hls) {
    hls.subtitleTrack = id;
    hls.subtitleDisplay = id >= 0;
  }
  for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = !hls && i === id ? "showing" : hls ? video.textTracks[i].mode : "disabled";
}

export function setQuality(hls: Hls | null, id: number) {
  if (hls) hls.currentLevel = id;
}

/**
 * Choix automatique selon les langues favorites : audio dans la première langue
 * disponible ; sous-titres si demandé ou si l'audio n'est dans aucune langue favorite.
 */
export function autoSelect(video: HTMLVideoElement, hls: Hls | null, prefs: string[], subtitlesByDefault: boolean) {
  const t = readTracks(video, hls);
  const rank = (lang?: string) => {
    const i = lang ? prefs.indexOf(lang) : -1;
    return i < 0 ? 99 : i;
  };
  const bestAudio = [...t.audio].sort((a, b) => rank(a.lang) - rank(b.lang))[0];
  if (bestAudio && bestAudio.id !== t.audioCurrent && rank(bestAudio.lang) < 99) setAudio(video, hls, bestAudio.id);
  const audioLang = bestAudio?.lang;
  const understood = audioLang ? rank(audioLang) < 99 : true;
  if (subtitlesByDefault || !understood) {
    const sub = [...t.subtitles].sort((a, b) => rank(a.lang) - rank(b.lang))[0];
    if (sub && rank(sub.lang) < 99) setSubtitle(video, hls, sub.id);
  }
}
