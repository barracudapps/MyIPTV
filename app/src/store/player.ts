import { qualityOf, streamsOf } from "../lib/variants";
import type { StreamProbe } from "../platform";
import { loadEngines } from "../lib/engines";
import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, Episode, PlayInfo, Programme, VodItem } from "../types";
import { adultAccess, channelAccess, maxAge, type Access, type Profile } from "../lib/parental";
import { errorMessage } from "../lib/util";
import { metaKeys, useSettings } from "./settings";
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

/** Copie d'une chaîne regroupée, avec le résultat de son test de connexion. */
export interface StreamChoice {
  channel: Channel;
  quality: number | null;
  probe?: StreamProbe;
  /** Échec constaté à la lecture. */
  failed?: string;
}

interface PlayerState {
  channel: Channel | null;
  /** Copies de la chaîne en cours, dans l'ordre retenu (la meilleure d'abord). */
  streams: StreamChoice[];
  streamIndex: number;
  /** Test des connexions en cours. */
  probing: boolean;
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
  playMedia(item: VodItem, opts?: { episode?: Episode; queue?: Episode[]; resumeAt?: number; age?: number; forceRemux?: boolean; copy?: number }): Promise<void>;
  nextEpisode(): boolean;
  zap(delta: number): void;
  stop(): Promise<void>;
  setMode(m: PlayerMode): void;
  /** Relance ; `forceRemux` : passer par ffmpeg après un échec du flux direct. */
  retry(forceRemux?: boolean): void;
  /** Lit une autre copie de la chaîne en cours. */
  useStream(index: number): void;
  /** Échec de lecture : passe à la copie suivante s'il en reste (vrai), sinon faux. */
  tryNextStream(reason: string): boolean;
}

/** Résultats récents par chaîne regroupée : zapper de nouveau ne relance pas les tests. */
const rankCache = new Map<string, { at: number; streams: StreamChoice[] }>();
const RANK_TTL_MS = 10 * 60_000;
/** Délai après lequel on choisit parmi les copies qui ont déjà répondu. */
const PROBE_SETTLE_MS = 1500;
const PROBE_TIMEOUT_MS = 3500;
const VIDEO_PAGE = /(youtube\.com|youtu\.be|dailymotion\.com|dai\.ly|twitch\.tv)\//i;

function rankScore(s: StreamChoice): number[] {
  const p = s.probe;
  const state = s.failed ? 3 : !p ? 1 : p.ok ? 0 : 2;
  // Une copie très lente passe après les autres, même de meilleure qualité.
  const slow = p?.ok && p.ms > 1200 ? 1 : 0;
  return [state, slow, -(s.quality ?? 600), p?.ms ?? 99_999];
}

