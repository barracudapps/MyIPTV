import type { VodKind } from "../types";

export interface SectionMeta {
  kind: VodKind;
  label: string;
  icon: string;
  /** Affiche portrait (2:3) ou carrée (pochette, logo de radio). */
  shape: "portrait" | "square" | "landscape";
  /** Nom d'un épisode / d'une piste. */
  unit: string;
  empty: string;
}

export const SECTIONS: SectionMeta[] = [
  { kind: "movie", label: "Films", icon: "film", shape: "portrait", unit: "film", empty: "Aucun film dans vos sources." },
  { kind: "series", label: "Séries", icon: "series", shape: "portrait", unit: "épisode", empty: "Aucune série dans vos sources : ajoutez un compte Xtream ou une playlist qui en contient." },
  { kind: "show", label: "Émissions", icon: "tv", shape: "landscape", unit: "émission", empty: "Aucune émission disponible." },
  { kind: "music", label: "Musique", icon: "music", shape: "square", unit: "piste", empty: "Aucune musique disponible." },
  { kind: "radio", label: "Radio", icon: "radio", shape: "square", unit: "station", empty: "Aucune radio disponible." },
  { kind: "podcast", label: "Podcasts", icon: "mic", shape: "square", unit: "épisode", empty: "Aucun podcast disponible." },
  { kind: "audiobook", label: "Livres audio", icon: "book", shape: "square", unit: "chapitre", empty: "Aucun livre audio disponible." },
];

export const sectionOf = (k?: VodKind) => SECTIONS.find((s) => s.kind === k) ?? SECTIONS[0];
