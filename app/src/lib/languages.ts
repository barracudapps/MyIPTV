import type { Channel, Source } from "../types";
import { CATALOG_ALL } from "./catalog";

/** Langues proposées (ISO 639-1), avec leur nom en français et un drapeau indicatif. */
export const LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: "fr", name: "Français", flag: "🇫🇷" },
  { code: "en", name: "Anglais", flag: "🇬🇧" },
  { code: "es", name: "Espagnol", flag: "🇪🇸" },
  { code: "de", name: "Allemand", flag: "🇩🇪" },
  { code: "it", name: "Italien", flag: "🇮🇹" },
  { code: "pt", name: "Portugais", flag: "🇵🇹" },
  { code: "nl", name: "Néerlandais", flag: "🇳🇱" },
  { code: "ar", name: "Arabe", flag: "🇸🇦" },
  { code: "tr", name: "Turc", flag: "🇹🇷" },
  { code: "ru", name: "Russe", flag: "🇷🇺" },
  { code: "pl", name: "Polonais", flag: "🇵🇱" },
  { code: "ro", name: "Roumain", flag: "🇷🇴" },
  { code: "el", name: "Grec", flag: "🇬🇷" },
  { code: "sv", name: "Suédois", flag: "🇸🇪" },
  { code: "da", name: "Danois", flag: "🇩🇰" },
  { code: "no", name: "Norvégien", flag: "🇳🇴" },
  { code: "fi", name: "Finnois", flag: "🇫🇮" },
  { code: "hu", name: "Hongrois", flag: "🇭🇺" },
  { code: "cs", name: "Tchèque", flag: "🇨🇿" },
  { code: "uk", name: "Ukrainien", flag: "🇺🇦" },
  { code: "he", name: "Hébreu", flag: "🇮🇱" },
  { code: "fa", name: "Persan", flag: "🇮🇷" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ur", name: "Ourdou", flag: "🇵🇰" },
  { code: "zh", name: "Chinois", flag: "🇨🇳" },
  { code: "ja", name: "Japonais", flag: "🇯🇵" },
  { code: "ko", name: "Coréen", flag: "🇰🇷" },
  { code: "vi", name: "Vietnamien", flag: "🇻🇳" },
  { code: "th", name: "Thaï", flag: "🇹🇭" },
  { code: "id", name: "Indonésien", flag: "🇮🇩" },
  { code: "sq", name: "Albanais", flag: "🇦🇱" },
  { code: "sr", name: "Serbe", flag: "🇷🇸" },
  { code: "hr", name: "Croate", flag: "🇭🇷" },
  { code: "bg", name: "Bulgare", flag: "🇧🇬" },
  { code: "ku", name: "Kurde", flag: "🏳️" },
];

export const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
export const langFlag = (code: string) => LANGUAGES.find((l) => l.code === code)?.flag ?? "🏳️";

/** Pays principaux d'une langue (pour les radios, podcasts et guides). */
const LANG_COUNTRIES: Record<string, string[]> = {
  fr: ["FR", "BE", "CH", "CA"],
  en: ["US", "GB", "IE", "AU"],
  es: ["ES", "MX", "AR", "CO"],
  de: ["DE", "AT", "CH"],
  it: ["IT"],
  pt: ["PT", "BR"],
  nl: ["NL", "BE"],
  ar: ["MA", "EG", "SA", "DZ"],
  tr: ["TR"],
  ru: ["RU"],
  pl: ["PL"],
  ro: ["RO"],
  el: ["GR"],
  sv: ["SE"],
  da: ["DK"],
  no: ["NO"],
  fi: ["FI"],
  hu: ["HU"],
  cs: ["CZ"],
  uk: ["UA"],
  he: ["IL"],
  hi: ["IN"],
  zh: ["CN", "TW", "HK"],
  ja: ["JP"],
  ko: ["KR"],
  vi: ["VN"],
  th: ["TH"],
  id: ["ID"],
};

