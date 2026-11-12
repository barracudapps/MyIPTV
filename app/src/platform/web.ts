import type { Backend } from ".";
import type { Channel, PlayInfo, SourceResult, StreamKind } from "../types";

/**
 * Version web / smart TV : le cœur Rust tourne en WebAssembly.
 * Limites : pas de proxy (le serveur doit autoriser CORS) et timeshift
 * limité au tampon mémoire du lecteur.
 */
type Wasm = {
  default: (input?: unknown) => Promise<unknown>;
  parseM3u(text: string, sourceId: string): { channels: Channel[]; epgUrls: string[] };
  xtreamApiUrl(server: string, user: string, pass: string, action?: string): string;
  xtreamXmltvUrl(server: string, user: string, pass: string): string;
  xtreamChannels(server: string, user: string, pass: string, output: string, sourceId: string, cats: string, streams: string): Channel[];
  loadEpg(bytes: Uint8Array, channels: Channel[], from: number, to: number): number;
  clearEpg(): void;
  programmes(channels: Channel[], from: number, to: number): Record<string, never>;
  catchupUrl(channel: Channel, start: number, stop: number, now: number): string | undefined;
  analyzeRisk(channels: Channel[]): SourceResult["risk"];
  youtubeEmbed(url: string): string | undefined;
  isYoutube(url: string): boolean;
  shareId(code: string): string;
  shareOpen(code: string, data: Uint8Array): string;
};

const SHARE_PORT = 47820;

const wasmModules = import.meta.glob("../wasm/iptv_core.js");

async function loadWasm(): Promise<Wasm> {
  const loader = wasmModules["../wasm/iptv_core.js"];
  if (!loader) throw new Error("Module WebAssembly absent : lancez `npm run wasm`.");
  const mod = (await loader()) as Wasm;
  await mod.default();
  return mod;
}

function guessKind(url: string): StreamKind {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "hls";
  if (/\.(mp4|mkv|webm|mov|m4v|mp3|aac)$/.test(path)) return "native";
  return "mpegts";
}

const now = () => Math.floor(Date.now() / 1000);

