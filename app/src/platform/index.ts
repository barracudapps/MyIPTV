import type { Channel, EpgStats, PlayInfo, PlayRequest, Programme, Source, SourceResult } from "../types";

/** Services fournis par la plateforme : natif (Tauri + Rust) ou web/TV (WASM). */
export interface Backend {
  readonly name: "native" | "web";
  /** Timeshift sur disque disponible (pause longue du direct). */
  readonly diskTimeshift: boolean;
  loadSource(source: Source, force: boolean): Promise<SourceResult>;
  previewSource(source: Source): Promise<SourceResult>;
  removeSource(id: string): Promise<void>;
  loadEpg(urls: string[], force: boolean): Promise<EpgStats>;
  programmes(channels: Channel[], from: number, to: number): Promise<Record<string, Programme[]>>;
  catchupUrl(channel: Channel, start: number, stop: number): Promise<string | null>;
  searchProgrammes(query: string, limit: number): Promise<{ channelId: string; programme: Programme }[]>;
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
