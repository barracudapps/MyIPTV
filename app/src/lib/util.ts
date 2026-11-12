export const nowSec = () => Math.floor(Date.now() / 1000);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

export function fmtDuration(secs: number) {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function current<T extends { start: number; stop: number }>(list: T[] | undefined, at = nowSec()) {
  if (!list) return { now: undefined, next: undefined };
  const i = list.findIndex((p) => p.start <= at && p.stop > at);
  return { now: i >= 0 ? list[i] : undefined, next: i >= 0 ? list[i + 1] : list.find((p) => p.start > at) };
}

export function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
