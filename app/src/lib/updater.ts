import { create } from "zustand";
import { isTauri } from "../platform";

/** Mises à jour depuis les versions publiées sur GitHub (applications de bureau). */
export const canUpdate = isTauri && !/android/i.test(navigator.userAgent);

const AUTO_KEY = "myiptv-updates-auto";

export function autoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoCheck(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    /* préférence facultative */
  }
}

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

interface UpdateState {
  status: "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  version?: string;
  notes?: string;
  progress: number;
  error?: string;
  update?: NonNullable<Update>;
  check(): Promise<void>;
  install(): Promise<void>;
}

export const useUpdates = create<UpdateState>((set, get) => ({
  status: "idle",
  progress: 0,
  async check() {
    if (!canUpdate || get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", error: undefined });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 15_000 });
      if (update) set({ status: "available", update, version: update.version, notes: update.body ?? undefined });
      else set({ status: "none" });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
  async install() {
    const update = get().update;
    if (!update) return;
    set({ status: "downloading", progress: 0 });
    try {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          set({ progress: total ? done / total : 0 });
        }
      });
      set({ status: "ready" });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
