import type { RecInfo, Recording } from "../types";
import type { Channel, EpgStats, MetaKeys, PersonView, PlayInfo, PlayRequest, Programme, SearchField, Source, SourceResult, VodDetail, VodFacets, VodKind, VodPage, VodQuery } from "../types";

/** Services fournis par la plateforme : natif (Tauri + Rust) ou web/TV (WASM). */
export interface Backend {
  readonly name: "native" | "web";
  /** Timeshift sur disque disponible (pause longue du direct). */
  readonly diskTimeshift: boolean;
  loadSource(source: Source, force: boolean): Promise<SourceResult>;
  previewSource(source: Source): Promise<SourceResult>;
  removeSource(id: string, purge: boolean): Promise<void>;
  loadEpg(urls: string[], force: boolean): Promise<EpgStats>;
  programmes(channels: Channel[], from: number, to: number): Promise<Record<string, Programme[]>>;
  catchupUrl(channel: Channel, start: number, stop: number): Promise<string | null>;
  searchProgrammes(query: string, limit: number): Promise<{ channelId: string; programme: Programme }[]>;
  vodQuery(query: VodQuery): Promise<VodPage>;
  vodFacets(kind: VodKind | undefined, preferLanguages: string[], includeAdult: boolean): Promise<VodFacets>;
  vodSearch(text: string, field: SearchField, preferLanguages: string[], includeAdult: boolean, perKind: number): Promise<Partial<Record<VodKind, VodPage>>>;
  vodDetail(id: string, keys: MetaKeys): Promise<VodDetail>;
  person(name: string, tmdbId: number | undefined, keys: MetaKeys): Promise<PersonView>;
  recList(): Promise<Recording[]>;
  recSchedule(req: { channel: Channel; title: string; subtitle?: string; start: number; stop: number; profileId?: string }): Promise<Recording>;
  recCancel(id: string, deleteFile: boolean): Promise<void>;
  recInfo(): Promise<RecInfo | null>;
  play(req: PlayRequest): Promise<PlayInfo>;
  stop(): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let backend: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  backend ??= isTauri
    ? import("./native").then((m) => m.createNativeBackend())
    : import("./web").then((m) => m.createWebBackend());
  return backend;
}
