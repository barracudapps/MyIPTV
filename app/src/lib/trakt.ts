import { getBackend } from "../platform";
import { useSettings } from "../store/settings";
import { startTask } from "../store/activity";
import type { Episode, VodItem } from "../types";

/**
 * Synchronisation avec Trakt (trakt.tv) : connexion par code d'appareil (utilisable à la
 * télécommande), lecture signalée en direct (scrobble) et import de l'historique.
 * L'administrateur fournit l'identifiant d'une application Trakt (gratuite) : MyIPTV
 * étant libre, aucun secret ne peut être livré avec l'application.
 */
const API = "https://api.trakt.tv";
const REDIRECT = "urn:ietf:wg:oauth:2.0:oob";

export interface TraktSession {
  accessToken: string;
  refreshToken: string;
  /** Expiration du jeton (secondes Unix). */
  expiresAt: number;
  username?: string;
  /** Dernier import de l'historique (ms). */
  lastImport?: number;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

function app() {
  const { traktClientId, traktClientSecret } = useSettings.getState().meta;
  if (!traktClientId?.trim() || !traktClientSecret?.trim()) throw new Error("Renseignez d'abord l'identifiant et le secret de votre application Trakt.");
  return { id: traktClientId.trim(), secret: traktClientSecret.trim() };
}

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; data: T | null }> {
  const { id } = app();
  const r = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": id,
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, data: text ? (JSON.parse(text) as T) : null };
}

export async function startDeviceAuth(): Promise<DeviceCode> {
  const { id } = app();
  const r = await call<{ device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }>("/oauth/device/code", { body: { client_id: id } });
  if (r.status !== 200 || !r.data) throw new Error(`Trakt a refusé la demande (${r.status}) : vérifiez l'identifiant de l'application.`);
  return { deviceCode: r.data.device_code, userCode: r.data.user_code, verificationUrl: r.data.verification_url, expiresIn: r.data.expires_in, interval: r.data.interval };
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number; created_at: number };

const toSession = (t: TokenReply): TraktSession => ({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.created_at + t.expires_in });

/** Attend que l'utilisateur valide le code sur trakt.tv ; `cancelled` arrête l'attente. */
export async function waitForDevice(code: DeviceCode, cancelled: () => boolean): Promise<TraktSession> {
  const { id, secret } = app();
  const deadline = Date.now() + code.expiresIn * 1000;
  let interval = code.interval * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    if (cancelled()) throw new Error("Connexion annulée.");
    const r = await call<TokenReply>("/oauth/device/token", { body: { code: code.deviceCode, client_id: id, client_secret: secret } });
    if (r.status === 200 && r.data) {
      const session = toSession(r.data);
      const me = await call<{ user?: { username?: string } }>("/users/settings", { token: session.accessToken }).catch(() => null);
      return { ...session, username: me?.data?.user?.username };
    }
    if (r.status === 429) interval += 1000;
    else if (r.status === 404) throw new Error("Code invalide.");
    else if (r.status === 409) throw new Error("Ce code a déjà été utilisé.");
    else if (r.status === 410) throw new Error("Le code a expiré : recommencez.");
    else if (r.status === 418) throw new Error("Connexion refusée sur Trakt.");
  }
  throw new Error("Le code a expiré : recommencez.");
}

function activeSession(): { profileId: string; session: TraktSession } | null {
  const s = useSettings.getState();
  const p = s.profiles.find((x) => x.id === s.activeProfileId);
  return p?.trakt ? { profileId: p.id, session: p.trakt } : null;
}

/** Jeton valide du profil actif, renouvelé si besoin ; null sans connexion Trakt. */
async function token(): Promise<string | null> {
  const a = activeSession();
  if (!a) return null;
  if (a.session.expiresAt - Date.now() / 1000 > 3600) return a.session.accessToken;
  const { id, secret } = app();
  const r = await call<TokenReply>("/oauth/token", { body: { refresh_token: a.session.refreshToken, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: "refresh_token" } });
  if (r.status !== 200 || !r.data) {
    // Jeton révoqué : la connexion est à refaire.
    useSettings.getState().updateProfile(a.profileId, { trakt: undefined });
    return null;
  }
  const session = { ...a.session, ...toSession(r.data) };
  useSettings.getState().updateProfile(a.profileId, { trakt: session });
  return session.accessToken;
}

