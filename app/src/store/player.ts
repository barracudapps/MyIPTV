import { loadEngines } from "../lib/engines";
import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, Episode, PlayInfo, Programme, VodItem } from "../types";
import { adultAccess, channelAccess, maxAge, type Access, type Profile } from "../lib/parental";
import { errorMessage } from "../lib/util";
import { useSettings } from "./settings";
import { askPin, useUi } from "./ui";
import { fun } from "../lib/fun";

export type PlayerMode = "docked" | "mini" | "hidden";

/** Contenu de la bibliothèque en cours de lecture. */
export interface MediaContext {
  item: VodItem;
  episode?: Episode;
  /** Épisodes / pistes dans l'ordre de lecture (pour enchaîner). */
  queue: Episode[];
  /** Position de reprise, en secondes. */
  resumeAt: number;
  age?: number;
}

interface PlayerState {
  channel: Channel | null;
  media: MediaContext | null;
  info: PlayInfo | null;
  /** Programme lu en replay (null = direct). */
  catchup: Programme | null;
  loading: boolean;
  error: string | null;
  mode: PlayerMode;
  /** Liste utilisée pour zapper (chaîne précédente/suivante). */
  zapList: Channel[];
  token: number;

  play(ch: Channel, opts?: { zapList?: Channel[]; forceRemux?: boolean }): Promise<void>;
  playCatchup(ch: Channel, prog: Programme, forceRemux?: boolean): Promise<void>;
  playMedia(item: VodItem, opts?: { episode?: Episode; queue?: Episode[]; resumeAt?: number; age?: number; forceRemux?: boolean }): Promise<void>;
  nextEpisode(): boolean;
  zap(delta: number): void;
  stop(): Promise<void>;
  setMode(m: PlayerMode): void;
  /** Relance ; `forceRemux` : passer par ffmpeg après un échec du flux direct. */
  retry(forceRemux?: boolean): void;
}

function activeProfile(): Profile | undefined {
  const s = useSettings.getState();
  return s.profiles.find((p) => p.id === s.activeProfileId);
}

async function resolve(access: Access, label: string): Promise<boolean> {
  if (access.ok) return true;
  if (access.reason === "adult-pin") {
    const ok = await askPin("Contenu réservé aux adultes", `« ${label} » est protégé par le code parental.`);
    if (ok) useUi.setState({ adultUnlocked: true });
    return ok;
  }
  useUi.getState().toast(access.message, "error");
  return false;
}

function adultCtx() {
  return { enabled: useSettings.getState().parental.adultEnabled, unlocked: useUi.getState().adultUnlocked };
}

/** Accès à un contenu de la bibliothèque (classification connue par la fiche). */
export function mediaAccess(p: Profile, item: VodItem, age: number | undefined): Access {
  if (item.adult) return adultAccess(p, adultCtx());
  if (p.kind !== "child") return { ok: true };
  if (age != null) return age <= maxAge(p) ? { ok: true } : { ok: false, reason: "blocked", message: `Déconseillé aux moins de ${age} ans.` };
  return p.child!.allowUnrated ? { ok: true } : { ok: false, reason: "blocked", message: "Contenu sans classification d'âge." };
}

