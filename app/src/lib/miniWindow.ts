import { isTauri } from "../platform";

/**
 * Mini-lecteur système : la fenêtre de l'application se réduit à la vidéo,
 * sans bordure, toujours au premier plan et visible sur tous les bureaux,
 * comme l'« image dans l'image » d'un navigateur, mais accessible partout.
 */

interface Saved {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

let saved: Saved | null = null;
const listeners = new Set<(on: boolean) => void>();

export const compactSupported = isTauri;

export function onCompactChange(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isCompact() {
  return saved !== null;
}

export async function enterCompact() {
  if (!isTauri || saved) return;
  const { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const scale = await w.scaleFactor();
  const size = (await w.outerSize()).toLogical(scale);
  const pos = (await w.outerPosition()).toLogical(scale);
  saved = { width: size.width, height: size.height, x: pos.x, y: pos.y, maximized: await w.isMaximized() };
  if (saved.maximized) await w.unmaximize();
  document.documentElement.classList.add("compact-window");
  await w.setDecorations(false);
  await w.setAlwaysOnTop(true);
  await w.setVisibleOnAllWorkspaces(true).catch(() => undefined);
  await w.setMinSize(new LogicalSize(240, 135));
  const width = 432;
  const height = 243;
  await w.setSize(new LogicalSize(width, height));
  const mon = await currentMonitor();
  if (mon) {
    const m = mon.size.toLogical(mon.scaleFactor);
    const o = mon.position.toLogical(mon.scaleFactor);
    await w.setPosition(new LogicalPosition(o.x + m.width - width - 24, o.y + m.height - height - 64));
  }
  listeners.forEach((l) => l(true));
}

export async function exitCompact() {
  if (!isTauri || !saved) return;
  const { getCurrentWindow, LogicalSize, LogicalPosition } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const s = saved;
  saved = null;
  document.documentElement.classList.remove("compact-window");
  await w.setAlwaysOnTop(false);
  await w.setVisibleOnAllWorkspaces(false).catch(() => undefined);
  await w.setDecorations(true);
  await w.setMinSize(new LogicalSize(360, 480));
  await w.setSize(new LogicalSize(s.width, s.height));
  await w.setPosition(new LogicalPosition(s.x, s.y));
  if (s.maximized) await w.maximize();
  listeners.forEach((l) => l(false));
}

export async function startDragging() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}
