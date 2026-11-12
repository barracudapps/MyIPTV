export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  live: string;
  danger: string;
}

export type NavPosition = "left" | "top" | "bottom";
export type Density = "compact" | "comfortable" | "tv";
export type ChannelView = "list" | "grid";
export type PlayerPosition = "right" | "left" | "top";
export type FontFamily = "system" | "rounded" | "serif" | "mono";

export interface ThemeLayout {
  nav: NavPosition;
  density: Density;
  channelView: ChannelView;
  playerPosition: PlayerPosition;
  /** Proportion de l'écran occupée par le lecteur en vue Direct (25–75 %). */
  playerSize: number;
  logoSize: number;
  showNowNext: boolean;
  showProgress: boolean;
  showClock: boolean;
  showGroups: boolean;
}

export interface Theme {
  id: string;
  name: string;
  builtin?: boolean;
  colors: ThemeColors;
  radius: number;
  font: FontFamily;
  fontScale: number;
  layout: ThemeLayout;
}

const baseLayout: ThemeLayout = {
  nav: "left",
  density: "comfortable",
  channelView: "list",
  playerPosition: "right",
  playerSize: 58,
  logoSize: 40,
  showNowNext: true,
  showProgress: true,
  showClock: true,
  showGroups: true,
};

const dark: ThemeColors = {
  bg: "#0b0d12",
  surface: "#141821",
  surface2: "#1d2330",
  border: "#2a3142",
  text: "#eef1f7",
  textDim: "#98a2b8",
  accent: "#6d5dfc",
  accentText: "#ffffff",
  live: "#ef4444",
  danger: "#f87171",
};

export const BUILTIN_THEMES: Theme[] = [
  { id: "nuit", name: "Nuit", builtin: true, colors: dark, radius: 12, font: "system", fontScale: 1, layout: baseLayout },
  {
    id: "clair",
    name: "Clair",
    builtin: true,
    colors: { bg: "#f4f6fb", surface: "#ffffff", surface2: "#e9edf5", border: "#d5dbe7", text: "#111827", textDim: "#5b6478", accent: "#4f46e5", accentText: "#ffffff", live: "#dc2626", danger: "#dc2626" },
    radius: 12,
    font: "system",
    fontScale: 1,
    layout: baseLayout,
  },
  {
    id: "oled",
    name: "OLED noir",
    builtin: true,
    colors: { ...dark, bg: "#000000", surface: "#0a0a0a", surface2: "#151515", border: "#222222", accent: "#22c55e", accentText: "#04110a" },
    radius: 6,
    font: "system",
    fontScale: 1,
    layout: { ...baseLayout, density: "compact" },
  },
  {
    id: "ocean",
    name: "Océan",
    builtin: true,
    colors: { bg: "#06151f", surface: "#0b2230", surface2: "#11303f", border: "#1b4558", text: "#e6f6ff", textDim: "#8fb3c6", accent: "#22c3ee", accentText: "#03202b", live: "#fb7185", danger: "#fb7185" },
    radius: 16,
    font: "rounded",
    fontScale: 1,
    layout: { ...baseLayout, channelView: "grid" },
  },
  {
    id: "salon",
    name: "Salon TV",
    builtin: true,
    colors: { ...dark, bg: "#101014", surface: "#1a1a22", surface2: "#252532", accent: "#f59e0b", accentText: "#1a1204" },
    radius: 14,
    font: "system",
    fontScale: 1.25,
    layout: { ...baseLayout, nav: "top", density: "tv", playerPosition: "top", playerSize: 55, logoSize: 56 },
  },
  {
    id: "contraste",
    name: "Contraste élevé",
    builtin: true,
    colors: { bg: "#000000", surface: "#000000", surface2: "#1a1a1a", border: "#ffffff", text: "#ffffff", textDim: "#ffff00", accent: "#ffff00", accentText: "#000000", live: "#ff3b3b", danger: "#ff3b3b" },
    radius: 0,
    font: "system",
    fontScale: 1.15,
    layout: { ...baseLayout, density: "comfortable", logoSize: 48 },
  },
  {
    id: "enfants",
    name: "Enfants",
    builtin: true,
    colors: { bg: "#fff7ed", surface: "#ffffff", surface2: "#ffedd5", border: "#fed7aa", text: "#431407", textDim: "#9a3412", accent: "#f97316", accentText: "#ffffff", live: "#e11d48", danger: "#e11d48" },
    radius: 22,
    font: "rounded",
    fontScale: 1.2,
    layout: { ...baseLayout, channelView: "grid", density: "tv", logoSize: 72, showGroups: false, showClock: false },
  },
];

const FONTS: Record<FontFamily, string> = {
  system: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
  rounded: `ui-rounded, "SF Pro Rounded", "Nunito", "Quicksand", -apple-system, "Segoe UI", sans-serif`,
  serif: `ui-serif, Georgia, "Times New Roman", serif`,
  mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
};

const DENSITY_ROW: Record<Density, number> = { compact: 44, comfortable: 60, tv: 76 };

/** Applique un thème via des variables CSS sur <html>. */
export function applyTheme(t: Theme) {
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(t.colors)) {
    s.setProperty(`--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`, v);
  }
  s.setProperty("--radius", `${t.radius}px`);
  s.setProperty("--font", FONTS[t.font]);
  s.setProperty("--font-scale", String(t.fontScale));
  s.setProperty("--row-h", `${Math.max(DENSITY_ROW[t.layout.density], t.layout.logoSize + 12)}px`);
  s.setProperty("--logo", `${t.layout.logoSize}px`);
  s.setProperty("--player-size", `${t.layout.playerSize}%`);
  document.documentElement.dataset.nav = t.layout.nav;
  document.documentElement.dataset.density = t.layout.density;
  document.documentElement.style.colorScheme = isLight(t.colors.bg) ? "light" : "dark";
}

function isLight(hex: string) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

export const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  bg: "Fond",
  surface: "Panneaux",
  surface2: "Éléments",
  border: "Bordures",
  text: "Texte",
  textDim: "Texte secondaire",
  accent: "Accent",
  accentText: "Texte sur accent",
  live: "Direct",
  danger: "Alerte",
};
