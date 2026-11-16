/**
 * Langue de l'interface. Les textes sont écrits en français dans le code et servent de
 * clés : `t("Ma liste")` renvoie la traduction de la langue choisie, ou le français
 * quand elle manque. Variables : `t("{n} chaînes", { n: 12 })`.
 */
import { EN } from "../i18n/en";

export type UiLanguage = "fr" | "en";

export const UI_LANGUAGES: { code: UiLanguage; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
];

const KEY = "myiptv-ui-language";

function detect(): UiLanguage {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    /* stockage indisponible */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "fr";
  return /^fr\b/i.test(nav) ? "fr" : "en";
}

let current: UiLanguage = detect();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function uiLanguage(): UiLanguage {
  return current;
}

/** Locale des dates et nombres (« fr-FR », « en-GB »). */
export function locale(): string {
  return current === "fr" ? "fr-FR" : "en-GB";
}

/** Change la langue ; l'application se recharge pour que tout l'écran suive. */
export function setUiLanguage(lang: UiLanguage) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* stockage indisponible */
  }
  current = lang;
  location.reload();
}

const DICTS: Record<UiLanguage, Record<string, string> | null> = { fr: null, en: EN };

export function t(fr: string, vars?: Record<string, string | number>): string {
  const text = DICTS[current]?.[fr] ?? fr;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Accord simple : `plural(n, "chaîne", "chaînes")` traduit chaque forme. */
export function plural(n: number, one: string, many: string): string {
  return t(n > 1 || (n === 0 && current === "en") ? many : one, { n });
}
