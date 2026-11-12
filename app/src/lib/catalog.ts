/**
 * Catalogue intégré : playlists publiques du projet iptv-org, qui ne recense que
 * des chaînes diffusées gratuitement par leurs éditeurs (en clair, FAST, publiques).
 * https://github.com/iptv-org/iptv
 */
const BASE = "https://iptv-org.github.io/iptv";

export interface CatalogEntry {
  id: string;
  name: string;
  url: string;
  hint?: string;
}

export const CATALOG_ALL: CatalogEntry = { id: "all", name: "Toutes les chaînes gratuites du monde", url: `${BASE}/index.m3u`, hint: "≈ 10 000 chaînes" };

export const CATALOG_COUNTRIES: CatalogEntry[] = [
  ["fr", "France"],
  ["be", "Belgique"],
  ["ch", "Suisse"],
  ["ca", "Canada"],
  ["lu", "Luxembourg"],
  ["ma", "Maroc"],
  ["dz", "Algérie"],
  ["tn", "Tunisie"],
  ["sn", "Sénégal"],
  ["ci", "Côte d'Ivoire"],
  ["us", "États-Unis"],
  ["uk", "Royaume-Uni"],
  ["de", "Allemagne"],
  ["es", "Espagne"],
  ["it", "Italie"],
  ["pt", "Portugal"],
  ["nl", "Pays-Bas"],
  ["br", "Brésil"],
  ["mx", "Mexique"],
  ["ar", "Argentine"],
  ["jp", "Japon"],
  ["kr", "Corée du Sud"],
  ["in", "Inde"],
  ["tr", "Turquie"],
].map(([code, name]) => ({ id: `country-${code}`, name, url: `${BASE}/countries/${code}.m3u` }));

export const CATALOG_LANGUAGES: CatalogEntry[] = [
  ["fra", "Français"],
  ["eng", "Anglais"],
  ["spa", "Espagnol"],
  ["ara", "Arabe"],
  ["deu", "Allemand"],
  ["ita", "Italien"],
  ["por", "Portugais"],
  ["nld", "Néerlandais"],
].map(([code, name]) => ({ id: `lang-${code}`, name, url: `${BASE}/languages/${code}.m3u` }));

export const CATALOG_CATEGORIES: CatalogEntry[] = [
  ["news", "Information"],
  ["kids", "Enfants"],
  ["documentary", "Documentaires"],
  ["music", "Musique"],
  ["sports", "Sport"],
  ["movies", "Cinéma (chaînes gratuites)"],
  ["culture", "Culture"],
  ["education", "Éducation"],
  ["science", "Sciences"],
  ["cooking", "Cuisine"],
  ["travel", "Voyage"],
  ["weather", "Météo"],
].map(([code, name]) => ({ id: `cat-${code}`, name, url: `${BASE}/categories/${code}.m3u` }));

/**
 * Plateformes de chaînes gratuites financées par la publicité (FAST), diffusées
 * officiellement par ces services ; listes tenues par la communauté apsattv.com.
 * Surtout américaines et anglophones, parfois géo-restreintes.
 */
const APSAT = "https://www.apsattv.com";
export const CATALOG_FAST: CatalogEntry[] = [
  { id: "fast-lg", name: "LG Channels", url: `${APSAT}/lg.m3u`, hint: "≈ 1 300 chaînes, plusieurs pays" },
  { id: "fast-xumo", name: "Xumo Play", url: `${APSAT}/xumo.m3u`, hint: "≈ 400 chaînes, États-Unis" },
  { id: "fast-roku", name: "The Roku Channel", url: `${APSAT}/rok.m3u`, hint: "≈ 330 chaînes, États-Unis" },
  { id: "fast-distro", name: "DistroTV", url: `${APSAT}/distro.m3u`, hint: "≈ 340 chaînes, international" },
  { id: "fast-tcl", name: "TCL TV+", url: `${APSAT}/tcl.m3u`, hint: "≈ 600 chaînes, États-Unis" },
];

/** Serveur de démonstration officiel de Jellyfin : films libres et du domaine public. */
export const JELLYFIN_DEMO = { server: "https://demo.jellyfin.org/stable", username: "demo", password: "" };
