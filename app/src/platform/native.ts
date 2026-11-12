import { invoke } from "@tauri-apps/api/core";
import type { Backend } from ".";
import type { Source } from "../types";

/** Le Rust attend la source sans les champs propres à l'interface. */
function toCore(s: Source) {
  const { enabled: _e, addedAt: _a, risk: _r, ...rest } = s;
  return rest;
}

export function createNativeBackend(): Backend {
  return {
    name: "native",
    diskTimeshift: true,
    loadSource: (source, force) => invoke("load_source", { source: toCore(source), force }),
    previewSource: (source) => invoke("preview_source", { source: toCore(source) }),
    removeSource: (id) => invoke("remove_source", { id }),
    loadEpg: (urls, force) => invoke("load_epg", { urls, force }),
    programmes: (channels, from, to) => invoke("programmes", { channels, from, to }),
    catchupUrl: (channel, start, stop) => invoke("catchup_url", { channel, start, stop }),
    searchProgrammes: (query, limit) => invoke("search_programmes", { query, limit }),
    play: (req) => invoke("play", { req }),
    stop: () => invoke("stop_playback"),
  };
}