function rank(list: StreamChoice[]): StreamChoice[] {
  return [...list].sort((a, b) => {
    const x = rankScore(a);
    const y = rankScore(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

/**
 * Teste toutes les copies en parallèle et les classe : celles qui répondent d'abord,
 * puis la qualité, puis la rapidité. On n'attend pas les retardataires au-delà de
 * PROBE_SETTLE_MS si une copie a déjà répondu.
 */
async function rankStreams(key: string, copies: Channel[]): Promise<StreamChoice[]> {
  const cached = rankCache.get(key);
  if (cached && Date.now() - cached.at < RANK_TTL_MS) return cached.streams;
  const backend = await getBackend();
  const list: StreamChoice[] = copies.map((c) => ({ channel: c, quality: qualityOf(c.name) }));
  let settled = 0;
  const t0 = performance.now();
  await new Promise<void>((done) => {
    let anyOk = false;
    let settleTimer: number | undefined;
    const hard = window.setTimeout(done, PROBE_TIMEOUT_MS);
    const finish = () => {
      window.clearTimeout(hard);
      window.clearTimeout(settleTimer);
      done();
    };
    settleTimer = window.setTimeout(() => anyOk && finish(), PROBE_SETTLE_MS);
    list.forEach((s) =>
      // Page vidéo (YouTube, Dailymotion…) : rien à tester, elle sera ouverte telle quelle.
      VIDEO_PAGE.test(s.channel.url)
        ? void (++settled === list.length && finish())
        : backend
        .probeStream({ url: s.channel.url, userAgent: s.channel.userAgent, referrer: s.channel.referrer }, PROBE_TIMEOUT_MS)
        .catch((e) => ({ ok: false, ms: PROBE_TIMEOUT_MS, error: errorMessage(e) }))
        .then((probe) => {
          s.probe = probe;
          settled++;
          if (probe.ok && !anyOk) {
            anyOk = true;
            // Délai de grâce déjà écoulé : on part avec la première qui répond.
            if (performance.now() - t0 > PROBE_SETTLE_MS) finish();
          }
          if (settled === list.length) finish();
        }),
    );
  });
  const ranked = rank(list);
  rankCache.set(key, { at: Date.now(), streams: ranked });
  return ranked;
}

/** Lance la copie `index` de la chaîne en cours (après le test des connexions). */
async function startStream(token: number, index: number, forceRemux?: boolean) {
  const { streams } = usePlayer.getState();
  const stream = streams[index]?.channel ?? usePlayer.getState().channel;
  if (!stream) return;
  usePlayer.setState({ streamIndex: index });
  const settings = useSettings.getState();
  try {
    const backend = await getBackend();
    const info = await backend.play({
      url: stream.url,
      userAgent: stream.userAgent,
      referrer: stream.referrer,
      timeshift: settings.playback.timeshift && backend.diskTimeshift && !forceRemux,
      windowMinutes: settings.playback.windowMinutes,
      forceRemux,
    });
    await loadEngines(info);
    if (usePlayer.getState().token !== token) return; // une autre chaîne a été lancée entre-temps
    usePlayer.setState({ info, loading: false });
    if (info.error) useUi.getState().toast(`Timeshift indisponible pour cette chaîne (${info.error}). Lecture directe.`, "info");
  } catch (e) {
    if (usePlayer.getState().token !== token) return;
    if (!usePlayer.getState().tryNextStream(errorMessage(e))) usePlayer.setState({ loading: false, error: errorMessage(e) });
  }
}

/** Sources déjà essayées pour l'épisode en cours (identifiants des copies de la série). */
const triedEpisodeCopies = new Map<string, Set<string>>();

/**
 * Échec d'un épisode : cherche le même épisode (saison et numéro) dans une autre copie de la
 * série et le lance, à la position atteinte. Faux s'il ne reste aucune copie à essayer.
 */
function tryEpisodeElsewhere(reason: string): boolean {
  const { media } = usePlayer.getState();
  const ep = media?.episode;
  const copies = media?.item.alternates ?? [];
  if (!media || !ep || !copies.length) return false;
  const key = `${media.item.id}|${ep.season}|${ep.episode}`;
  const tried = triedEpisodeCopies.get(key) ?? new Set<string>([ep.id]);
  triedEpisodeCopies.set(key, tried);
  const remaining = copies.filter((c) => !tried.has(c.id));
  if (!remaining.length) return false;
  const token = usePlayer.getState().token;
  const position = (document.querySelector(".player video") as HTMLVideoElement | null)?.currentTime ?? media.resumeAt;
  void (async () => {
    const backend = await getBackend();
    for (const copy of remaining) {
      tried.add(copy.id);
      try {
        const d = await backend.vodDetail(copy.id, metaKeys());
        const episodes = d.seasons.flatMap((s) => s.episodes);
        const same = episodes.find((e) => e.season === ep.season && e.episode === ep.episode);
        if (!same || usePlayer.getState().token !== token) continue;
        tried.add(same.id);
        useUi.getState().toast(`Épisode indisponible sur cette source : lecture depuis une autre source.`, "info");
        await usePlayer.getState().playMedia(media.item, { episode: same, queue: episodes, resumeAt: position > 5 ? position : media.resumeAt, age: media.age });
        return;
      } catch {
        // Copie injoignable : on passe à la suivante.
      }
    }
    if (usePlayer.getState().token === token) usePlayer.setState({ loading: false, error: reason });
  })();
  return true;
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
  streams: [],
  streamIndex: 0,
  probing: false,

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
    // Plusieurs copies : test rapide des connexions pour lire la plus pertinente.
    let streams: StreamChoice[] = [{ channel: ch, quality: qualityOf(ch.name) }];
    if (ch.variants?.length) {
      set({ probing: true, streams: streamsOf(ch).map((c) => ({ channel: c, quality: qualityOf(c.name) })) });
      streams = await rankStreams(ch.id, streamsOf(ch));
      if (get().token !== token) return;
    }
    set({ streams, probing: false });
    await startStream(token, 0, opts?.forceRemux);
  },

  useStream(index) {
    const m = get().media;
    if (m) {
      // Film : même contenu depuis une autre source, à la position atteinte.
      const pos = (document.querySelector(".player video") as HTMLVideoElement | null)?.currentTime ?? m.resumeAt;
      void get().playMedia(m.item, { resumeAt: pos > 5 ? pos : m.resumeAt, age: m.age, copy: index });
      return;
    }
    const token = get().token + 1;
    set({ token, info: null, loading: true, error: null });
    void startStream(token, index);
  },

  tryNextStream(reason) {
    const { streams, streamIndex, channel, catchup, media } = get();
    // Épisode d'une série présente sur plusieurs sources : le même épisode ailleurs.
    if (media?.episode && !catchup) return tryEpisodeElsewhere(reason);
    if (catchup || streams.length < 2 || (!channel && !media)) return false;
    const key = channel?.id ?? media!.item.id;
    const marked = streams.map((s, i) => (i === streamIndex ? { ...s, failed: reason } : s));
    const next = marked.findIndex((s, i) => i > streamIndex && !s.failed && s.probe?.ok !== false);
    const fallback = next >= 0 ? next : marked.findIndex((s, i) => i > streamIndex && !s.failed);
    set({ streams: marked });
    // Les résultats mis en cache tiennent compte de l'échec pour les prochains zappings.
    rankCache.set(key, { at: Date.now(), streams: rank(marked) });
    if (fallback < 0) return false;
    useUi.getState().toast(`Source ${streamIndex + 1} indisponible : essai de la source ${fallback + 1}/${streams.length}.`, "info");
    get().useStream(fallback);
    return true;
  },

  async playCatchup(ch, prog, forceRemux) {
    const profile = activeProfile();
    if (!profile || !(await resolve(channelAccess(profile, ch, adultCtx()), ch.name))) return;
    const token = get().token + 1;
    set({ channel: ch, media: null, catchup: prog, loading: true, error: null, info: null, token, streams: [], streamIndex: 0, mode: get().mode === "hidden" ? "docked" : get().mode });
    // Chaîne regroupée : le replay passe par la copie qui le propose.
    const src = streamsOf(ch).find((c) => c.catchup) ?? ch;
    try {
      const backend = await getBackend();
      const url = await backend.catchupUrl(src, prog.start, prog.stop);
      if (!url) throw new Error("Ce programme n'est pas disponible en replay.");
      const info = await backend.play({ url, userAgent: src.userAgent, referrer: src.referrer, timeshift: false, windowMinutes: 0, media: true, forceRemux });
      await loadEngines(info);
      if (get().token === token) set({ info, loading: false });
    } catch (e) {
      if (get().token === token) set({ loading: false, error: errorMessage(e) });
    }
  },

  async playMedia(item, opts = {}) {
    const profile = activeProfile();
    if (!profile || !(await resolve(mediaAccess(profile, item, opts.age), item.title))) return;
    const token = get().token + 1;
    // Plusieurs sources pour ce film : test rapide, puis la plus pertinente (ou celle choisie).
    const copies = opts.episode ? [] : [item, ...(item.alternates ?? [])].filter((c) => c.url);
    let streams: StreamChoice[] = [];
    let index = 0;
    if (copies.length > 1) {
      const asStreams = copies.map((c) => ({ id: c.id, sourceId: c.sourceId, name: c.rawName || c.title, url: c.url!, userAgent: c.userAgent, referrer: c.referrer }) as Channel);
      if (opts.copy != null && get().media?.item.id === item.id && get().streams.length) {
        streams = get().streams;
        index = opts.copy;
      } else {
        set({
          token,
          probing: true,
          loading: true,
          error: null,
          info: null,
          channel: null,
          catchup: null,
          media: { item, queue: [], resumeAt: opts.resumeAt ?? 0, age: opts.age },
          mode: get().mode === "hidden" || get().media?.item.id !== item.id ? "docked" : get().mode,
          streams: asStreams.map((c) => ({ channel: c, quality: qualityOf(c.name) })),
          streamIndex: 0,
        });
        streams = await rankStreams(item.id, asStreams);
        if (get().token !== token) return;
      }
    }
    const url = opts.episode?.url ?? streams[index]?.channel.url ?? item.url;
    if (!url) {
      useUi.getState().toast("Aucun flux lisible pour ce contenu.", "error");
      return;
    }
    const copy = streams[index]?.channel;
    set({
      channel: null,
      catchup: null,
      streams,
      streamIndex: index,
      probing: false,
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
      const info = await (await getBackend()).play({ url, userAgent: copy?.userAgent ?? item.userAgent, referrer: copy?.referrer ?? item.referrer, timeshift: false, windowMinutes: 0, media: !item.live, forceRemux: opts.forceRemux });
      await loadEngines(info);
      if (get().token === token) set({ info, loading: false });
    } catch (e) {
      if (get().token === token && !get().tryNextStream(errorMessage(e))) set({ loading: false, error: errorMessage(e) });
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
    else if (channel) {
      // « Réessayer » : les connexions sont testées de nouveau.
      rankCache.delete(channel.id);
      get().play(channel, { forceRemux });
    }
  },
}));
