import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, EpgStats, Programme } from "../types";
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
    const backend = await getBackend();
    const all_sources = useSettings.getState().sources;
    const sources = all_sources.filter((s) => s.enabled);
    set({ loading: true });
    // Sources désactivées : retirées de la mémoire du backend (leur cache est conservé).
    await Promise.all(all_sources.filter((s) => !s.enabled).map((s) => backend.removeSource(s.id, false)));
    const errors: Record<string, string> = {};
    const all: Channel[] = [];
    const epgUrls: string[] = [];
    const vodCounts: Record<string, number> = {};
    // Chargement en parallèle ; une source en échec n'empêche pas les autres.
    await Promise.all(
      sources.map(async (s) => {
        try {
          const r = await backend.loadSource(s, force);
          // Listes intégrées : un flux servi depuis une adresse IP brute est le plus souvent un relais
          // non officiel d'une chaîne ; écarté sauf choix contraire de l'utilisateur.
          const keep = !s.builtin || useSettings.getState().playback.includeUnverified ? r.channels : r.channels.filter((c) => !/^https?:\/\/\d{1,3}(\.\d{1,3}){3}[:/]/.test(c.url));
          all.push(...keep);
          epgUrls.push(...r.epgUrls);
          for (const [k, n] of Object.entries(r.vodCounts ?? {})) vodCounts[k] = (vodCounts[k] ?? 0) + n;
        } catch (e) {
          errors[s.id] = errorMessage(e);
        }
      }),
    );
    const order = new Map(sources.map((s, i) => [s.id, i]));
    all.sort((a, b) => (order.get(a.sourceId)! - order.get(b.sourceId)!) || 0);
    // Guides limités aux pays des langues favorites de tous les profils.
    const langs = [...new Set(useSettings.getState().profiles.flatMap((p) => p.languages))];
    set((s) => ({
      channels: all,
      byId: new Map(all.map((c) => [c.id, c])),
      errors,
      loading: false,
      vodCounts,
      libraryVersion: s.libraryVersion + 1,
      epgUrls: filterEpgUrls([...new Set(epgUrls)], langs),
    }));
    await get().loadEpg(force);
  },

  async loadEpg(force = false) {
    const urls = get().epgUrls;
    if (!urls.length) {
      set({ epgStats: null });
      return;
    }
    set({ epgLoading: true });
    try {
      const backend = await getBackend();
      const stats = await backend.loadEpg(urls, force);
      set((s) => ({ epgStats: stats, programmes: {}, loadedRange: {}, epgVersion: s.epgVersion + 1 }));
    } catch (e) {
      set({ epgStats: { channels: 0, programmes: 0, errors: [errorMessage(e)] } });
    } finally {
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
    const res = await backend.programmes(missing, f, t);
    set((s) => {
      const programmes = { ...s.programmes, ...res };
      const loadedRange = { ...s.loadedRange };
      for (const c of missing) loadedRange[c.id] = [f, t];
      return { programmes, loadedRange };
    });
  },
}));
