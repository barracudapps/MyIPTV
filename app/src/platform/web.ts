import type { Backend } from ".";
import type { Channel, Credit, PlayInfo, SourceResult, StreamKind, VodDetail, VodFacets, VodItem, VodKind, VodPage, VodQuery } from "../types";

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
  setVod(sourceId: string, items: VodItem[]): void;
  vodQuery(q: VodQuery): VodPage;
  vodFacets(kind: string | undefined, prefs: string[], adult: boolean): VodFacets;
  vodSearch(text: string, field: string, prefs: string[], adult: boolean, perKind: number): Partial<Record<VodKind, VodPage>>;
  vodItem(id: string): VodItem | null;
  vodByTmdb(ids: number[]): VodItem[];
  vodEnrich(id: string, detail: VodDetail): void;
  vodWithPerson(name: string): VodItem[];
  vodMatchCredit(title: string, year: number | undefined, tmdbId: number | undefined, kind: string): VodItem | null;
  xtreamVodItems(server: string, user: string, pass: string, output: string, sourceId: string, vcats: string, vstreams: string, scats: string, series: string): VodItem[];
  archiveSearchUrl(collection: string, mediatype: string, rows: number): string;
  archiveItems(json: string, kind: string, sourceId: string, groupShows: boolean): VodItem[];
  librivoxUrl(language: string | undefined, rows: number): string;
  radioSearchUrl(country: string | undefined, limit: number): string;
  radioItems(json: string, sourceId: string): VodItem[];
  podcastChartUrl(country: string, limit: number): string;
  podcastChartIds(json: string): string[];
  podcastLookupUrl(ids: string[], country: string): string;
  podcastItems(json: string, sourceId: string, country: string): VodItem[];
  jellyfinItemsUrl(server: string, userId: string): string;
  jellyfinAuthHeader(token?: string): string;
  jellyfinItems(json: string, sourceId: string, server: string, token: string): VodItem[];
  detailPlan(item: VodItem, jellyfinUser?: string): { kind: string; url?: string; episodesUrl?: string };
  detailBuild(item: VodItem, body?: string, episodesBody?: string, rss?: Uint8Array): VodDetail;
  tmdbIsBearer(key: string): boolean;
  tmdbSearchUrl(kind: string, title: string, year: number | undefined, key: string, lang: string): string;
  tmdbPick(json: string, title: string): number | undefined;
  tmdbDetailsUrl(kind: string, id: number, key: string, lang: string): string;
  tmdbApply(detail: VodDetail, json: string): VodDetail;
  omdbUrl(imdbId: string, key: string): string;
  omdbApply(detail: VodDetail, json: string): VodDetail;
  tmdbPersonSearchUrl(name: string, key: string, lang: string): string;
  tmdbPersonUrl(id: number, key: string, lang: string): string;
  tmdbPersonInfo(json: string): { photo?: string; biography?: string; birthday?: string; knownFor?: string; credits: (Credit & { tmdbId: number; title: string; year?: number; kind: string })[] };
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

  async function fetchJson(url: string, headers?: Record<string, string>): Promise<string> {
    const r = await fetch(url, headers ? { headers } : undefined).catch(() => {
      throw new Error("Service injoignable depuis le navigateur.");
    });
    if (!r.ok) throw new Error(`Le serveur a répondu ${r.status}`);
    return r.text();
  }

  /** Comptes Jellyfin chargés : source -> utilisateur (nécessaire aux fiches). */
  const jellyfinUsers = new Map<string, string>();

  type Loaded = { channels: Channel[]; epgUrls: string[]; vod: VodItem[] };

  /** Mêmes sources que l'application native, avec les analyseurs du cœur en WebAssembly. */
  async function fetchSource(source: Parameters<Backend["loadSource"]>[0]): Promise<Loaded> {
    const sid = source.id;
    switch (source.kind) {
      case "m3uUrl": {
        const pl = w.parseM3u(await fetchText(source.url), sid) as Loaded;
        return { channels: pl.channels, epgUrls: pl.epgUrls, vod: pl.vod ?? [] };
      }
      case "m3uText": {
        const pl = w.parseM3u(source.content, sid) as Loaded;
        return { channels: pl.channels, epgUrls: pl.epgUrls, vod: pl.vod ?? [] };
      }
      case "xtream": {
        const { server, username, password } = source;
        const api = (action: string) => fetchText(w.xtreamApiUrl(server, username, password, action)).catch(() => "[]");
        const [cats, streams, vcats, vstreams, scats, series] = await Promise.all(
          ["get_live_categories", "get_live_streams", "get_vod_categories", "get_vod_streams", "get_series_categories", "get_series"].map(api),
        );
        if (streams === "[]" && vstreams === "[]" && series === "[]") throw new Error("Serveur Xtream injoignable ou identifiants refusés.");
        return {
          channels: w.xtreamChannels(server, username, password, source.output ?? "m3u8", sid, cats, streams),
          epgUrls: [w.xtreamXmltvUrl(server, username, password)],
          vod: w.xtreamVodItems(server, username, password, source.output ?? "m3u8", sid, vcats, vstreams, scats, series),
        };
      }
      case "archive":
        return { channels: [], epgUrls: [], vod: w.archiveItems(await fetchJson(w.archiveSearchUrl(source.collection, source.mediatype, source.rows ?? 400)), source.content, sid, true) };
      case "librivox": {
        const langs = source.languages.length ? source.languages.slice(0, 6) : [undefined];
        const vod: VodItem[] = [];
        for (const l of langs) {
          const text = await fetchJson(w.librivoxUrl(l, 400)).catch(() => null);
          if (!text) continue;
          for (const i of w.archiveItems(text, "audiobook", sid, false)) vod.push(i.languages?.length || !l ? i : { ...i, languages: [l] });
        }
        return { channels: [], epgUrls: [], vod };
      }
      case "radioBrowser": {
        const urls = [...source.countries.slice(0, 8).map((c) => w.radioSearchUrl(c, 300)), w.radioSearchUrl(undefined, 300)];
        const seen = new Set<string>();
        const vod: VodItem[] = [];
        for (const u of urls) {
          const text = await fetchJson(u).catch(() => null);
          if (text) for (const i of w.radioItems(text, sid)) if (!seen.has(i.id)) (seen.add(i.id), vod.push(i));
        }
        if (!vod.length) throw new Error("Annuaire des radios injoignable.");
        return { channels: [], epgUrls: [], vod };
      }
      case "podcasts": {
        const seen = new Set<string>();
        const vod: VodItem[] = [];
        for (const c of source.countries.slice(0, 6)) {
          const chart = await fetchJson(w.podcastChartUrl(c, 200)).catch(() => null);
          if (!chart) continue;
          const ids = w.podcastChartIds(chart);
          for (let i = 0; i < ids.length; i += 100) {
            const text = await fetchJson(w.podcastLookupUrl(ids.slice(i, i + 100), c)).catch(() => null);
            if (text) for (const it of w.podcastItems(text, sid, c)) if (!seen.has(it.id)) (seen.add(it.id), vod.push(it));
          }
        }
        return { channels: [], epgUrls: [], vod };
      }
      case "jellyfin": {
        jellyfinUsers.set(sid, source.userId);
        const text = await fetchJson(w.jellyfinItemsUrl(source.server, source.userId), { Authorization: w.jellyfinAuthHeader(source.token) });
        return { channels: [], epgUrls: [], vod: w.jellyfinItems(text, sid, source.server, source.token) };
      }
    }
  }

  const vodCounts = (vod: VodItem[]) => {
    const n: Record<string, number> = {};
    for (const i of vod) if (i.kind) n[i.kind] = (n[i.kind] ?? 0) + 1;
    return n;
  };

  /** Fiches et réponses des API de métadonnées, gardées pour la session. */
  const details = new Map<string, VodDetail>();
  const metaCache = new Map<string, string>();
  async function metaJson(url: string, bearer?: string): Promise<string> {
    const hit = metaCache.get(url);
    if (hit) return hit;
    const text = await fetchJson(url, bearer ? { Authorization: `Bearer ${bearer.trim()}` } : undefined);
    if (metaCache.size > 500) metaCache.clear();
    metaCache.set(url, text);
    return text;
  }

  /** Fiche selon la source du contenu (épisodes, pistes, fichiers). */
  async function sourceDetail(item: VodItem): Promise<VodDetail> {
    const plan = w.detailPlan(item, jellyfinUsers.get(item.sourceId));
    const jf = item.sourceRef?.type === "jellyfin" ? { Authorization: w.jellyfinAuthHeader(item.sourceRef.token) } : undefined;
    switch (plan.kind) {
      case "xtream-series":
      case "xtream-movie":
      case "archive":
        return w.detailBuild(item, await fetchJson(plan.url!));
      case "jellyfin":
        return w.detailBuild(item, await fetchJson(plan.url!, jf), plan.episodesUrl ? await fetchJson(plan.episodesUrl, jf).catch(() => undefined) : undefined);
      case "rss": {
        const r = await fetch(plan.url!).catch(() => {
          throw new Error("Flux du podcast injoignable depuis le navigateur.");
        });
        return w.detailBuild(item, undefined, undefined, new Uint8Array(await r.arrayBuffer()));
      }
      default:
        return w.detailBuild(item);
    }
  }

  return {
    name: "web",
    diskTimeshift: false,
    async loadSource(source) {
      const pl = await fetchSource(source);
      loaded.set(source.id, pl.channels);
      w.setVod(source.id, pl.vod);
      return { channels: pl.channels, vodCounts: vodCounts(pl.vod), epgUrls: [...pl.epgUrls, ...source.epgUrls], risk: w.analyzeRisk(pl.channels), fetchedAt: now() };
    },
    async previewSource(source) {
      const pl = await fetchSource(source);
      // Les films et séries comptent dans l'analyse, comme dans l'application native.
      const asChannels = pl.vod.map((i) => ({ id: i.id, sourceId: i.sourceId, name: i.rawName || i.title, url: i.url ?? "", group: i.category }) as Channel);
      return { channels: [], vodCounts: vodCounts(pl.vod), epgUrls: pl.epgUrls, risk: w.analyzeRisk([...pl.channels, ...asChannels]), fetchedAt: now() };
    },
    async removeSource(id) {
      loaded.delete(id);
      w.setVod(id, []);
      jellyfinUsers.delete(id);
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
    async vodByTmdb(ids) {
      return w.vodByTmdb(ids);
    },
    async vodQuery(q) {
      return w.vodQuery(q);
    },
    async vodFacets(kind, prefs, adult) {
      return w.vodFacets(kind, prefs, adult);
    },
    async vodSearch(text, field, prefs, adult, perKind) {
      return w.vodSearch(text, field, prefs, adult, perKind);
    },
    async vodDetail(id, keys) {
      const cached = details.get(id);
      if (cached) return cached;
      const item = w.vodItem(id);
      if (!item) throw new Error("Contenu introuvable (source désactivée ?)");
      // Plusieurs sources pour ce contenu : si la première ne répond pas, la suivante prend le relais.
      let d: VodDetail | null = null;
      let firstError: unknown;
      for (const copy of [item, ...(item.alternates ?? [])]) {
        try {
          // Une source qui tarde ne bloque pas la fiche quand d'autres copies existent.
          d = item.alternates?.length
            ? await Promise.race([sourceDetail(copy), new Promise<never>((_, no) => setTimeout(() => no(new Error("La source ne répond pas.")), 8000))])
            : await sourceDetail(copy);
          if (copy !== item) d = { ...d, item: { ...item, url: d.item.url ?? item.url } };
          break;
        } catch (e) {
          firstError ??= e;
        }
      }
      if (!d) throw firstError instanceof Error ? firstError : new Error(String(firstError));
      const kind = item.kind;
      const lang = keys.language ?? "fr-FR";
      const tmdb = keys.tmdb?.trim();
      if (tmdb && (kind === "movie" || kind === "series" || kind === "show")) {
        const bearer = w.tmdbIsBearer(tmdb) ? tmdb : undefined;
        let tmdbId = d.item.tmdbId;
        if (!tmdbId) tmdbId = w.tmdbPick(await metaJson(w.tmdbSearchUrl(kind, d.item.title, d.item.year, tmdb, lang), bearer).catch(() => "{}"), d.item.title);
        if (tmdbId) {
          const text = await metaJson(w.tmdbDetailsUrl(kind, tmdbId, tmdb, lang), bearer).catch(() => null);
          if (text) d = w.tmdbApply(d, text);
        }
      }
      const omdb = keys.omdb?.trim();
      if (omdb && d.item.imdbId) {
        const text = await metaJson(w.omdbUrl(d.item.imdbId, omdb)).catch(() => null);
        if (text) d = w.omdbApply(d, text);
      }
      w.vodEnrich(item.id, d);
      if (details.size > 300) details.clear();
      details.set(id, d);
      return d;
    },
    async person(name, tmdbId, keys) {
      const items = w.vodWithPerson(name);
      const view: Awaited<ReturnType<Backend["person"]>> = { name, items, credits: [] };
      const tmdb = keys.tmdb?.trim();
      if (!tmdb) return view;
      const lang = keys.language ?? "fr-FR";
      const bearer = w.tmdbIsBearer(tmdb) ? tmdb : undefined;
      let pid = tmdbId;
      if (!pid) {
        const text = await metaJson(w.tmdbPersonSearchUrl(name, tmdb, lang), bearer).catch(() => null);
        pid = text ? (JSON.parse(text).results?.[0]?.id as number | undefined) : undefined;
      }
      if (!pid) return view;
      const text = await metaJson(w.tmdbPersonUrl(pid, tmdb, lang), bearer).catch(() => null);
      if (!text) return view;
      const info = w.tmdbPersonInfo(text);
      for (const c of info.credits) {
        const hit = w.vodMatchCredit(c.title, c.year, c.tmdbId, c.kind);
        if (hit && !items.some((i) => i.id === hit.id)) items.push(hit);
        view.credits.push({ ...c, availableId: hit?.id });
      }
      return { ...view, photo: info.photo, biography: info.biography, birthday: info.birthday, knownFor: info.knownFor, items };
    },
    async jellyfinLogin(server, username, password) {
      const base = server.trim().replace(/\/+$/, "");
      const r = await fetch(`${base}/Users/AuthenticateByName`, {
        method: "POST",
        headers: { Authorization: w.jellyfinAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ Username: username, Pw: password }),
      }).catch(() => {
        throw new Error("Serveur injoignable depuis le navigateur (vérifiez l'adresse et l'autorisation CORS du serveur).");
      });
      if (r.status === 401) throw new Error("Identifiant ou mot de passe incorrect.");
      if (!r.ok) throw new Error(`Le serveur a répondu ${r.status}`);
      const j = await r.json().catch(() => {
        throw new Error("Ce serveur ne semble pas être Jellyfin ou Emby.");
      });
      return { server: base, userId: j.User?.Id, token: j.AccessToken, serverName: j.ServerName ?? j.User?.ServerName };
    },
    // Enregistrement impossible depuis un navigateur ou une TV (pas d'accès disque).
    async recList() {
      return [];
    },
    async recSchedule() {
      throw new Error("L'enregistrement n'est disponible que sur l'application de bureau ou Android.");
    },
    async recCancel() {},
    async probeStream(s, timeoutMs) {
      // Le navigateur ne fixe ni User-Agent ni Referer : le test reflète ce que le lecteur obtiendra.
      // Pas d'en-tête Range (requête préliminaire CORS refusée par bien des serveurs) : seul le premier bloc est lu.
      const started = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(s.url, { signal: ctrl.signal, cache: "no-store" });
        if (!r.ok) return { ok: false, ms: performance.now() - started, error: `HTTP ${r.status}` };
        const reader = r.body?.getReader();
        const first = reader ? (await reader.read()).value : new Uint8Array(await r.arrayBuffer());
        reader?.cancel().catch(() => undefined);
        const ms = performance.now() - started;
        const playlist = (r.headers.get("content-type") ?? "").includes("mpegurl") || /\.m3u8($|\?)/i.test(s.url);
        if (!first?.length) return { ok: false, ms, error: "réponse vide" };
        if (playlist && !new TextDecoder().decode(first.slice(0, 512)).includes("#EXTM3U")) return { ok: false, ms, error: "réponse qui n'est pas une playlist" };
        return { ok: true, ms };
      } catch (e) {
        return { ok: false, ms: performance.now() - started, error: ctrl.signal.aborted ? "trop lent" : "inaccessible depuis le navigateur" };
      } finally {
        clearTimeout(timer);
      }
    },
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
