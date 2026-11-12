import type HlsType from "hls.js";
import type MpegtsType from "mpegts.js";
import type { PlayInfo } from "../types";

/**
 * Moteurs de lecture chargés à la demande : ils pèsent plus que le reste de
 * l'interface et ne servent qu'une fois une lecture lancée.
 */
export let Hls: typeof HlsType | null = null;
export let mpegts: typeof MpegtsType | null = null;

let hlsLoading: Promise<void> | null = null;
let mpegtsLoading: Promise<void> | null = null;

function loadHls() {
  hlsLoading ??= import("hls.js").then((m) => void (Hls = m.default));
  return hlsLoading;
}

function loadMpegts() {
  mpegtsLoading ??= import("mpegts.js").then((m) => void (mpegts = m.default));
  return mpegtsLoading;
}

/** Charge le moteur nécessaire à `info` avant de l'attacher à la vidéo. */
export async function loadEngines(info: PlayInfo): Promise<void> {
  if (info.kind === "hls") await loadHls();
  else if (info.kind === "mpegts" || (info.kind === "remux" && info.remuxFormat === "mpegts")) await loadMpegts();
}

/** Préchargement discret, une fois l'interface affichée. */
export function preloadEngines(): void {
  const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => void loadHls());
}
