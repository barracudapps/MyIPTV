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

export type NavPosition = "left" | "rail" | "top" | "bottom";
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
  /** Vitrine façon plateforme de streaming : bannière, rangées par genre, grandes affiches. */
  showcase?: boolean;
  /** Disposition de l'écran Direct : classique, salon immersif, programme TV ou magazine. */
  experience?: "classic" | "immersive" | "guide" | "magazine";
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
  /** Effets visuels propres au thème (matières, mouvements), en plus des couleurs. */
  fx?: "luxe" | "stream-red" | "stream-blue" | "stream-teal";
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
    id: "epure",
    name: "Épuré",
    builtin: true,
    colors: { bg: "#111214", surface: "#16171a", surface2: "#1d1f23", border: "#26282d", text: "#e8e8ea", textDim: "#8b8d94", accent: "#e8e8ea", accentText: "#111214", live: "#ef4444", danger: "#f87171" },
    radius: 8,
    font: "system",
    fontScale: 1,
    layout: { ...baseLayout, density: "compact", logoSize: 32, showProgress: false },
  },
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
  {
    id: "cinema",
    name: "Cinéma",
    builtin: true,
    colors: { bg: "#120708", surface: "#1d0d10", surface2: "#2a1418", border: "#3d1d23", text: "#f8ece4", textDim: "#c4a99f", accent: "#d4a537", accentText: "#1d1204", live: "#ef4444", danger: "#f87171" },
    radius: 6,
    font: "serif",
    fontScale: 1.05,
    layout: { ...baseLayout, channelView: "grid", logoSize: 48 },
  },
  {
    id: "foret",
    name: "Forêt",
    builtin: true,
    colors: { bg: "#0c140f", surface: "#132019", surface2: "#1b2c22", border: "#294232", text: "#e8f3ea", textDim: "#9db8a4", accent: "#4ade80", accentText: "#062010", live: "#f97316", danger: "#fb7185" },
    radius: 14,
    font: "rounded",
    fontScale: 1,
    layout: baseLayout,
  },
  {
    id: "crepuscule",
    name: "Crépuscule",
    builtin: true,
    colors: { bg: "#1a1020", surface: "#24152c", surface2: "#311d3b", border: "#46294f", text: "#fdeef4", textDim: "#c9a6bd", accent: "#fb7185", accentText: "#2a0610", live: "#fbbf24", danger: "#f43f5e" },
    radius: 16,
    font: "rounded",
    fontScale: 1,
    layout: baseLayout,
  },
  {
    id: "synthwave",
    name: "Néon rétro",
    builtin: true,
    colors: { bg: "#0d0221", surface: "#160435", surface2: "#21094a", border: "#3b1670", text: "#f5e9ff", textDim: "#b49ad6", accent: "#ff2bd6", accentText: "#1a0016", live: "#00f0ff", danger: "#ff4d6d" },
    radius: 4,
    font: "mono",
    fontScale: 0.95,
    layout: { ...baseLayout, channelView: "grid" },
  },
  {
    id: "papier",
    name: "Papier",
    builtin: true,
    colors: { bg: "#f5efe3", surface: "#fbf7ef", surface2: "#ece3d2", border: "#d9ccb4", text: "#2d2418", textDim: "#7a6a52", accent: "#9a3412", accentText: "#ffffff", live: "#b91c1c", danger: "#b91c1c" },
    radius: 6,
    font: "serif",
    fontScale: 1.05,
    layout: { ...baseLayout, density: "comfortable", showProgress: false },
  },
  {
    id: "lavande",
    name: "Lavande",
    builtin: true,
    colors: { bg: "#f6f3fd", surface: "#ffffff", surface2: "#ece6fb", border: "#d9cff5", text: "#1f1637", textDim: "#6b5f8a", accent: "#7c3aed", accentText: "#ffffff", live: "#e11d48", danger: "#e11d48" },
    radius: 18,
    font: "rounded",
    fontScale: 1,
    layout: { ...baseLayout, channelView: "grid" },
  },
  {
    id: "nordique",
    name: "Nordique",
    builtin: true,
    colors: { bg: "#eceff4", surface: "#f8f9fb", surface2: "#e1e6ee", border: "#cdd4df", text: "#2e3440", textDim: "#5e6a7d", accent: "#5e81ac", accentText: "#ffffff", live: "#bf616a", danger: "#bf616a" },
    radius: 10,
    font: "system",
    fontScale: 1,
    layout: { ...baseLayout, density: "compact" },
  },
  {
    id: "cafe",
    name: "Café",
    builtin: true,
    colors: { bg: "#17110d", surface: "#211813", surface2: "#2d211a", border: "#433126", text: "#f3e9df", textDim: "#bba593", accent: "#e0a46a", accentText: "#24150a", live: "#ef4444", danger: "#f87171" },
    radius: 12,
    font: "system",
    fontScale: 1,
    layout: baseLayout,
  },
  {
    id: "arcade",
    name: "Arcade",
    builtin: true,
    colors: { bg: "#0a0a12", surface: "#12121e", surface2: "#1b1b2c", border: "#2c2c46", text: "#f0f0ff", textDim: "#9a9ac0", accent: "#facc15", accentText: "#1a1400", live: "#22d3ee", danger: "#f43f5e" },
    radius: 2,
    font: "mono",
    fontScale: 1,
    layout: { ...baseLayout, channelView: "grid", density: "compact" },
  },
  {
    id: "grand-ecran",
    name: "Grand écran (TV)",
    builtin: true,
    colors: { ...dark, bg: "#05070b", surface: "#0e121a", surface2: "#171d29", accent: "#38bdf8", accentText: "#03131c" },
    radius: 16,
    font: "rounded",
    fontScale: 1.4,
    layout: { ...baseLayout, nav: "top", density: "tv", channelView: "grid", playerPosition: "top", playerSize: 60, logoSize: 72 },
  },
  {
    // Maison de luxe : noir profond, or brossé, titres Didot, mouvements lents et feutrés.
    id: "maison",
    name: "Maison",
    builtin: true,
    colors: { bg: "#0a0907", surface: "#12100c", surface2: "#1b1812", border: "#2c261b", text: "#f2ebdd", textDim: "#a39781", accent: "#c9a45c", accentText: "#140f06", live: "#b4232c", danger: "#b4232c" },
    radius: 4,
    font: "system",
    fontScale: 1,
    fx: "luxe",
    layout: { ...baseLayout, nav: "left", channelView: "grid", density: "comfortable", logoSize: 48 },
  },
  {
    // Vitrines façon plateformes de streaming : grandes affiches, bannière, rangées par genre.
    id: "rouge-cinema",
    name: "Rouge cinéma",
    builtin: true,
    colors: { bg: "#141414", surface: "#181818", surface2: "#2a2a2a", border: "#303030", text: "#ffffff", textDim: "#b3b3b3", accent: "#e50914", accentText: "#ffffff", live: "#e50914", danger: "#e50914" },
    radius: 4,
    font: "system",
    fontScale: 1,
    fx: "stream-red",
    layout: { ...baseLayout, nav: "top", channelView: "grid", logoSize: 48, showcase: true },
  },
  {
    id: "nuit-etoilee",
    name: "Nuit étoilée",
    builtin: true,
    colors: { bg: "#1a1d29", surface: "#252833", surface2: "#31343e", border: "#3b3e48", text: "#f9f9f9", textDim: "#cacaca", accent: "#0072d2", accentText: "#ffffff", live: "#e0234e", danger: "#e0234e" },
    radius: 10,
    font: "rounded",
    fontScale: 1,
    fx: "stream-blue",
    layout: { ...baseLayout, nav: "rail", channelView: "grid", logoSize: 48, showcase: true },
  },
  {
    id: "bleu-ocean",
    name: "Bleu océan",
    builtin: true,
    colors: { bg: "#0f171e", surface: "#1b2530", surface2: "#252e39", border: "#2d3945", text: "#ffffff", textDim: "#8197a4", accent: "#1a98ff", accentText: "#ffffff", live: "#ff4d4d", danger: "#ff4d4d" },
    radius: 6,
    font: "system",
    fontScale: 1,
    fx: "stream-teal",
    layout: { ...baseLayout, nav: "top", channelView: "grid", logoSize: 48, showcase: true },
  },
  {
    // Dispositions radicalement différentes de l'écran Direct.
    id: "immersif",
    name: "Immersif",
    builtin: true,
    colors: { bg: "#000000", surface: "#0d0f14", surface2: "#1a1d26", border: "#262a35", text: "#f5f7fa", textDim: "#9aa3b2", accent: "#7c5cff", accentText: "#ffffff", live: "#ff3b5c", danger: "#ff3b5c" },
    radius: 14,
    font: "rounded",
    fontScale: 1.1,
    layout: { ...baseLayout, nav: "rail", density: "tv", logoSize: 56, experience: "immersive" },
  },
  {
    id: "programme-tv",
    name: "Programme TV",
    builtin: true,
    colors: { bg: "#f3f1ec", surface: "#ffffff", surface2: "#e9e6de", border: "#d8d3c7", text: "#1b1a17", textDim: "#6f6a5f", accent: "#d9480f", accentText: "#ffffff", live: "#d9480f", danger: "#c92a2a" },
    radius: 6,
    font: "system",
    fontScale: 1,
    layout: { ...baseLayout, nav: "top", density: "compact", experience: "guide" },
  },
  {
    id: "magazine",
    name: "Magazine",
    builtin: true,
    colors: { bg: "#faf7f2", surface: "#ffffff", surface2: "#f0ebe2", border: "#e3dccf", text: "#161412", textDim: "#7a7266", accent: "#b42318", accentText: "#ffffff", live: "#b42318", danger: "#b42318" },
    radius: 2,
    font: "serif",
    fontScale: 1.05,
    layout: { ...baseLayout, nav: "top", experience: "magazine" },
  },
  {
    // Style « lecteur moderne » : barre d'icônes, gris neutres, cartes arrondies, accent bleu.
    id: "studio",
    name: "Studio",
    builtin: true,
    colors: { bg: "#111318", surface: "#181b22", surface2: "#232731", border: "#2b303b", text: "#eceef3", textDim: "#8b92a1", accent: "#4c8dff", accentText: "#ffffff", live: "#ef4444", danger: "#ef4444" },
    radius: 12,
    font: "system",
    fontScale: 1,
    layout: { ...baseLayout, nav: "rail", channelView: "grid", logoSize: 44 },
  },
  {
    id: "studio-clair",
    name: "Studio clair",
    builtin: true,
    colors: { bg: "#f6f7f9", surface: "#ffffff", surface2: "#eceef2", border: "#e1e4ea", text: "#1a1d24", textDim: "#6b7280", accent: "#2f6fec", accentText: "#ffffff", live: "#e11d48", danger: "#dc2626" },
    radius: 12,
    font: "system",
    fontScale: 1,
    layout: { ...baseLayout, nav: "rail", channelView: "grid", logoSize: 44 },
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
    s.setProperty(`--${k.replace(/[A-Z]|\d+/g, (c) => "-" + c.toLowerCase())}`, v);
  }
  s.setProperty("--radius", `${t.radius}px`);
  s.setProperty("--font", FONTS[t.font]);
  s.setProperty("--font-scale", String(t.fontScale));
  s.setProperty("--row-h", `${Math.max(DENSITY_ROW[t.layout.density], t.layout.logoSize + 12)}px`);
  s.setProperty("--logo", `${t.layout.logoSize}px`);
  s.setProperty("--player-size", `${t.layout.playerSize}%`);
  document.documentElement.dataset.nav = t.layout.nav;
  document.documentElement.dataset.density = t.layout.density;
  document.documentElement.dataset.experience = t.layout.experience ?? "classic";
  if (t.layout.showcase) document.documentElement.dataset.showcase = "on";
  else delete document.documentElement.dataset.showcase;
  if (t.fx) document.documentElement.dataset.fx = t.fx;
  else delete document.documentElement.dataset.fx;
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
