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
  | { kind: "m3uText"; content: string }
  | { kind: "xtream"; server: string; username: string; password: string; output?: string };

export type Source = SourceKind & {
  id: string;
  name: string;
  epgUrls: string[];
  enabled: boolean;
  addedAt: number;
  /** Niveau de risque constaté à l'import, conservé pour l'administrateur. */
  risk?: RiskLevel;
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
  epgUrls: string[];
  risk: RiskReport;
  fetchedAt: number;
}

export interface EpgStats {
  channels: number;
  programmes: number;
  errors: string[];
}

export type StreamKind = "hls" | "mpegts" | "native";

export interface PlayInfo {
  url: string;
  kind: StreamKind;
  timeshift: boolean;
  error?: string | null;
}

export interface PlayRequest {
  url: string;
  userAgent?: string;
  referrer?: string;
  timeshift: boolean;
  windowMinutes: number;
}
