import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, EpgStats, Programme } from "../types";
import { errorMessage, nowSec } from "../lib/util";
import { useSettings } from "./settings";

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

  async loadAll(force = false) {
    const backend = await getBackend();
    const sources = useSettings.getState().sources.filter((s) => s.enabled);
    set({ loading: true });
    const errors: Record<string, string> = {};
    const all: Channel[] = [];
    const epgUrls: string[] = [];
    // Chargement en parallèle ; une source en échec n'empêche pas les autres.
    await Promise.all(
      sources.map(async (s) => {
        try {
          const r = await backend.loadSource(s, force);
          all.push(...r.channels);
          epgUrls.push(...r.epgUrls);
        } catch (e) {
          errors[s.id] = errorMessage(e);
        }
      }),
    );
    const order = new Map(sources.map((s, i) => [s.id, i]));
    all.sort((a, b) => (order.get(a.sourceId)! - order.get(b.sourceId)!) || 0);
    set({ channels: all, byId: new Map(all.map((c) => [c.id, c])), errors, loading: false, epgUrls: [...new Set(epgUrls)] });
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
