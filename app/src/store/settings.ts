import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BUILTIN_THEMES, type Theme } from "../lib/themes";
import { DEFAULT_CHILD_RULES, type Profile, type ProfileKind } from "../lib/parental";
import type { Source } from "../types";
import { uid } from "../lib/util";

export interface ParentalSettings {
  pinHash?: string;
  /** Les réglages (sources, profils, contrôle parental) exigent le code. */
  protectSettings: boolean;
  /** Quitter un profil enfant exige le code. */
  lockChildProfiles: boolean;
  /** Masquer totalement les chaînes adultes aux profils standard (au lieu de les verrouiller). */
  hideAdultForStandard: boolean;
}

export interface PlaybackSettings {
  timeshift: boolean;
  windowMinutes: number;
  resumeLastChannel: boolean;
  autoMiniPlayer: boolean;
}

interface SettingsState {
  profiles: Profile[];
  activeProfileId: string | null;
  customThemes: Theme[];
  sources: Source[];
  parental: ParentalSettings;
  playback: PlaybackSettings;
  lastChannelId: Record<string, string>;
  onboarded: boolean;

  addProfile(name: string, kind: ProfileKind, age?: number): Profile;
  updateProfile(id: string, patch: Partial<Profile>): void;
  removeProfile(id: string): void;
  setActiveProfile(id: string | null): void;
  toggleFavorite(channelId: string): void;
  pushRecent(channelId: string): void;

  saveTheme(t: Theme): void;
  removeTheme(id: string): void;

  addSource(s: Source): void;
  updateSource(id: string, patch: Partial<Source>): void;
  removeSource(id: string): void;

  setParental(patch: Partial<ParentalSettings>): void;
  setPlayback(patch: Partial<PlaybackSettings>): void;
  setLastChannel(profileId: string, channelId: string): void;
  setOnboarded(): void;
}

const AVATARS = ["🦊", "🐼", "🦁", "🐙", "🦄", "🐸", "🚀", "🎧", "🌵", "⚽"];
const COLORS = ["#6d5dfc", "#22c3ee", "#f97316", "#22c55e", "#e11d48", "#eab308"];

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,
      customThemes: [],
      sources: [],
      parental: { protectSettings: false, lockChildProfiles: true, hideAdultForStandard: false },
      playback: { timeshift: true, windowMinutes: 120, resumeLastChannel: true, autoMiniPlayer: true },
      lastChannelId: {},
      onboarded: false,

      addProfile(name, kind, age) {
        const n = get().profiles.length;
        const p: Profile = {
          id: uid(),
          name,
          kind,
          avatar: AVATARS[n % AVATARS.length],
          color: COLORS[n % COLORS.length],
          themeId: kind === "child" ? "enfants" : "nuit",
          favorites: [],
          recent: [],
          child: kind === "child" ? DEFAULT_CHILD_RULES(age ?? 8) : undefined,
        };
        set((s) => ({ profiles: [...s.profiles, p] }));
        return p;
      },
      updateProfile: (id, patch) => set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeProfile: (id) =>
        set((s) => ({
          profiles: s.profiles.filter((p) => p.id !== id),
          activeProfileId: s.activeProfileId === id ? null : s.activeProfileId,
        })),
      setActiveProfile: (id) => set({ activeProfileId: id }),
      toggleFavorite(channelId) {
        const id = get().activeProfileId;
        set((s) => ({
          profiles: s.profiles.map((p) =>
            p.id !== id
              ? p
              : { ...p, favorites: p.favorites.includes(channelId) ? p.favorites.filter((f) => f !== channelId) : [...p.favorites, channelId] },
          ),
        }));
      },
      pushRecent(channelId) {
        const id = get().activeProfileId;
        set((s) => ({
          profiles: s.profiles.map((p) => (p.id !== id ? p : { ...p, recent: [channelId, ...p.recent.filter((r) => r !== channelId)].slice(0, 20) })),
        }));
      },

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
      setLastChannel: (profileId, channelId) => set((s) => ({ lastChannelId: { ...s.lastChannelId, [profileId]: channelId } })),
      setOnboarded: () => set({ onboarded: true }),
    }),
    {
      name: "myiptv-settings",
      version: 1,
      storage: createJSONStorage(() => localStorage),
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