export function countriesFor(langs: string[]): string[] {
  return [...new Set(langs.flatMap((l) => LANG_COUNTRIES[l] ?? []))];
}

/** Préfixe de liste (« FR », « UK », « ENG ») -> code de langue, s'il est reconnu. */
export function countryOrLang(prefix: string): string | undefined {
  const p = prefix.toUpperCase();
  const country = Object.entries(LANG_COUNTRIES).find(([, cs]) => cs[0] === p || (p === "UK" && cs.includes("GB")));
  if (country) return country[0];
  const l = p.toLowerCase();
  if (LANGUAGES.some((x) => x.code === l)) return l;
  const three: Record<string, string> = { fra: "fr", eng: "en", spa: "es", ger: "de", deu: "de", ita: "it", por: "pt", ara: "ar", tur: "tr" };
  return three[l];
}

/** Langue de l'appareil, à défaut le français. */
export function deviceLanguage(): string {
  const l = (navigator.language || "fr").slice(0, 2).toLowerCase();
  return LANGUAGES.some((x) => x.code === l) ? l : "fr";
}

/** Rang d'un contenu selon les langues favorites (même règle que le cœur Rust). */
export function langRank(langs: string[] | undefined, prefs: string[]): number {
  const i = prefs.findIndex((p) => langs?.includes(p));
  return i < 0 ? prefs.length : i;
}

export function sortByLanguage<T extends Channel>(list: T[], prefs: string[]): T[] {
  if (!prefs.length) return list;
  return list
    .map((c, i) => ({ c, i, r: langRank(c.languages, prefs) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Guides annoncés par les listes : ceux d'epgshare01 sont découpés par pays ;
 * on ne garde que les pays des langues favorites pour éviter des centaines de Mo.
 */
export function filterEpgUrls(urls: string[], langs: string[]): string[] {
  const countries = new Set(countriesFor(langs).map((c) => (c === "GB" ? "UK" : c)));
  return urls.filter((u) => {
    if (/ALL_SOURCES|DUMMY_CHANNELS/i.test(u)) return false;
    const m = u.match(/epg_ripper_([A-Z]{2})\d*\.xml/);
    return !m || countries.has(m[1]);
  });
}

/** Sources légales et gratuites intégrées par défaut. */
export function builtinSources(langs: string[]): Source[] {
  const countries = countriesFor(langs);
  const base = { epgUrls: [], enabled: true, addedAt: Date.now(), builtin: true };
  return [
    { ...base, id: "builtin:iptv-org", name: "Chaînes gratuites du monde (iptv-org)", kind: "m3uUrl", url: CATALOG_ALL.url },
    { ...base, id: "builtin:free-tv", name: "Chaînes en clair (Free-TV)", kind: "m3uUrl", url: "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8" },
    { ...base, id: "builtin:ia-films", name: "Films du domaine public (Internet Archive)", kind: "archive", collection: "feature_films", mediatype: "movies", content: "movie", rows: 3000 },
    { ...base, id: "builtin:ia-tv", name: "Télévision classique (Internet Archive)", kind: "archive", collection: "classic_tv", mediatype: "movies", content: "show", rows: 2000 },
    { ...base, id: "builtin:ia-music", name: "Musique libre (Internet Archive, Netlabels)", kind: "archive", collection: "netlabels", mediatype: "audio", content: "music", rows: 2000 },
    { ...base, id: "builtin:radio", name: "Radios du monde (Radio Browser)", kind: "radioBrowser", countries },
    { ...base, id: "builtin:podcasts", name: "Podcasts populaires (Apple Podcasts)", kind: "podcasts", countries: countries.slice(0, 4).map((c) => c.toLowerCase()) },
    { ...base, id: "builtin:librivox", name: "Livres audio du domaine public (LibriVox)", kind: "librivox", languages: langs.slice(0, 4) },
  ] as Source[];
}