export async function createWebBackend(): Promise<Backend> {
  const w = await loadWasm();
  const loaded = new Map<string, Channel[]>();

  async function fetchText(url: string): Promise<string> {
    const r = await fetch(url).catch(() => {
      throw new Error("Téléchargement impossible (le serveur n'autorise peut-être pas l'accès depuis le navigateur).");
    });
    if (!r.ok) throw new Error(`Le serveur a répondu ${r.status}`);
    return r.text();
  }

  async function fetchSource(source: Parameters<Backend["loadSource"]>[0]) {
    switch (source.kind) {
      case "m3uUrl":
        return w.parseM3u(await fetchText(source.url), source.id);
      case "m3uText":
        return w.parseM3u(source.content, source.id);
      case "archive":
      case "radioBrowser":
      case "podcasts":
      case "librivox":
      case "jellyfin":
        return { channels: [], epgUrls: [] };
      case "xtream": {
        const { server, username, password } = source;
        const cats = await fetchText(w.xtreamApiUrl(server, username, password, "get_live_categories"));
        const streams = await fetchText(w.xtreamApiUrl(server, username, password, "get_live_streams"));
        return {
          channels: w.xtreamChannels(server, username, password, source.output ?? "m3u8", source.id, cats, streams),
          epgUrls: [w.xtreamXmltvUrl(server, username, password)],
        };
      }
    }
  }

  return {
    name: "web",
    diskTimeshift: false,
    async loadSource(source) {
      const pl = await fetchSource(source);
      loaded.set(source.id, pl.channels);
      return { channels: pl.channels, vodCounts: {}, epgUrls: [...pl.epgUrls, ...source.epgUrls], risk: w.analyzeRisk(pl.channels), fetchedAt: now() };
    },
    async previewSource(source) {
      const pl = await fetchSource(source);
      return { channels: [], vodCounts: {}, epgUrls: pl.epgUrls, risk: w.analyzeRisk(pl.channels), fetchedAt: now() };
    },
    async removeSource(id) {
      loaded.delete(id);
    },
    async loadEpg(urls) {
      w.clearEpg();
      const all = [...loaded.values()].flat();
      const errors: string[] = [];
      const missing: string[] = [];
      let programmes = 0;
      for (const url of new Set(urls)) {
        try {
          const r = await fetch(url);
          if (r.status === 404 || r.status === 410) {
            missing.push(url);
            continue;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          programmes += w.loadEpg(new Uint8Array(await r.arrayBuffer()), all, now() - 8 * 86400, now() + 4 * 86400);
        } catch (e) {
          // fetch rejette sans détail quand le serveur n'autorise pas les autres sites (CORS).
          const msg = e instanceof TypeError ? "le serveur de ce guide n'autorise pas la lecture depuis un navigateur (il fonctionne dans l'application de bureau et sur TV)" : e instanceof Error ? e.message : String(e);
          errors.push(`${url} : ${msg}`);
        }
      }
      return { channels: 0, programmes, errors, missing };
    },
    async programmes(channels, from, to) {
      return w.programmes(channels, from, to);
    },
    async catchupUrl(channel, start, stop) {
      return w.catchupUrl(channel, start, stop, now()) ?? null;
    },
    async searchProgrammes() {
      // Recherche dans le guide non disponible en version TV (mémoire limitée).
      return [];
    },
    // La bibliothèque (films, séries…) n'est pas encore portée sur la version TV/navigateur.
    async vodQuery() {
      return { total: 0, items: [] };
    },
    async vodFacets() {
      return { total: 0, categories: [], genres: [], languages: [], countries: [] };
    },
    async vodSearch() {
      return {};
    },
    async vodDetail() {
      throw new Error("Bibliothèque indisponible sur cette plateforme pour le moment.");
    },
    async person(name) {
      return { name, items: [], credits: [] };
    },
    async jellyfinLogin() {
      throw new Error("La connexion à un serveur Jellyfin n'est disponible que sur l'application de bureau ou Android pour le moment.");
    },
    // Enregistrement impossible depuis un navigateur ou une TV (pas d'accès disque).
    async recList() {
      return [];
    },
    async recSchedule() {
      throw new Error("L'enregistrement n'est disponible que sur l'application de bureau ou Android.");
    },
    async recCancel() {},
    async shareFetch(address, code) {
      let base = address.trim().replace(/\/+$/, "");
      if (!/^https?:\/\//.test(base)) base = `http://${base}`;
      if (!/:\d+$/.test(base)) base += `:${SHARE_PORT}`;
      const r = await fetch(`${base}/myiptv-share/${w.shareId(code)}`, { cache: "no-store" }).catch(() => {
        throw new Error(
          location.protocol === "https:"
            ? "Le navigateur bloque l'accès aux appareils du réseau depuis une page sécurisée : utilisez l'application ou la version TV."
            : "Appareil injoignable : vérifiez l'adresse et que les deux appareils sont sur le même réseau.",
        );
      });
      if (r.status === 404) throw new Error("Code incorrect.");
      if (r.status === 410) throw new Error("Ce partage est terminé ou a expiré.");
      if (!r.ok) throw new Error(`L'appareil a répondu ${r.status}.`);
      return w.shareOpen(code, new Uint8Array(await r.arrayBuffer()));
    },
    async recInfo() {
      return null;
    },
    async play(req): Promise<PlayInfo> {
      // Directs YouTube : lecteur intégré quand l'identifiant est dans l'adresse,
      // sinon lien d'ouverture (la version web ne peut pas lire la page de la chaîne).
      if (w.isYoutube(req.url)) return { url: w.youtubeEmbed(req.url) ?? req.url, kind: "youtube", timeshift: false };
      return { url: req.url, kind: guessKind(req.url), timeshift: false };
    },
    async stop() {},
  };
}
