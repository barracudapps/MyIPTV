export type Catchup =
  | { kind: "template"; template: string; append: boolean; days: number }
  | { kind: "xtream"; server: string; username: string; password: string; streamId: number; days: number }
  | { kind: "flussonic"; days: number };

export interface Channel {
  id: string;
  sourceId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  country?: string;
  language?: string;
  userAgent?: string;
  referrer?: string;
  catchup?: Catchup;
  adult?: boolean;
  languages?: string[];
  countries?: string[];
  /** Autres copies de la même chaîne (autres sources ou qualités), regroupées sous celle-ci. */
  variants?: Channel[];
  /** Rang d'affichage du groupe (position de sa première copie). */
  groupOrder?: number;
}

export interface Programme {
  start: number;
  stop: number;
  title: string;
  subtitle?: string;
  desc?: string;
  category?: string;
  icon?: string;
  episode?: string;
  age?: number;
}

export type SourceKind =
  | { kind: "m3uUrl"; url: string }
  | { kind: "m3uText"; content: string; /** Contenu rangé dans IndexedDB : il n'est plus copié dans les réglages. */ contentStored?: boolean; /** Empreinte du contenu, pour reconnaître un fichier déjà importé. */ contentHash?: string }
  | { kind: "xtream"; server: string; username: string; password: string; output?: string }
  | { kind: "archive"; collection: string; mediatype: string; content: VodKind; rows?: number }
  | { kind: "radioBrowser"; countries: string[] }
  | { kind: "podcasts"; countries: string[] }
  | { kind: "librivox"; languages: string[] }
  | { kind: "jellyfin"; server: string; userId: string; token: string };

export type Source = SourceKind & {
  id: string;
  name: string;
  epgUrls: string[];
  enabled: boolean;
  addedAt: number;
  /** Niveau de risque constaté à l'import, conservé pour l'administrateur. */
  risk?: RiskLevel;
  /** Source légale intégrée par défaut (désactivable, non modifiable). */
  builtin?: boolean;
};

export type RiskLevel = "low" | "medium" | "high";

export interface RiskReport {
  level: RiskLevel;
  premiumCount: number;
  vodCount: number;
  resellerUrlCount: number;
  total: number;
  examples: string[];
  reasons: string[];
}

export interface SourceResult {
  channels: Channel[];
  vodCounts: Record<string, number>;
  epgUrls: string[];
  risk: RiskReport;
  fetchedAt: number;
}

export interface EpgStats {
  channels: number;
  programmes: number;
  errors: string[];
  /** Guides retirés par leur serveur (404, 410), ignorés. */
  missing?: string[];
}

export type StreamKind = "hls" | "mpegts" | "native" | "remux" | "youtube" | "webpage";

export interface StreamTrack {
  index: number;
  codec: string;
  language?: string;
  title?: string;
  channels?: number;
}

export interface PlayInfo {
  url: string;
  kind: StreamKind;
  timeshift: boolean;
  error?: string | null;
  /** Conversion à la volée : durée totale et pistes audio du fichier d'origine. */
  duration?: number;
  audioTracks?: StreamTrack[];
  remuxFormat?: "mpegts" | "mp4" | "mp3";
}

export interface PlayRequest {
  url: string;
  userAgent?: string;
  referrer?: string;
  timeshift: boolean;
  windowMinutes: number;
  /** Film, épisode, piste : format analysé et converti si nécessaire. */
  media?: boolean;
  /** Le lecteur a échoué sur le flux direct : passer par ffmpeg. */
  forceRemux?: boolean;
}

// ------------------------------------------------------------------ Bibliothèque

export type VodKind = "movie" | "series" | "show" | "music" | "radio" | "podcast" | "audiobook";

export interface Episode {
  id: string;
  season: number;
  episode: number;
  title: string;
  url: string;
  duration?: number;
  plot?: string;
  still?: string;
  airDate?: string;
}

export interface VodItem {
  id: string;
  sourceId: string;
  kind?: VodKind;
  title: string;
  rawName: string;
  year?: number;
  url?: string;
  poster?: string;
  backdrop?: string;
  category?: string;
  genres?: string[];
  languages?: string[];
  rating?: number;
  plot?: string;
  cast?: string[];
  directors?: string[];
  duration?: number;
  added?: number;
  tmdbId?: number;
  imdbId?: string;
  trailer?: string;
  userAgent?: string;
  referrer?: string;
  live?: boolean;
  adult?: boolean;
  episodes?: Episode[];
  /** Autres copies du même contenu (autres sources), regroupées sous celle-ci. */
  alternates?: VodItem[];
  /** Origine du contenu (fiche et flux), transmise telle quelle au cœur. */
  sourceRef?: { type: "xtream" | "archive" | "jellyfin"; token?: string };
}

export interface Person {
  name: string;
  role?: string;
  photo?: string;
  tmdbId?: number;
}

export interface Season {
  number: number;
  name: string;
  episodes: Episode[];
}

export interface VodDetail {
  item: VodItem;
  cast: Person[];
  crew: Person[];
  seasons: Season[];
  imdbRating?: number;
  imdbVotes?: string;
  tmdbRating?: number;
  tagline?: string;
  countries: string[];
  age?: number;
}

export type SearchField = "all" | "title" | "actor" | "director" | "genre" | "year" | "category" | "plot";
export type VodSort = "default" | "added" | "rating" | "title" | "year";

export interface VodQuery {
  kind?: VodKind;
  category?: string;
  genre?: string;
  language?: string;
  anyLanguages?: string[];
  country?: string;
  includeUnknownLanguage?: boolean;
  preferLanguages: string[];
  text?: string;
  field?: SearchField;
  ids?: string[];
  sort?: VodSort;
  includeAdult?: boolean;
  offset?: number;
  limit?: number;
}

export interface VodPage {
  total: number;
  items: VodItem[];
}

export interface Facet {
  name: string;
  count: number;
  label: string;
  language?: string;
}

export interface VodFacets {
  total: number;
  categories: Facet[];
  genres: Facet[];
  languages: Facet[];
  countries: Facet[];
}

export interface MetaKeys {
  tmdb?: string;
  omdb?: string;
  language?: string;
}

export interface Credit {
  title: string;
  year?: number;
  kind: VodKind;
  tmdbId: number;
  role?: string;
  poster?: string;
  availableId?: string;
}

export interface PersonView {
  name: string;
  photo?: string;
  biography?: string;
  birthday?: string;
  knownFor?: string;
  items: VodItem[];
  credits: Credit[];
}

// ------------------------------------------------------------------ Enregistrements

export type RecStatus = "scheduled" | "recording" | "done" | "failed" | "cancelled";

export interface Recording {
  id: string;
  channel: Channel;
  title: string;
  subtitle?: string;
  start: number;
  stop: number;
  padBefore: number;
  padAfter: number;
  status: RecStatus;
  file?: string;
  size: number;
  error?: string;
  profileId?: string;
}

export interface RecInfo {
  dir: string;
  ffmpeg: boolean;
  base: string;
}
