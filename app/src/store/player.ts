import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, PlayInfo, Programme } from "../types";
import { channelAccess } from "../lib/parental";
import { errorMessage } from "../lib/util";
import { useSettings } from "./settings";
import { askPin, useUi } from "./ui";

export type PlayerMode = "docked" | "mini" | "hidden";

interface PlayerState {
  channel: Channel | null;
  info: PlayInfo | null;
  /** Programme lu en replay (null = direct). */
  catchup: Programme | null;
  loading: boolean;
  error: string | null;
  mode: PlayerMode;
  /** Liste utilisée pour zapper (chaîne précédente/suivante). */
  zapList: Channel[];
  token: number;

  play(ch: Channel, opts?: { zapList?: Channel[] }): Promise<void>;
  playCatchup(ch: Channel, prog: Programme): Promise<void>;
  zap(delta: number): void;
  stop(): Promise<void>;
  setMode(m: PlayerMode): void;
  retry(): void;
}

async function guard(ch: Channel): Promise<boolean> {
  const s = useSettings.getState();
  const profile = s.profiles.find((p) => p.id === s.activeProfileId);
  if (!profile) return false;
  const access = channelAccess(profile, ch, useUi.getState().adultUnlocked);
  if (access.ok) return true;
  if (access.reason === "adult-pin") {
    const ok = await askPin("Contenu réservé aux adultes", `« ${ch.name} » est protégée par le code parental.`);
    if (ok) useUi.setState({ adultUnlocked: true });
    return ok;
  }
  useUi.getState().toast(access.message, "error");
  return false;
}

export const usePlayer = create<PlayerState>()((set, get) => ({
  channel: null,
  info: null,
  catchup: null,
  loading: false,
  error: null,
  mode: "hidden",
  zapList: [],
  token: 0,

  async play(ch, opts) {
    if (!(await guard(ch))) return;
    const token = get().token + 1;
    set({
      channel: ch,
      catchup: null,
      loading: true,
      error: null,
      info: null,
      token,
      zapList: opts?.zapList ?? get().zapList,
      mode: get().mode === "hidden" ? "docked" : get().mode,
    });
    const settings = useSettings.getState();
    if (settings.activeProfileId) {
      settings.pushRecent(ch.id);
      settings.setLastChannel(settings.activeProfileId, ch.id);
    }
    try {
      const backend = await getBackend();
      const info = await backend.play({
        url: ch.url,
        userAgent: ch.userAgent,
        referrer: ch.referrer,
        timeshift: settings.playback.timeshift && backend.diskTimeshift,
        windowMinutes: settings.playback.windowMinutes,
      });
      if (get().token !== token) return; // une autre chaîne a été lancée entre-temps
      set({ info, loading: false });
      if (info.error) useUi.getState().toast(`Timeshift indisponible pour cette chaîne (${info.error}). Lecture directe.`, "info");
    } catch (e) {
      if (get().token === token) set({ loading: false, error: errorMessage(e) });
    }
  },

  async playCatchup(ch, prog) {
    if (!(await guard(ch))) return;
    const token = get().token + 1;
    set({ channel: ch, catchup: prog, loading: true, error: null, info: null, token, mode: get().mode === "hidden" ? "docked" : get().mode });
    try {
      const backend = await getBackend();
      const url = await backend.catchupUrl(ch, prog.start, prog.stop);
      if (!url) throw new Error("Ce programme n'est pas disponible en replay.");
      const info = await backend.play({ url, userAgent: ch.userAgent, referrer: ch.referrer, timeshift: false, windowMinutes: 0 });
      if (get().token === token) set({ info, loading: false });
    } catch (e) {
      if (get().token === token) set({ loading: false, error: errorMessage(e) });
    }
  },

  zap(delta) {
    const { zapList, channel } = get();
    if (!zapList.length || !channel) return;
    const i = zapList.findIndex((c) => c.id === channel.id);
    const next = zapList[(i + delta + zapList.length) % zapList.length];
    if (next) get().play(next);
  },

  async stop() {
    set({ channel: null, info: null, catchup: null, loading: false, error: null, mode: "hidden", token: get().token + 1 });
    (await getBackend()).stop();
  },

  setMode: (mode) => set({ mode }),

  retry() {
    const { channel, catchup } = get();
    if (!channel) return;
    if (catchup) get().playCatchup(channel, catchup);
    else get().play(channel);
  },
}));
