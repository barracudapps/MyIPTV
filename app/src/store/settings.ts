import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BUILTIN_THEMES, type Theme } from "../lib/themes";
import { DEFAULT_CHILD_RULES, DEFAULT_PLAYER_PREFS, type HistoryEntry, type PlayerPrefs, type Profile, type ProfileKind } from "../lib/parental";
import { builtinSources, deviceLanguage } from "../lib/languages";
import type { Source } from "../types";
import { uid } from "../lib/util";

/** Empreinte du code parental par défaut « 0000 » (voir `hashPin`). */
export const DEFAULT_PIN_HASH = "7776507b75cd0a8780238f927f1c4a266e8a77815960f830be228835ffa250dd";

export interface ParentalSettings {
  pinHash?: string;
  /** Le code est encore « 0000 » : l'interface invite à le changer. */
  pinIsDefault: boolean;
  /** Les réglages (sources, profils, contrôle parental) exigent le code. */
  protectSettings: boolean;
  /** Quitter un profil enfant exige le code. */
  lockChildProfiles: boolean;
  /** Contenus pour adultes : masqués tant que l'administrateur ne les autorise pas. */
  adultEnabled: boolean;
}

export interface PlaybackSettings {
  timeshift: boolean;
  windowMinutes: number;
  resumeLastChannel: boolean;
  autoMiniPlayer: boolean;
  /** Épisode suivant enchaîné automatiquement. */
  autoNext: boolean;
  /** Sources intégrées : garder les flux servis depuis une simple adresse IP (souvent des relais non officiels). */
  includeUnverified?: boolean;
}

export interface MetaSettings {
  tmdb: string;
  omdb: string;
}

export type Chattiness = "quiet" | "normal" | "chatty";

export interface FunSettings {
  mascot: boolean;
  mascotName: string;
  mascotColor: string;
  chattiness: Chattiness;
  sounds: boolean;
  soundVolume: number;
  confetti: boolean;
  zapEffect: boolean;
  seasonal: boolean;
  achievements: boolean;
  surprise: boolean;
  easterEggs: boolean;
}

export const DEFAULT_FUN: FunSettings = {
  mascot: true,
  mascotName: "Zapi",
  mascotColor: "#6d5dfc",
  chattiness: "normal",
  sounds: false,
  soundVolume: 0.4,
  confetti: true,
  zapEffect: true,
  seasonal: true,
  achievements: true,
  surprise: true,
  easterEggs: true,
};

export interface ProfileStats {
  zaps: number;
  plays: number;
  favorites: number;
  searches: number;
  nightOwl: number;
  radios: string[];
}

interface SettingsState {
  profiles: Profile[];
  activeProfileId: string | null;
  customThemes: Theme[];
  sources: Source[];
  parental: ParentalSettings;
  playback: PlaybackSettings;
  meta: MetaSettings;
  fun: FunSettings;
  /** Sections masquées du menu. */
  hiddenSections: string[];
  /** Mode test : listes d'exemple pour essayer l'ajout de sources. */
  testMode: boolean;
  setTestMode(v: boolean): void;
  lastChannelId: Record<string, string>;
  stats: Record<string, ProfileStats>;
  achievements: Record<string, Record<string, number>>;

  addProfile(name: string, kind: ProfileKind, age?: number): Profile;
  updateProfile(id: string, patch: Partial<Profile>): void;
  removeProfile(id: string): void;
  setActiveProfile(id: string | null): void;
  toggleFavorite(channelId: string): void;
  pushRecent(channelId: string): void;
  setLanguages(langs: string[]): void;
  toggleVodFavorite(itemId: string): void;
  rate(itemId: string, stars: number): void;
  recordProgress(entry: Omit<HistoryEntry, "updatedAt">): void;
  removeHistory(itemId: string): void;
  clearHistory(): void;
  setPlayerPrefs(patch: Partial<PlayerPrefs>): void;

  saveTheme(t: Theme): void;
  removeTheme(id: string): void;

  addSource(s: Source): void;
  updateSource(id: string, patch: Partial<Source>): void;
  removeSource(id: string): void;

  setParental(patch: Partial<ParentalSettings>): void;
  setPlayback(patch: Partial<PlaybackSettings>): void;
  setMeta(patch: Partial<MetaSettings>): void;
  setFun(patch: Partial<FunSettings>): void;
  setHiddenSections(v: string[]): void;
  setLastChannel(profileId: string, channelId: string): void;
  bumpStat(key: keyof Omit<ProfileStats, "radios">, by?: number): void;
  addRadioCountry(country: string): void;
  unlockAchievement(id: string): boolean;
}

