import { withContent } from "./playlists";
import type { Profile } from "./parental";
import type { Theme } from "./themes";
import type { Source } from "../types";
import { useSettings, type FunSettings, type MetaSettings, type ParentalSettings, type PlaybackSettings } from "../store/settings";

/** Configuration échangée entre deux appareils (chiffrée pendant le transfert). */
export interface SharePayload {
  app: "MyIPTV";
  version: 1;
  createdAt: number;
  sources?: Source[];
  meta?: MetaSettings;
  profiles?: Profile[];
  themes?: Theme[];
  settings?: {
    playback: PlaybackSettings;
    fun: FunSettings;
    hiddenSections: string[];
    parental: Omit<ParentalSettings, "adultEnabled">;
  };
}

export interface ShareChoice {
  sourceIds: string[];
  meta: boolean;
  profiles: boolean;
  themes: boolean;
  settings: boolean;
}

/** Sources ajoutées par l'utilisateur : les sources intégrées existent déjà partout. */
export function shareableSources(sources: Source[]): Source[] {
  return sources.filter((s) => !s.builtin);
}

export async function buildPayload(choice: ShareChoice): Promise<SharePayload> {
  const s = useSettings.getState();
  const ids = new Set(choice.sourceIds);
  const { adultEnabled: _adult, ...parental } = s.parental;
  const hasKeys = !!(s.meta.tmdb || s.meta.omdb);
  return {
    app: "MyIPTV",
    version: 1,
    createdAt: Date.now(),
    sources: ids.size ? await Promise.all(s.sources.filter((x) => ids.has(x.id)).map((x) => withContent(x).then(({ ...y }) => (y.kind === "m3uText" ? { ...y, contentStored: false } : y)))) : undefined,
    meta: choice.meta && hasKeys ? s.meta : undefined,
    // L'historique de visionnage reste sur l'appareil d'origine.
    profiles: choice.profiles ? s.profiles.map((p) => ({ ...p, history: [] })) : undefined,
    themes: choice.themes && s.customThemes.length ? s.customThemes : undefined,
    settings: choice.settings ? { playback: s.playback, fun: s.fun, hiddenSections: s.hiddenSections, parental } : undefined,
  };
}

export function parsePayload(text: string): SharePayload {
  const p = JSON.parse(text) as SharePayload;
  if (p?.app !== "MyIPTV" || p.version !== 1) throw new Error("Ce partage ne vient pas d'une version compatible de MyIPTV.");
  return p;
}

export interface ApplyResult {
  sources: number;
  profiles: number;
  themes: number;
  settings: boolean;
  meta: boolean;
}

/** Fusionne la configuration reçue : rien n'est supprimé sur cet appareil. */
export function applyPayload(p: SharePayload, choice: Omit<ShareChoice, "sourceIds"> & { sources: boolean }): ApplyResult {
  const s = useSettings.getState();
  const result: ApplyResult = { sources: 0, profiles: 0, themes: 0, settings: false, meta: false };
  const patch: Partial<ReturnType<typeof useSettings.getState>> = {};

  if (choice.sources && p.sources?.length) {
    // addSource écarte les doublons et range le contenu des fichiers hors du stockage local.
    for (const x of p.sources) if (s.addSource({ ...x, addedAt: Date.now() })) result.sources++;
  }
  if (choice.meta && p.meta) {
    patch.meta = { ...s.meta, tmdb: p.meta.tmdb || s.meta.tmdb, omdb: p.meta.omdb || s.meta.omdb };
    result.meta = true;
  }
  if (choice.profiles && p.profiles?.length) {
    const profiles = [...s.profiles];
    for (const incoming of p.profiles) {
      const i = profiles.findIndex((x) => x.id === incoming.id || (x.name === incoming.name && x.kind === incoming.kind));
      if (i >= 0) profiles[i] = { ...incoming, id: profiles[i].id, history: profiles[i].history };
      else profiles.push(incoming);
      result.profiles++;
    }
    patch.profiles = profiles;
  }
  if (choice.themes && p.themes?.length) {
    const ids = new Set(p.themes.map((t) => t.id));
    patch.customThemes = [...s.customThemes.filter((t) => !ids.has(t.id)), ...p.themes];
    result.themes = p.themes.length;
  }
  if (choice.settings && p.settings) {
    patch.playback = { ...s.playback, ...p.settings.playback };
    patch.fun = { ...s.fun, ...p.settings.fun };
    patch.hiddenSections = p.settings.hiddenSections;
    // Le contenu adulte n'est jamais activé à distance.
    patch.parental = { ...s.parental, ...p.settings.parental, adultEnabled: s.parental.adultEnabled };
    result.settings = true;
  }
  useSettings.setState(patch);
  return result;
}