export const usePlayer = create<PlayerState>()((set, get) => ({
  channel: null,
  media: null,
  info: null,
  catchup: null,
  loading: false,
  error: null,
  mode: "hidden",
  zapList: [],
  token: 0,

  async play(ch, opts) {
    const profile = activeProfile();
    if (!profile || !(await resolve(channelAccess(profile, ch, adultCtx()), ch.name))) return;
    const token = get().token + 1;
    const zapping = get().channel != null && get().media == null && get().channel?.id !== ch.id;
    set({
      channel: ch,
      media: null,
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
    fun.onPlay(zapping ? "zap" : "live");
    try {
      const backend = await getBackend();
      const info = await backend.play({
        url: ch.url,
        userAgent: ch.userAgent,
        referrer: ch.referrer,
        timeshift: settings.playback.timeshift && backend.diskTimeshift && !opts?.forceRemux,
        windowMinutes: settings.playback.windowMinutes,
        forceRemux: opts?.forceRemux,
      });
      await loadEngines(info);
      if (get().token !== token) return; // une autre chaîne a été lancée entre-temps
      set({ info, loading: false });
      if (info.error) useUi.getState().toast(`Timeshift indisponible pour cette chaîne (${info.error}). Lecture directe.`, "info");
    } catch (e) {
      if (get().token === token) set({ loading: false, error: errorMessage(e) });
    }
  },

  async playCatchup(ch, prog, forceRemux) {
    const profile = activeProfile();
    if (!profile || !(await resolve(channelAccess(profile, ch, adultCtx()), ch.name))) return;
    const token = get().token + 1;
    set({ channel: ch, media: null, catchup: prog, loading: true, error: null, info: null, token, mode: get().mode === "hidden" ? "docked" : get().mode });
    try {
      const backend = await getBackend();
      const url = await backend.catchupUrl(ch, prog.start, prog.stop);
      if (!url) throw new Error("Ce programme n'est pas disponible en replay.");
      const info = await backend.play({ url, userAgent: ch.userAgent, referrer: ch.referrer, timeshift: false, windowMinutes: 0, media: true, forceRemux });
      await loadEngines(info);
      if (get().token === token) set({ info, loading: false });
    } catch (e) {
      if (get().token === token) set({ loading: false, error: errorMessage(e) });
    }
  },

  async playMedia(item, opts = {}) {
    const profile = activeProfile();
    if (!profile || !(await resolve(mediaAccess(profile, item, opts.age), item.title))) return;
    const url = opts.episode?.url ?? item.url;
    if (!url) {
      useUi.getState().toast("Aucun flux lisible pour ce contenu.", "error");
      return;
    }
    const token = get().token + 1;
    set({
      channel: null,
      catchup: null,
      media: { item, episode: opts.episode, queue: opts.queue ?? [], resumeAt: opts.resumeAt ?? 0, age: opts.age },
      loading: true,
      error: null,
      info: null,
      token,
      // Nouveau contenu : grand lecteur ; épisode suivant de la même série : on garde la taille choisie.
      mode: get().mode === "hidden" || get().media?.item.id !== item.id ? "docked" : get().mode,
    });
    fun.onPlay(item.kind === "radio" ? "radio" : "media", item);
    try {
      const info = await (await getBackend()).play({ url, userAgent: item.userAgent, referrer: item.referrer, timeshift: false, windowMinutes: 0, media: !item.live, forceRemux: opts.forceRemux });
      await loadEngines(info);
      if (get().token === token) set({ info, loading: false });
    } catch (e) {
      if (get().token === token) set({ loading: false, error: errorMessage(e) });
    }
  },

  nextEpisode() {
    const m = get().media;
    if (!m?.episode || !m.queue.length) return false;
    const i = m.queue.findIndex((e) => e.id === m.episode!.id);
    const next = m.queue[i + 1];
    if (!next) return false;
    get().playMedia(m.item, { episode: next, queue: m.queue, age: m.age });
    return true;
  },

  zap(delta) {
    const { zapList, channel } = get();
    if (!zapList.length || !channel) return;
    const i = zapList.findIndex((c) => c.id === channel.id);
    const next = zapList[(i + delta + zapList.length) % zapList.length];
    if (next) get().play(next);
  },

  async stop() {
    set({ channel: null, media: null, info: null, catchup: null, loading: false, error: null, mode: "hidden", token: get().token + 1 });
    (await getBackend()).stop();
  },

  setMode: (mode) => set({ mode }),

  retry(forceRemux = false) {
    const { channel, catchup, media } = get();
    if (media) get().playMedia(media.item, { episode: media.episode, queue: media.queue, resumeAt: media.resumeAt, age: media.age, forceRemux });
    else if (channel && catchup) get().playCatchup(channel, catchup, forceRemux);
    else if (channel) get().play(channel, { forceRemux });
  },
}));