export async function disconnect() {
  const a = activeSession();
  if (!a) return;
  const { id, secret } = app();
  await call("/oauth/revoke", { body: { token: a.session.accessToken, client_id: id, client_secret: secret } }).catch(() => undefined);
  useSettings.getState().updateProfile(a.profileId, { trakt: undefined });
}

/** Corps Trakt d'un film ou d'un épisode ; null sans identifiant exploitable. */
function target(item: VodItem, episode?: Episode): Record<string, unknown> | null {
  const ids: Record<string, unknown> = {};
  if (item.tmdbId) ids.tmdb = item.tmdbId;
  if (item.imdbId) ids.imdb = item.imdbId;
  if (!Object.keys(ids).length) return null;
  if (item.kind === "movie") return { movie: { ids, title: item.title, year: item.year } };
  if (item.kind === "series" && episode) return { show: { ids, title: item.title }, episode: { season: episode.season, number: episode.episode } };
  return null;
}

/**
 * Lecture signalée à Trakt : `start`, `pause` ou `stop` avec la progression en %.
 * Au-delà de 80 % à l'arrêt, Trakt marque le contenu comme vu.
 */
export async function scrobble(action: "start" | "pause" | "stop", item: VodItem, episode: Episode | undefined, progress: number) {
  const body = target(item, episode);
  if (!body) return;
  const t = await token().catch(() => null);
  if (!t) return;
  await call(`/scrobble/${action}`, { body: { ...body, progress: Math.max(0, Math.min(100, progress)) }, token: t }).catch(() => undefined);
}

/**
 * Importe depuis Trakt les points de reprise et les contenus vus qui existent dans la
 * bibliothèque (reconnus par identifiant TMDB). Renvoie le nombre de contenus mis à jour.
 */
export async function importHistory(): Promise<number> {
  const t = await token();
  const a = activeSession();
  if (!t || !a) return 0;
  const task = startTask("Synchronisation Trakt");
  try {
    type Ids = { ids?: { tmdb?: number } };
    const [watched, playback] = await Promise.all([
      call<(Ids & { movie?: Ids })[]>("/sync/watched/movies", { token: t }),
      call<{ progress: number; type: string; movie?: Ids; show?: Ids; episode?: { season: number; number: number } }[]>("/sync/playback", { token: t }),
    ]);
    const watchedIds = new Set((watched.data ?? []).map((w) => w.movie?.ids?.tmdb).filter((x): x is number => !!x));
    const resume = new Map<number, { progress: number; episode?: { season: number; number: number } }>();
    for (const p of playback.data ?? []) {
      const id = (p.type === "movie" ? p.movie : p.show)?.ids?.tmdb;
      if (id) resume.set(id, { progress: p.progress, episode: p.episode });
    }
    const items = await (await getBackend()).vodByTmdb([...new Set([...watchedIds, ...resume.keys()])]);
    const s = useSettings.getState();
    const local = new Map((s.profiles.find((p) => p.id === a.profileId)?.history ?? []).map((h) => [h.itemId, h]));
    let n = 0;
    for (const item of items) {
      const id = item.tmdbId!;
      const prior = local.get(item.id);
      const duration = prior?.duration || item.duration || 0;
      const r = resume.get(id);
      if (watchedIds.has(id) && !prior?.finished && !r) {
        s.recordProgress({ itemId: item.id, kind: item.kind, title: item.title, poster: item.poster, position: duration, duration, finished: true });
        n++;
      } else if (r && duration > 0 && !prior?.episodeId) {
        // Reprise d'un film ; pour une série, l'épisode exact se retrouve à l'ouverture de la fiche.
        s.recordProgress({ itemId: item.id, kind: item.kind, title: item.title, poster: item.poster, position: (r.progress / 100) * duration, duration, finished: false });
        n++;
      }
    }
    useSettings.getState().updateProfile(a.profileId, { trakt: { ...a.session, ...(useSettings.getState().profiles.find((p) => p.id === a.profileId)?.trakt ?? {}), lastImport: Date.now() } });
    return n;
  } finally {
    task.end();
  }
}