const AVATARS = ["🦊", "🐼", "🦁", "🐙", "🦄", "🐸", "🚀", "🎧", "🌵", "⚽"];
const COLORS = ["#6d5dfc", "#22c3ee", "#f97316", "#22c55e", "#e11d48", "#eab308"];
const EMPTY_STATS: ProfileStats = { zaps: 0, plays: 0, favorites: 0, searches: 0, nightOwl: 0, radios: [] };

function withDefaults(p: Partial<Profile> & Pick<Profile, "id" | "name" | "kind">): Profile {
  return {
    avatar: "🦊",
    color: COLORS[0],
    themeId: "nuit",
    favorites: [],
    recent: [],
    languages: [deviceLanguage()],
    vodFavorites: [],
    ratings: {},
    history: [],
    ...p,
    player: { ...DEFAULT_PLAYER_PREFS, ...p.player },
  };
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => {
      const updateActive = (fn: (p: Profile) => Profile) => {
        const id = get().activeProfileId;
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? fn(p) : p)) }));
      };
      return {
        profiles: [],
        activeProfileId: null,
        customThemes: [],
        sources: [],
        parental: { pinHash: DEFAULT_PIN_HASH, pinIsDefault: true, protectSettings: false, lockChildProfiles: true, adultEnabled: false },
        playback: { timeshift: true, windowMinutes: 120, resumeLastChannel: true, autoMiniPlayer: true, autoNext: true },
        meta: { tmdb: "", omdb: "" },
        fun: DEFAULT_FUN,
        hiddenSections: [],
        testMode: false,
        setTestMode: (testMode) => set({ testMode }),
        lastChannelId: {},
        stats: {},
        achievements: {},

        addProfile(name, kind, age) {
          const s = get();
          const n = s.profiles.length;
          const admin = s.profiles.find((p) => p.kind === "admin");
          const p = withDefaults({
            id: uid(),
            name,
            kind,
            avatar: AVATARS[n % AVATARS.length],
            color: COLORS[n % COLORS.length],
            themeId: kind === "child" ? "enfants" : "nuit",
            languages: admin?.languages ?? [deviceLanguage()],
            child: kind === "child" ? DEFAULT_CHILD_RULES(age ?? 8) : undefined,
          });
          // Première ouverture : les sources légales intégrées sont ajoutées d'office.
          const sources = s.sources.length ? s.sources : builtinSources(p.languages);
          set({ profiles: [...s.profiles, p], sources });
          return p;
        },
        updateProfile: (id, patch) => set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
        removeProfile: (id) =>
          set((s) => ({
            profiles: s.profiles.filter((p) => p.id !== id),
            activeProfileId: s.activeProfileId === id ? null : s.activeProfileId,
          })),
        setActiveProfile: (id) => set({ activeProfileId: id }),
        toggleFavorite: (channelId) =>
          updateActive((p) => ({ ...p, favorites: p.favorites.includes(channelId) ? p.favorites.filter((f) => f !== channelId) : [...p.favorites, channelId] })),
        pushRecent: (channelId) => updateActive((p) => ({ ...p, recent: [channelId, ...p.recent.filter((r) => r !== channelId)].slice(0, 20) })),
        setLanguages: (languages) => updateActive((p) => ({ ...p, languages })),
        toggleVodFavorite: (itemId) =>
          updateActive((p) => ({ ...p, vodFavorites: p.vodFavorites.includes(itemId) ? p.vodFavorites.filter((f) => f !== itemId) : [itemId, ...p.vodFavorites] })),
        rate: (itemId, stars) =>
          updateActive((p) => {
            const ratings = { ...p.ratings };
            if (stars <= 0 || ratings[itemId] === stars) delete ratings[itemId];
            else ratings[itemId] = stars;
            return { ...p, ratings };
          }),
        recordProgress: (entry) =>
          updateActive((p) => ({
            ...p,
            history: [{ ...entry, updatedAt: Date.now() }, ...p.history.filter((h) => h.itemId !== entry.itemId)].slice(0, 300),
          })),
        removeHistory: (itemId) => updateActive((p) => ({ ...p, history: p.history.filter((h) => h.itemId !== itemId) })),
        clearHistory: () => updateActive((p) => ({ ...p, history: [] })),
        setPlayerPrefs: (patch) => updateActive((p) => ({ ...p, player: { ...p.player, ...patch } })),

        saveTheme: (t) => set((s) => ({ customThemes: [...s.customThemes.filter((x) => x.id !== t.id), { ...t, builtin: false }] })),
        removeTheme: (id) =>
          set((s) => ({
            customThemes: s.customThemes.filter((t) => t.id !== id),
            profiles: s.profiles.map((p) => (p.themeId === id ? { ...p, themeId: "nuit" } : p)),
          })),

        addSource: (src) => set((s) => ({ sources: [...s.sources, src] })),
        updateSource: (id, patch) => set((s) => ({ sources: s.sources.map((x) => (x.id === id ? ({ ...x, ...patch } as Source) : x)) })),
        removeSource: (id) => set((s) => ({ sources: s.sources.filter((x) => x.id !== id) })),

        setParental: (patch) => set((s) => ({ parental: { ...s.parental, ...patch } })),
        setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),
        setMeta: (patch) => set((s) => ({ meta: { ...s.meta, ...patch } })),
        setFun: (patch) => set((s) => ({ fun: { ...s.fun, ...patch } })),
        setHiddenSections: (hiddenSections) => set({ hiddenSections }),
        setLastChannel: (profileId, channelId) => set((s) => ({ lastChannelId: { ...s.lastChannelId, [profileId]: channelId } })),
        bumpStat(key, by = 1) {
          const id = get().activeProfileId;
          if (!id) return;
          set((s) => {
            const cur = { ...EMPTY_STATS, ...s.stats[id] };
            return { stats: { ...s.stats, [id]: { ...cur, [key]: cur[key] + by } } };
          });
        },
        addRadioCountry(country) {
          const id = get().activeProfileId;
          if (!id) return;
          set((s) => {
            const cur = { ...EMPTY_STATS, ...s.stats[id] };
            return cur.radios.includes(country) ? {} : { stats: { ...s.stats, [id]: { ...cur, radios: [...cur.radios, country] } } };
          });
        },
        unlockAchievement(achId) {
          const id = get().activeProfileId;
          if (!id || !get().fun.achievements || get().achievements[id]?.[achId]) return false;
          set((s) => ({ achievements: { ...s.achievements, [id]: { ...s.achievements[id], [achId]: Date.now() } } }));
          return true;
        },
      };
    },
    {
      name: "myiptv-settings",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate(persisted, version) {
        const s = persisted as Record<string, any>;
        if (version < 2) {
          // Profils : nouvelles préférences (langues, historique, lecteur…).
          s.profiles = (s.profiles ?? []).map((p: Profile) => withDefaults(p));
          // Contrôle parental : contenu adulte désactivé par défaut, code « 0000 » si aucun code n'existait.
          const { hideAdultForStandard: _old, ...parental } = s.parental ?? {};
          s.parental = { ...parental, adultEnabled: false, pinIsDefault: !parental.pinHash, pinHash: parental.pinHash ?? DEFAULT_PIN_HASH };
          s.playback = { autoNext: true, ...s.playback };
          s.meta = { tmdb: "", omdb: "", ...s.meta };
          s.fun = { ...DEFAULT_FUN, ...s.fun };
          s.hiddenSections = s.hiddenSections ?? [];
          s.stats = s.stats ?? {};
          s.achievements = s.achievements ?? {};
          // Sources légales intégrées ajoutées aux installations existantes.
          const langs = s.profiles[0]?.languages ?? [deviceLanguage()];
          const existing = new Set((s.sources ?? []).map((x: Source) => x.id));
          const builtinUrls = new Set((s.sources ?? []).map((x: Source) => ("url" in x ? x.url : "")));
          const missing = builtinSources(langs).filter((b) => !existing.has(b.id) && !("url" in b && builtinUrls.has(b.url)));
          s.sources = [...missing, ...(s.sources ?? [])];
        }
        return s as unknown as SettingsState;
      },
    },
  ),
);

export function useActiveProfile(): Profile | undefined {
  return useSettings((s) => s.profiles.find((p) => p.id === s.activeProfileId));
}

export function allThemes(custom: Theme[]): Theme[] {
  return [...BUILTIN_THEMES, ...custom];
}

export function themeFor(profile: Profile | undefined, custom: Theme[]): Theme {
  return allThemes(custom).find((t) => t.id === profile?.themeId) ?? BUILTIN_THEMES[0];
}

/** Clés de métadonnées + langue des fiches, d'après la première langue favorite. */
export function metaKeys() {
  const s = useSettings.getState();
  const p = s.profiles.find((x) => x.id === s.activeProfileId);
  const lang = p?.languages[0] ?? "fr";
  return { tmdb: s.meta.tmdb || undefined, omdb: s.meta.omdb || undefined, language: `${lang}-${lang === "en" ? "US" : lang.toUpperCase()}` };
}
