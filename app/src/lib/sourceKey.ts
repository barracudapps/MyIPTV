import type { Source } from "../types";

/** Empreinte rapide (FNV-1a 32 bits) du contenu d'un fichier importé. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${text.length}`;
}

/** Adresse comparable : casse de l'hôte, port par défaut, barre finale et ordre des paramètres ignorés. */
export function normalizeUrl(raw: string): string {
  const text = raw.trim();
  try {
    const u = new URL(text);
    u.hash = "";
    u.searchParams.sort();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return text.replace(/\/+$/, "");
  }
}

/**
 * Identité d'une source, indépendante de son nom et de son identifiant local :
 * même liste, même compte ou même fichier = même source.
 */
export function sourceKey(s: Source): string | null {
  switch (s.kind) {
    case "m3uUrl":
      return `m3u:${normalizeUrl(s.url)}`;
    case "m3uText":
      return s.content ? `file:${contentHash(s.content)}` : s.contentHash ? `file:${s.contentHash}` : null;
    case "xtream":
      return `xtream:${normalizeUrl(s.server).toLowerCase()}|${s.username}`;
    case "jellyfin":
      return `jellyfin:${normalizeUrl(s.server).toLowerCase()}|${s.userId}`;
    default:
      return `${s.kind}:${s.id}`;
  }
}

/** Source déjà présente parmi `sources`, s'il y en a une. */
export function findDuplicate(s: Source, sources: Source[]): Source | undefined {
  const key = sourceKey(s);
  return key ? sources.find((x) => x.id !== s.id && sourceKey(x) === key) : undefined;
}

/** Nom libre : « Nom (2) », « Nom (3) »… si le nom est déjà pris par une autre source. */
export function uniqueName(name: string, sources: Source[]): string {
  const taken = new Set(sources.map((x) => x.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}
