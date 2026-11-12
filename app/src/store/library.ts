import { channelIds, groupChannels } from "../lib/variants";
import { startTask } from "./activity";
import { withContent } from "../lib/playlists";
import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, EpgStats, Programme, Source } from "../types";
import { errorMessage, nowSec } from "../lib/util";
import { useSettings } from "./settings";
import { filterEpgUrls } from "../lib/languages";

interface LibraryState {
  channels: Channel[];
  byId: Map<string, Channel>;
  loading: boolean;
  epgLoading: boolean;
  errors: Record<string, string>;
  epgStats: EpgStats | null;
  epgUrls: string[];
  /** Cache des programmes : chaîne -> liste, et fenêtre déjà chargée. */
  programmes: Record<string, Programme[]>;
  loadedRange: Record<string, [number, number]>;
  epgVersion: number;
  /** Nombre de contenus par section (films, séries…). */
  vodCounts: Record<string, number>;
  /** Incrémenté à chaque rechargement : invalide les vues de la bibliothèque. */
  libraryVersion: number;

  loadAll(force?: boolean): Promise<void>;
  loadEpg(force?: boolean): Promise<void>;
  ensureProgrammes(channels: Channel[], from: number, to: number): Promise<void>;
}

/** Chaînes dont les programmes restent en mémoire (le guide et les vignettes en redemandent au besoin). */
const MAX_GUIDE_CHANNELS = 1500;
/** Sources chargées en parallèle. */
const LOAD_CONCURRENCY = 6;
let loadGeneration = 0;

/** Résultat brut par source, gardé pour ne recharger que les sources nouvelles ou modifiées. */
interface LoadedSource {
  signature: string;
  channels: Channel[];
  epgUrls: string[];
  vodCounts: Record<string, number>;
  error?: string;
}
const loaded = new Map<string, LoadedSource>();
/** Guides du dernier chargement du guide : inutile de le relire s'ils n'ont pas changé. */
let lastEpgKey = "";

/** Ce qui change le contenu d'une source (pas son nom ni son état d'affichage). */
function sourceSignature(s: Source): string {
  const { name: _n, enabled: _e, addedAt: _a, risk: _r, ...rest } = s as Source & Record<string, unknown>;
  const r = rest as Record<string, unknown>;
  if (s.kind === "m3uText") {
    delete r.content;
    delete r.contentStored;
  }
  return JSON.stringify(r);
}

