/** Sous-titres externes (.srt, .vtt) ajoutés par l'utilisateur. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

function seconds(stamp: string): number {
  const m = stamp.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** Lit un fichier SRT ou WebVTT ; les balises de mise en forme simples sont conservées. */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = seconds(a);
    const end = seconds(b.trim().split(/\s+/)[0]);
    const body = lines
      .slice(i + 1)
      .join("\n")
      // SRT : balises de police et de position que WebVTT ne connaît pas.
      .replace(/<\/?font[^>]*>/gi, "")
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && body) cues.push({ start, end, text: body });
  }
  return cues;
}

/** Les fichiers anciens sont souvent en Windows-1252 : on le détecte à l'échec de l'UTF-8. */
export async function readSubtitleFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const tracks = new WeakMap<HTMLVideoElement, TextTrack>();

/** Affiche (ou masque avec `cues = null`) les sous-titres externes, décalés de `offset` secondes. */
export function showExternal(video: HTMLVideoElement, cues: Cue[] | null, offset: number) {
  let track = tracks.get(video);
  if (!cues) {
    if (track) track.mode = "disabled";
    return;
  }
  if (!track) {
    track = video.addTextTrack("subtitles", "Fichier externe", "und");
    tracks.set(video, track);
  }
  track.mode = "hidden";
  for (const c of [...(track.cues ?? [])]) track.removeCue(c);
  for (const c of cues) {
    const start = c.start + offset;
    const end = c.end + offset;
    if (end > 0) track.addCue(new VTTCue(Math.max(0, start), end, c.text));
  }
  track.mode = "showing";
}

/** La piste ajoutée par l'utilisateur, à ignorer dans la liste des pistes du flux. */
export function isExternal(video: HTMLVideoElement, track: TextTrack): boolean {
  return tracks.get(video) === track;
}
