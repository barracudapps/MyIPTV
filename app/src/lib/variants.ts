import type { Channel } from "../types";

/** Qualité annoncée dans le nom (« (1080p) », « FHD », « 4K »…), en lignes. */
export function qualityOf(name: string): number | null {
  const n = name.toLowerCase();
  const p = n.match(/\b(2160|1440|1080|720|576|540|480|360|240)[pi]\b/);
  if (p) return Number(p[1]);
  if (/\b(4k|uhd)\b/.test(n)) return 2160;
  if (/\bfhd\b/.test(n)) return 1080;
  if (/\bhd\b/.test(n)) return 720;
  if (/\bsd\b/.test(n)) return 480;
  return null;
}

/**
 * Nom débarrassé de ce qui varie d'une copie à l'autre d'une même chaîne :
 * qualité, mentions entre crochets ou parenthèses, symboles, accents, casse.
 */
export function baseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[ⓖⓨⓢⓒⓘ✓★●◉•|]/g, " ")
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|h\.?26[45]|\d{3,4}[pi]|backup|alt|multi|live|tv\s*hd)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Toutes les copies d'une chaîne regroupée, la principale en tête. */
export function streamsOf(ch: Channel): Channel[] {
  return [ch, ...(ch.variants ?? [])];
}

/** Identifiants de toutes les copies (favoris, listes parentales…). */
export function channelIds(ch: Channel): string[] {
  return ch.variants?.length ? [ch.id, ...ch.variants.map((v) => v.id)] : [ch.id];
}

/** Copie la plus utile comme représentante : guide, replay, logo, puis meilleure qualité. */
function representativeScore(c: Channel): number {
  return (c.tvgId ? 8 : 0) + (c.catchup ? 4 : 0) + (c.logo ? 2 : 0) + (qualityOf(c.name) ?? 600) / 10_000;
}

/**
 * Regroupe les copies d'une même chaîne (plusieurs sources ou qualités) en une seule
 * entrée. Clé : nom nettoyé + adulte ; deux pays connus différents restent séparés
 * (« La Une » belge et argentine), une copie sans pays rejoint le groupe principal.
 */
export function groupChannels(list: Channel[]): Channel[] {
  const byName = new Map<string, Channel[]>();
  for (const c of list) {
    const name = baseName(c.name);
    const key = name ? `${c.adult ? "a" : ""}|${name}` : `id|${c.id}`;
    const bucket = byName.get(key);
    if (bucket) bucket.push(c);
    else byName.set(key, [c]);
  }
  const out: Channel[] = [];
  const firstIndex = new Map<Channel, number>();
  list.forEach((c, i) => firstIndex.set(c, i));
  for (const bucket of byName.values()) {
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    const byCountry = new Map<string, Channel[]>();
    const unknown: Channel[] = [];
    for (const c of bucket) {
      const country = c.countries?.[0] ?? c.country;
      if (!country) unknown.push(c);
      else (byCountry.get(country) ?? byCountry.set(country, []).get(country)!).push(c);
    }
    const parts = [...byCountry.values()].sort((a, b) => b.length - a.length);
    if (parts.length) parts[0].push(...unknown);
    else parts.push(unknown);
    for (const part of parts) {
      const ranked = [...part].sort((a, b) => representativeScore(b) - representativeScore(a));
      const [head, ...rest] = ranked;
      // Position de la première copie rencontrée : l'ordre des sources est conservé.
      const pos = Math.min(...part.map((c) => firstIndex.get(c)!));
      out.push(rest.length ? { ...head, variants: rest, groupOrder: pos } : { ...head, groupOrder: pos });
    }
  }
  return out.sort((a, b) => (a.groupOrder ?? firstIndex.get(a)!) - (b.groupOrder ?? firstIndex.get(b)!));
}

/** Nom affiché : sans la mention de qualité quand plusieurs copies sont regroupées. */
export function displayName(ch: Channel): string {
  if (!ch.variants?.length) return ch.name;
  const clean = ch.name.replace(/\s*[([](?:\d{3,4}[pi]|4k|uhd|fhd|hd|sd)[)\]]\s*/gi, " ").replace(/\s+/g, " ").trim();
  return clean || ch.name;
}