/** Assemble les chaînes de toutes les sources chargées, dans l'ordre des sources. */
function publish(set: (fn: (s: LibraryState) => Partial<LibraryState>) => void, sources: Source[]) {
  const includeUnverified = useSettings.getState().playback.includeUnverified;
  const all: Channel[] = [];
  const epgUrls: string[] = [];
  const vodCounts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const s of sources) {
    const r = loaded.get(s.id);
    if (!r) continue;
    if (r.error) errors[s.id] = r.error;
    // Listes intégrées : un flux servi depuis une adresse IP brute est le plus souvent un relais
    // non officiel d'une chaîne ; écarté sauf choix contraire de l'utilisateur.
    all.push(...(!s.builtin || includeUnverified ? r.channels : r.channels.filter((c) => !/^https?:\/\/\d{1,3}(\.\d{1,3}){3}[:/]/.test(c.url))));
    epgUrls.push(...r.epgUrls);
    for (const [k, n] of Object.entries(r.vodCounts)) vodCounts[k] = (vodCounts[k] ?? 0) + n;
  }
  // Guides limités aux pays des langues favorites de tous les profils.
  const langs = [...new Set(useSettings.getState().profiles.flatMap((p) => p.languages))];
  // Copies d'une même chaîne (sources, qualités) regroupées sous une seule entrée.
  const grouped = groupChannels(all);
  const byId = new Map<string, Channel>();
  for (const c of grouped) for (const id of channelIds(c)) byId.set(id, c);
  set((st) => ({
    channels: grouped,
    byId,
    errors,
    loading: false,
    vodCounts,
    libraryVersion: st.libraryVersion + 1,
    epgUrls: filterEpgUrls([...new Set(epgUrls)], langs),
  }));
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  channels: [],
  byId: new Map(),
  loading: false,
  epgLoading: false,
  errors: {},
  epgStats: null,
  epgUrls: [],
  programmes: {},
  loadedRange: {},
  epgVersion: 0,
  vodCounts: {},
  libraryVersion: 0,

  async loadAll(force = false) {
    // Un nouveau chargement remplace le précédent : celui-ci s'arrête. Les sources déjà
    // chargées restent acquises, le suivant ne refait que ce qui manque.
    const gen = ++loadGeneration;
    const current = () => gen === loadGeneration;
    const backend = await getBackend();
    const all_sources = useSettings.getState().sources;
    const sources = all_sources.filter((s) => s.enabled);
    const wanted = new Set(sources.map((s) => s.id));

    // Sources retirées ou désactivées : libérées du backend (le cache disque est conservé).
    for (const id of [...loaded.keys()]) if (!wanted.has(id)) loaded.delete(id);
    await Promise.all(all_sources.filter((s) => !s.enabled).map((s) => backend.removeSource(s.id, false).catch(() => undefined)));

    // Seules les sources nouvelles ou dont la configuration a changé sont (re)chargées.
    const pending = sources.filter((s) => force || loaded.get(s.id)?.signature !== sourceSignature(s));
    if (!pending.length && !force) {
      publish(set, sources);
      if (get().epgUrls.join() !== lastEpgKey) await get().loadEpg();
      return;
    }
    set({ loading: true });
    const task = startTask(pending.length === sources.length ? "Chargement des sources" : "Chargement des nouvelles sources", { done: 0, total: pending.length });
    // Quelques sources à la fois : des centaines en même temps saturent le réseau et l'app.
    // Une source en échec n'empêche pas les autres.
    const queue = [...pending];
    const worker = async () => {
      for (let s = queue.shift(); s && current(); s = queue.shift()) {
        try {
          task.update({ detail: s.name });
          const r = await backend.loadSource(await withContent(s), force);
          loaded.set(s.id, { signature: sourceSignature(s), channels: r.channels, epgUrls: r.epgUrls, vodCounts: r.vodCounts ?? {} });
        } catch (e) {
          loaded.set(s.id, { signature: sourceSignature(s), channels: [], epgUrls: [], vodCounts: {}, error: errorMessage(e) });
        } finally {
          task.step();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, queue.length) }, worker));
    task.end();
    if (!current()) return;
    publish(set, sources);
    // Le guide n'est relu que si ses adresses ont changé ou si de nouvelles chaînes peuvent s'y rattacher.
    const newChannels = pending.some((p) => loaded.get(p.id)?.channels.length);
    if (force || newChannels || get().epgUrls.join() !== lastEpgKey) await get().loadEpg(force);
  },

  async loadEpg(force = false) {
    const urls = get().epgUrls;
    if (!urls.length) {
      set({ epgStats: null });
      return;
    }
    lastEpgKey = urls.join();
    set({ epgLoading: true });
    const task = startTask("Guide des programmes", { detail: `${urls.length} guide${urls.length > 1 ? "s" : ""} à lire` });
    try {
      const backend = await getBackend();
      const stats = await backend.loadEpg(urls, force);
      set((s) => ({ epgStats: stats, programmes: {}, loadedRange: {}, epgVersion: s.epgVersion + 1 }));
    } catch (e) {
      set({ epgStats: { channels: 0, programmes: 0, errors: [errorMessage(e)] } });
    } finally {
      task.end();
      set({ epgLoading: false });
    }
  },

  async ensureProgrammes(channels, from, to) {
    const { loadedRange } = get();
    const missing = channels.filter((c) => {
      const r = loadedRange[c.id];
      return !r || r[0] > from || r[1] < to;
    });
    if (!missing.length) return;
    // Fenêtre élargie pour limiter les allers-retours.
    const f = Math.min(from, nowSec() - 6 * 3600);
    const t = Math.max(to, nowSec() + 24 * 3600);
    const backend = await getBackend();
    // Les copies regroupées n'intéressent pas le guide : inutile de les transmettre.
    const res = await backend.programmes(missing.map(({ variants: _v, ...c }) => c), f, t);
    set((s) => {
      const programmes: Record<string, Programme[]> = { ...s.programmes };
      const loadedRange = { ...s.loadedRange };
      // Les chaînes vues récemment passent en fin de liste ; les plus anciennes sont oubliées au-delà du plafond.
      for (const c of missing) {
        delete programmes[c.id];
        delete loadedRange[c.id];
        programmes[c.id] = res[c.id] ?? [];
        loadedRange[c.id] = [f, t];
      }
      const keys = Object.keys(programmes);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_GUIDE_CHANNELS))) {
        delete programmes[k];
        delete loadedRange[k];
      }
      return { programmes, loadedRange };
    });
  },
}));
