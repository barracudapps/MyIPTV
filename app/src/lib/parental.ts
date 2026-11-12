import type { Channel, Programme } from "../types";

export type ProfileKind = "admin" | "standard" | "child";

/** Règles appliquées à un profil enfant, réglables par l'administrateur. */
export interface ChildRules {
  /** Âge de l'enfant. */
  age: number;
  /** Tolérance en années au-delà de l'âge (ex. 1 : un enfant de 11 ans voit le « -12 »). */
  tolerance: number;
  /** Programmes sans classification : autorisés ou non. */
  allowUnrated: boolean;
  /** Chaînes toujours autorisées (sauf contenu adulte), quel que soit le programme. */
  whitelist: string[];
  /** Chaînes toujours bloquées. */
  blacklist: string[];
  /** Groupes masqués (ex. « Info », « Sport »). */
  blockedGroups: string[];
  /** N'afficher que les chaînes de la liste blanche. */
  whitelistOnly: boolean;
}

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  color: string;
  kind: ProfileKind;
  themeId: string;
  favorites: string[];
  recent: string[];
  child?: ChildRules;
  /** Langues favorites, dans l'ordre de préférence (ISO 639-1). */
  languages: string[];
  /** Films, séries, podcasts… mis en favoris. */
  vodFavorites: string[];
  /** Note personnelle (1 à 5) par contenu. */
  ratings: Record<string, number>;
  /** Historique de visionnage / écoute, le plus récent d'abord. */
  history: HistoryEntry[];
  player: PlayerPrefs;
}

export interface HistoryEntry {
  /** Contenu (film, série, podcast…). */
  itemId: string;
  kind?: string;
  title: string;
  poster?: string;
  /** Épisode / piste en cours pour les contenus à épisodes. */
  episodeId?: string;
  episodeLabel?: string;
  position: number;
  duration: number;
  finished: boolean;
  updatedAt: number;
}

export type AspectMode = "contain" | "cover" | "fill" | "16:9" | "4:3" | "21:9";
export type AudioMode = "normal" | "night" | "voice" | "boost";

export interface PlayerPrefs {
  aspect: AspectMode;
  brightness: number;
  contrast: number;
  saturation: number;
  audioMode: AudioMode;
  /** Sélection automatique de l'audio et des sous-titres selon les langues favorites. */
  autoTracks: boolean;
  subtitlesByDefault: boolean;
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  aspect: "contain",
  brightness: 1,
  contrast: 1,
  saturation: 1,
  audioMode: "normal",
  autoTracks: true,
  subtitlesByDefault: false,
};

export interface AdultContext {
  /** Contenus adultes autorisés par l'administrateur. */
  enabled: boolean;
  /** Code parental saisi pendant la session. */
  unlocked: boolean;
}

export const DEFAULT_CHILD_RULES = (age: number): ChildRules => ({
  age,
  tolerance: 0,
  allowUnrated: true,
  whitelist: [],
  blacklist: [],
  blockedGroups: [],
  whitelistOnly: false,
});

export type Access =
  | { ok: true }
  | { ok: false; reason: "adult-pin" } // déblocable avec le code parental
  | { ok: false; reason: "blocked"; message: string };

/** Accès à un contenu adulte : désactivé par défaut, jamais pour un enfant, sinon derrière le code. */
export function adultAccess(p: Profile, adult: AdultContext): Access {
  if (p.kind === "child") return { ok: false, reason: "blocked", message: "Contenu réservé aux adultes." };
  if (!adult.enabled) return { ok: false, reason: "blocked", message: "Les contenus pour adultes sont désactivés (Réglages › Contrôle parental)." };
  return adult.unlocked ? { ok: true } : { ok: false, reason: "adult-pin" };
}

/** Accès à une chaîne pour un profil. */
export function channelAccess(p: Profile, ch: Channel, adult: AdultContext): Access {
  if (ch.adult) return adultAccess(p, adult);
  if (p.kind === "child") {
    const r = p.child!;
    if (r.blacklist.includes(ch.id)) return { ok: false, reason: "blocked", message: "Chaîne bloquée par un parent." };
    if (r.whitelist.includes(ch.id)) return { ok: true };
    if (r.whitelistOnly) return { ok: false, reason: "blocked", message: "Seules les chaînes autorisées par un parent sont visibles." };
    if (ch.group && r.blockedGroups.some((g) => g.toLowerCase() === ch.group!.toLowerCase()))
      return { ok: false, reason: "blocked", message: "Catégorie bloquée par un parent." };
    return { ok: true };
  }
  return { ok: true };
}

/** Chaînes bloquées et contenus adultes non autorisés : masqués (le verrou ne concerne que l'adulte autorisé). */
export function channelVisible(p: Profile, ch: Channel, adultEnabled: boolean): boolean {
  if (ch.adult) return adultEnabled && p.kind !== "child";
  return p.kind !== "child" || channelAccess(p, ch, { enabled: false, unlocked: false }).ok;
}

export function maxAge(p: Profile): number {
  return p.kind === "child" ? p.child!.age + p.child!.tolerance : 99;
}

/** Accès à un programme (classification d'âge) pour un profil. */
export function programmeAccess(p: Profile, ch: Channel, prog: Programme | undefined): Access {
  if (p.kind !== "child") return { ok: true };
  const r = p.child!;
  const limit = maxAge(p);
  if (prog?.age != null) {
    return prog.age <= limit
      ? { ok: true }
      : { ok: false, reason: "blocked", message: `Programme déconseillé aux moins de ${prog.age} ans.` };
  }
  if (r.allowUnrated || r.whitelist.includes(ch.id)) return { ok: true };
  return { ok: false, reason: "blocked", message: "Programme sans classification d'âge." };
}

/** Hachage du code parental (jamais stocké en clair). */
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`myiptv:${pin}`);
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Repli (anciens navigateurs TV sans WebCrypto) : FNV-1a.
  let h = 0x811c9dc5;
  for (const b of data) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `fnv:${h.toString(16)}`;
}
