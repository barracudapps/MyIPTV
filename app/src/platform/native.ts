import { invoke } from "@tauri-apps/api/core";
import type { Backend } from ".";
import type { Source } from "../types";

/** Le Rust attend la source sans les champs propres à l'interface. */
function toCore(s: Source) {
  const { enabled: _e, addedAt: _a, risk: _r, builtin: _b, ...rest } = s;
  return rest;
}

export function createNativeBackend(): Backend {
  return {
    name: "native",
    diskTimeshift: true,
    loadSource: (source, force) => invoke("load_source", { source: toCore(source), force }),
    previewSource: (source) => invoke("preview_source", { source: toCore(source) }),
    removeSource: (id, purge) => invoke("remove_source", { id, purge }),
    loadEpg: (urls, force) => invoke("load_epg", { urls, force }),
    programmes: (channels, from, to) => invoke("programmes", { channels, from, to }),
    catchupUrl: (channel, start, stop) => invoke("catchup_url", { channel, start, stop }),
    searchProgrammes: (query, limit) => invoke("search_programmes", { query, limit }),
    vodQuery: (query) => invoke("vod_query", { query }),
    vodFacets: (kind, preferLanguages, includeAdult) => invoke("vod_facets", { kind, preferLanguages, includeAdult }),
    vodSearch: (text, field, preferLanguages, includeAdult, perKind) => invoke("vod_search", { text, field, preferLanguages, includeAdult, perKind }),
    vodDetail: (id, keys) => invoke("vod_detail", { id, keys }),
    person: (name, tmdbId, keys) => invoke("person", { name, tmdbId, keys }),
    jellyfinLogin: (server, username, password) => invoke("jellyfin_login", { server, username, password }),
    recList: () => invoke("rec_list"),
    recSchedule: (req) => invoke("rec_schedule", { req }),
    recCancel: (id, deleteFile) => invoke("rec_cancel", { id, deleteFile }),
    recInfo: () => invoke("rec_info"),
    play: (req) => invoke("play", { req }),
    stop: () => invoke("stop_playback"),
  };
}
