import { create } from "zustand";
import { hashPin } from "../lib/parental";
import { useSettings } from "./settings";

import type { VodKind } from "../types";

export type View = "live" | "guide" | "favorites" | "search" | "recordings" | "sources" | "settings" | `vod:${VodKind}`;

interface PinRequest {
  title: string;
  message?: string;
  resolve(ok: boolean): void;
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
}

interface UiState {
  view: View;
  pin: PinRequest | null;
  toasts: Toast[];
  /** Déverrouillages valables jusqu'au prochain changement de profil. */
  adultUnlocked: boolean;
  settingsUnlocked: boolean;
  searchQuery: string;
  /** Fiche ouverte et personne affichée (par-dessus la vue courante). */
  detailId: string | null;
  person: { name: string; tmdbId?: number } | null;
  /** Filtre transmis à une section (recherche « Voir tout », genre cliqué…). */
  vodFilter: { text?: string; field?: string; genre?: string; category?: string } | null;
  /** Filtre rapide de langue partagé par toutes les vues : « mine » (mes langues), « all » ou un code. */
  langFilter: string;
  setView(v: View): void;
  setSearch(q: string): void;
  toast(text: string, tone?: Toast["tone"]): void;
  resetUnlocks(): void;
}

export const useUi = create<UiState>()((set) => ({
  view: "live",
  pin: null,
  toasts: [],
  adultUnlocked: false,
  settingsUnlocked: false,
  searchQuery: "",
  detailId: null,
  person: null,
  vodFilter: null,
  // « Toutes » par défaut : rien n'est masqué, les langues favorites passent en tête par le tri.
  langFilter: "all",
  setView: (view) => set({ view }),
  setSearch: (searchQuery) => set({ searchQuery }),
  toast(text, tone = "info") {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  resetUnlocks: () => set({ adultUnlocked: false, settingsUnlocked: false }),
}));

/**
 * Demande le code parental. Renvoie `true` si aucun code n'est défini
 * (rien à protéger) ou si le code saisi est correct.
 */
export function askPin(title: string, message?: string): Promise<boolean> {
  if (!useSettings.getState().parental.pinHash) return Promise.resolve(true);
  return new Promise((resolve) => useUi.setState({ pin: { title, message, resolve } }));
}

export async function checkPin(pin: string): Promise<boolean> {
  return (await hashPin(pin)) === useSettings.getState().parental.pinHash;
}

/** Accès aux réglages protégés. */
export async function unlockSettings(): Promise<boolean> {
  const { parental, profiles, activeProfileId } = useSettings.getState();
  const profile = profiles.find((p) => p.id === activeProfileId);
  if (useUi.getState().settingsUnlocked) return true;
  // Un profil enfant n'accède jamais aux réglages sans code ; les autres seulement si l'option est active.
  const needed = profile?.kind === "child" || parental.protectSettings;
  if (!needed) return true;
  const ok = await askPin("Réglages protégés", "Saisissez le code parental pour continuer.");
  if (ok) useUi.setState({ settingsUnlocked: true });
  return ok;
}
