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

/** Accès à une chaîne pour un profil. */
export function channelAccess(p: Profile, ch: Channel, adultUnlocked: boolean): Access {
  if (p.kind === "child") {
    const r = p.child!;
    if (ch.adult) return { ok: false, reason: "blocked", message: "Chaîne réservée aux adultes." };
    if (r.blacklist.includes(ch.id)) return { ok: false, reason: "blocked", message: "Chaîne bloquée par un parent." };
    if (r.whitelist.includes(ch.id)) return { ok: true };
    if (r.whitelistOnly) return { ok: false, reason: "blocked", message: "Seules les chaînes autorisées par un parent sont visibles." };
    if (ch.group && r.blockedGroups.some((g) => g.toLowerCase() === ch.group!.toLowerCase()))
      return { ok: false, reason: "blocked", message: "Catégorie bloquée par un parent." };
    return { ok: true };
  }
  if (ch.adult && p.kind === "standard" && !adultUnlocked) return { ok: false, reason: "adult-pin" };
  return { ok: true };
}

/** Un profil enfant ne voit pas du tout les chaînes bloquées. */
export function channelVisible(p: Profile, ch: Channel): boolean {
  return p.kind !== "child" || channelAccess(p, ch, false).ok;
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
