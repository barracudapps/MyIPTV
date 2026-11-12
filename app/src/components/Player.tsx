import { displayName } from "../lib/variants";
import { scrobble } from "../lib/trakt";
import { CastBar, CastDialog } from "./CastDialog";
import { BufferChoice, MEMORY_MAX_MINUTES } from "./BufferChoice";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type HlsType from "hls.js";
import { Hls, mpegts } from "../lib/engines";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { isTauri } from "../platform";
import { programmeAccess, DEFAULT_PLAYER_PREFS, type AspectMode, type AudioMode } from "../lib/parental";
import { current, fmtDuration, fmtTime, nowSec } from "../lib/util";
import { code639_1 } from "../lib/trackLang";
import { applyAudioMode, autoSelect, NO_TRACKS, PICTURE_PRESETS, readTracks, setAudio, setQuality, setSubtitle, videoStyle, type Tracks } from "../lib/media";
import { compactSupported, enterCompact, exitCompact, isCompact, onCompactChange, startDragging } from "../lib/miniWindow";
import { fun } from "../lib/fun";
import { sectionOf } from "../lib/sections";
import { Icon } from "./Icon";
import { ChannelLogo } from "./ChannelLogo";
import { MascotFigure } from "./Mascot";
import { useRecordings } from "../store/recordings";

type Engine = { destroy(): void; hls?: HlsType; playingDate?: () => Date | null };

interface Clock {
  playing: boolean;
  t: number;
  start: number;
  end: number;
  live: boolean;
  /** Heure murale (s) de la position de lecture. */
  wall: number;
  /** Données vidéo disponibles (sinon : chargement ou mise en mémoire tampon). */
  ready: boolean;
}

const MINI_W = 360;

function attach(video: HTMLVideoElement, url: string, kind: string, opts: { timeshift: boolean; live: boolean }, onFatal: (msg: string) => void, onTracks: () => void): Engine {
  const H = Hls;
  if (kind === "hls" && H?.isSupported()) {
    const hls = new H({
      liveSyncDurationCount: opts.timeshift ? 2 : 3,
      // Ne jamais ramener de force au direct : c'est l'utilisateur qui décide (pause du direct).
      liveMaxLatencyDurationCount: Infinity,
      // Sans enregistrement sur disque, le retour arrière vit dans la mémoire du lecteur.
      backBufferLength: opts.timeshift ? 120 : opts.live ? Math.min(useSettings.getState().playback.windowMinutes, MEMORY_MAX_MINUTES) * 60 : 600,
      maxBufferLength: 30,
      enableWorker: true,
      lowLatencyMode: false,
      renderTextTracksNatively: true,
    });
    let recovered = false;
    hls.on(H.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      // Playlist refusée ou absente : relancer ne sert à rien, on explique.
      const code = d.response?.code ?? 0;
      if (d.details.startsWith("manifest") || d.details.startsWith("level") || code >= 400) {
        onFatal(
          code === 0 && !isTauri && d.type === H.ErrorTypes.NETWORK_ERROR
            ? "Cette chaîne n'autorise pas la lecture depuis un navigateur. Elle fonctionne dans l'application de bureau ou sur TV."
            : code === 403 || code === 401
            ? "Accès refusé par la chaîne (restriction géographique ou d'accès probable)."
            : code === 404 || code === 410
              ? "Flux introuvable : la chaîne a peut-être changé d'adresse."
              : d.details === "manifestParsingError"
                ? "Cette adresse ne renvoie pas un flux vidéo."
                : "La chaîne ne répond pas.",
        );
        return;
      }
      if (d.type === H.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true;
        hls.recoverMediaError();
      } else if (d.type === H.ErrorTypes.NETWORK_ERROR && !recovered) {
        recovered = true;
        hls.startLoad();
      } else onFatal(d.details === "manifestLoadError" ? "La source ne répond pas." : `Lecture impossible (${d.details}).`);
    });
    hls.on(H.Events.ERROR, (_e, d) => {
      if (!d.fatal) console.info(`[lecteur] hls non bloquant : ${d.details}`);
    });
    for (const ev of [H.Events.MANIFEST_PARSED, H.Events.AUDIO_TRACKS_UPDATED, H.Events.SUBTITLE_TRACKS_UPDATED, H.Events.LEVEL_SWITCHED, H.Events.AUDIO_TRACK_SWITCHED, H.Events.SUBTITLE_TRACK_SWITCH])
      hls.on(ev, onTracks);
    hls.loadSource(url);
    hls.attachMedia(video);
    return { hls, destroy: () => hls.destroy(), playingDate: () => hls.playingDate };
  }
  if (kind === "mpegts" && mpegts?.getFeatureList().mseLivePlayback) {
    const p = mpegts.createPlayer({ type: "mpegts", isLive: opts.live, url }, { enableStashBuffer: !opts.live, lazyLoad: false, liveBufferLatencyChasing: false });
    p.on(mpegts.Events.ERROR, (_t: string, detail: string) => onFatal(`Lecture impossible (${detail}).`));
    p.attachMediaElement(video);
    p.load();
    return {
      destroy: () => {
        p.pause();
        p.unload();
        p.detachMediaElement();
        p.destroy();
      },
    };
  }
  video.src = url;
  // Vider la vidéo à la destruction déclenche aussi un événement « error » : seul celui
  // de la source courante compte, et l'écouteur est retiré avec le moteur.
  const onError = () => {
    if (video.getAttribute("src") !== url) return;
    onFatal(video.error?.code === 4 ? "Flux illisible : l'adresse ne mène pas à une vidéo ou son format n'est pas pris en charge." : `Lecture impossible (erreur ${video.error?.code ?? "?"}).`);
  };
  video.addEventListener("error", onError);
  video.addEventListener("loadedmetadata", onTracks, { once: true });
  return {
    destroy: () => {
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onTracks);
      video.removeAttribute("src");
      video.load();
    },
  };
}

/** Ouvre une adresse dans le navigateur du système (application) ou un nouvel onglet (web). */
async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url).catch((e) => console.warn(`[lecteur] ouverture impossible : ${e}`));
  } else window.open(url, "_blank", "noopener");
}

/** Le contenu en cours est-il purement audio (radio, podcast…) ? */
function isAudioOnly() {
  const k = usePlayer.getState().media?.item.kind;
  return k === "radio" || k === "music" || k === "podcast" || k === "audiobook";
}

type Panel = null | "audio" | "subtitles" | "quality" | "picture" | "sound" | "speed" | "buffer" | "sources";

export function Player() {
  const { channel, media, info, catchup, loading, error, mode, setMode, stop, retry, zap, nextEpisode, streams, streamIndex, probing } = usePlayer();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const profile = useActiveProfile();
  const prefs = profile?.player ?? DEFAULT_PLAYER_PREFS;
  const autoMini = useSettings((s) => s.playback.autoMiniPlayer);
  const prefsTimeshift = useSettings((s) => s.playback.timeshift);
  const source = usePlayer((s) => s.source);
  const [castOpen, setCastOpen] = useState(false);
  const sources = useSettings((s) => s.sources);
  const sourceNames = useMemo(() => new Map(sources.map((x) => [x.id, x.name])), [sources]);
  const autoNext = useSettings((s) => s.playback.autoNext);
  const mascotOn = useSettings((s) => s.fun.mascot);
  const mascotColor = useSettings((s) => s.fun.mascotColor);
  const mascotKind = useSettings((s) => s.fun.mascotKind);
  const programmes = useLibrary((s) => (channel ? s.programmes[channel.id] : undefined));
  const ensureProgrammes = useLibrary((s) => s.ensureProgrammes);

  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [clock, setClock] = useState<Clock>({ playing: false, t: 0, start: 0, end: 0, live: true, wall: nowSec(), ready: false });
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [compact, setCompact] = useState(isCompact());
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [miniPos, setMiniPos] = useState({ right: 16, bottom: 16 });
  const [tracks, setTracks] = useState<Tracks>(NO_TRACKS);
  const [panel, setPanel] = useState<Panel>(null);
  const [nextIn, setNextIn] = useState<number | null>(null);
  /** Conversion à la volée : position de départ du flux en cours et piste audio. */
  const remuxRef = useRef({ offset: 0, audio: 0 });
  const [remuxAudio, setRemuxAudio] = useState(0);
  const isRemux = info?.kind === "remux";
  /** Un seul repli automatique sur ffmpeg par contenu. */
  const triedRemux = useRef(false);
  useEffect(() => {
    triedRemux.current = false;
    setEngineError(null);
  }, [channel?.id, media?.item.id, media?.episode?.id, catchup?.start]);

  const active = channel != null || media != null;
  const isAudio = media != null && ["radio", "music", "podcast", "audiobook"].includes(media.item.kind ?? "");
  const isLiveStream = channel != null ? !catchup : !!media?.item.live;

  useEffect(() => onCompactChange(setCompact), []);

  // Le lecteur reste monté en permanence : la vidéo continue quand on change d'écran.
  const slotView = view === "live" || view === "favorites";
  const wantsDocked = mode === "docked" && slotView && channel != null;
  // Film, épisode, émission : pas d'emplacement dans un écran, le grand lecteur occupe la zone principale.
  const wantsTheater = mode === "docked" && channel == null && media != null && !isAudio;
  const effective = !active || mode === "hidden" ? "hidden" : compact ? "compact" : wantsTheater ? "theater" : wantsDocked ? "docked" : mode === "docked" && !autoMini ? "hidden-keep" : "mini";

  // Télécommande : en grand lecteur, le focus part des commandes (OK = lecture / pause).
  useEffect(() => {
    if (effective !== "theater") return;
    const t = setTimeout(() => boxRef.current?.querySelector<HTMLElement>(".player-controls .icon-btn.big")?.focus(), 50);
    return () => clearTimeout(t);
  }, [effective]);

  // Changer d'écran depuis la navigation réduit le grand lecteur sans couper la lecture.
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    if (usePlayer.getState().mode === "docked" && usePlayer.getState().channel == null) setMode("mini");
  }, [view, setMode]);

  useLayoutEffect(() => {
    if (effective !== "docked" && effective !== "theater") return;
    let raf = 0;
    const update = () => {
      const slot = effective === "theater" ? document.querySelector("main.main") : document.getElementById("player-slot");
      const r = slot?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [effective]);

  const refreshTracks = useCallback(() => {
    const v = videoRef.current;
    if (v) setTracks(readTracks(v, engineRef.current?.hls ?? null));
  }, []);

  // Moteur de lecture.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !info || info.kind === "youtube" || info.kind === "webpage") return;
    setEngineError(null);
    // Erreurs d'un moteur déjà remplacé : ignorées.
    let alive = true;
    let failed = false;
    // Échec d'un fichier (film, épisode, replay) : une tentative via ffmpeg avant d'afficher l'erreur.
    // Pas pour un direct : le format y est déjà détecté et l'analyse ffmpeg ferait attendre longtemps.
    const onFatal = (msg: string) => {
      if (!alive || failed) return;
      failed = true;
      console.warn(`[lecteur] échec ${info.kind} : ${msg}`);
      const st = usePlayer.getState();
      const isFile = st.media != null || st.catchup != null;
      if (isFile && !triedRemux.current && info.kind !== "remux" && !info.timeshift) {
        triedRemux.current = true;
        usePlayer.getState().retry(true);
      } else if (st.tryNextStream(msg)) {
        // Plusieurs sources : une autre copie prend le relais.
      } else setEngineError(msg);
    };
    setTracks(NO_TRACKS);
    setPanel(null);
    setNextIn(null);
    // Le proxy local autorise CORS : nécessaire pour brancher le traitement du son.
    if (isTauri) video.crossOrigin = "anonymous";
    let autoDone = false;
    const onTracks = () => {
      refreshTracks();
      const p = useSettings.getState().profiles.find((x) => x.id === useSettings.getState().activeProfileId);
      if (!autoDone && p?.player.autoTracks) {
        autoDone = true;
        autoSelect(video, engineRef.current?.hls ?? null, p.languages, p.player.subtitlesByDefault);
        refreshTracks();
      }
    };
    const resumeAt = usePlayer.getState().media?.resumeAt ?? 0;
    let engine: Engine;
    if (info.kind === "remux") {
      // Piste audio initiale choisie selon les langues favorites ; la reprise démarre directement au bon endroit.
      const p = useSettings.getState().profiles.find((x) => x.id === useSettings.getState().activeProfileId);
      const tracks = info.audioTracks ?? [];
      const rank = (l?: string) => {
        const i = p?.languages.indexOf(code639_1(l) ?? "") ?? -1;
        return i < 0 ? 99 : i;
      };
      const audio = p?.player.autoTracks && tracks.length ? [...tracks].sort((a, b) => rank(a.language) - rank(b.language))[0].index : 0;
      remuxRef.current = { offset: resumeAt > 5 ? resumeAt : 0, audio };
      setRemuxAudio(audio);
      engine = attach(video, `${info.url}?start=${remuxRef.current.offset}&audio=${audio}`, info.remuxFormat === "mpegts" ? "mpegts" : "native", { timeshift: false, live: info.duration == null }, onFatal, onTracks);
      console.info(`[lecteur] conversion ${info.remuxFormat} depuis ${remuxRef.current.offset}s`);
    } else {
      console.info(`[lecteur] ${info.kind}${info.timeshift ? " (timeshift)" : ""} ${info.url.slice(0, 120)}`);
      engine = attach(video, info.url, info.kind, { timeshift: info.timeshift, live: isLiveStream }, onFatal, onTracks);
      // Lecteur natif : l'erreur arrive par l'élément vidéo.
      if (resumeAt > 5) video.addEventListener("loadedmetadata", () => (video.currentTime = resumeAt), { once: true });
    }
    engineRef.current = engine;
    // Chien de garde : aucune donnée après 25 s, la source ne répond pas (évite un chargement sans fin).
    const watchdog = window.setTimeout(() => {
      if (alive && video.readyState === 0 && !isAudioOnly()) onFatal("La chaîne ne répond pas (aucune donnée reçue).");
    }, 25_000);
    video.playbackRate = 1;
    setSpeed(1);
    video.play().catch(() => {
      // Lecture automatique refusée (son) : on relance en muet.
      video.muted = true;
      setMuted(true);
      video.play().catch(() => undefined);
    });
    return () => {
      alive = false;
      clearTimeout(watchdog);
      // La conversion peut avoir remplacé le moteur (déplacement, piste audio).
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [info]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (channel) ensureProgrammes([channel], nowSec() - 3 * 3600, nowSec() + 6 * 3600);
  }, [channel, ensureProgrammes]);

  useEffect(() => {
    if (!active) fun.onStop();
  }, [active]);

  // Horloge de lecture (position, fenêtre enregistrée, heure murale).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tick = () => {
      if (info?.kind === "remux") {
        setClock({ playing: !video.paused, t: remuxRef.current.offset + video.currentTime, start: 0, end: info.duration ?? 0, live: false, wall: nowSec(), ready: video.readyState >= 2 });
        return;
      }
      const s = video.seekable;
      const start = s.length ? s.start(0) : 0;
      const end = s.length ? s.end(s.length - 1) : video.duration || 0;
      const pd = engineRef.current?.playingDate?.();
      const wall = catchup ? catchup.start + video.currentTime : pd ? pd.getTime() / 1000 : nowSec() - Math.max(0, end - video.currentTime);
      setClock({ playing: !video.paused, t: video.currentTime, start, end: Number.isFinite(end) ? end : 0, live: isLiveStream, wall, ready: video.readyState >= 2 });
    };
    const id = setInterval(tick, 500);
    const events = ["play", "pause", "waiting", "playing", "canplay", "loadeddata"];
    for (const ev of events) video.addEventListener(ev, tick);
    return () => {
      clearInterval(id);
      for (const ev of events) video.removeEventListener(ev, tick);
    };
  }, [info, catchup, isLiveStream]);

  // Historique et reprise : position enregistrée toutes les 5 s et à la fin.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !media || media.item.live) return;
    const save = (finished = false) => {
      const remuxed = usePlayer.getState().info?.kind === "remux";
      const d = remuxed ? usePlayer.getState().info?.duration ?? 0 : video.duration;
      const pos = remuxed ? remuxRef.current.offset + video.currentTime : video.currentTime;
      if (!Number.isFinite(d) || d <= 0 || (!finished && pos < 5)) return;
      const ep = media.episode;
      useSettings.getState().recordProgress({
        itemId: media.item.id,
        kind: media.item.kind,
        title: media.item.title,
        poster: media.item.poster,
        episodeId: ep?.id,
        episodeLabel: ep ? (ep.season > 1 || media.queue.some((e) => e.season > 1) ? `S${ep.season}E${ep.episode}` : `${sectionOf(media.item.kind).unit} ${ep.episode}`) : undefined,
        position: finished ? d : pos,
        duration: d,
        finished: finished || pos / d > 0.95,
      });
    };
    // Trakt : lecture signalée en direct (sans effet si le profil n'est pas connecté).
    const progress = () => {
      const remuxed = usePlayer.getState().info?.kind === "remux";
      const d = remuxed ? usePlayer.getState().info?.duration ?? 0 : video.duration;
      const pos = remuxed ? remuxRef.current.offset + video.currentTime : video.currentTime;
      return Number.isFinite(d) && d > 0 ? (pos / d) * 100 : 0;
    };
    const traktOn = !!useSettings.getState().profiles.find((p) => p.id === useSettings.getState().activeProfileId)?.trakt;
    let stopped = false;
    const onPlaying = () => traktOn && void scrobble("start", media.item, media.episode, progress());
    const id = setInterval(() => !video.paused && save(), 5000);
    const onPause = () => {
      save();
      if (traktOn && !video.ended) void scrobble("pause", media.item, media.episode, progress());
    };
    const onEnded = () => {
      save(true);
      if (traktOn && !stopped) (stopped = true), void scrobble("stop", media.item, media.episode, 100);
      if (autoNext && media.queue.length) setNextIn(8);
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      clearInterval(id);
      if (traktOn && !stopped && progress() > 1) void scrobble(progress() >= 80 ? "stop" : "pause", media.item, media.episode, progress());
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      save();
    };
  }, [media, autoNext]);

  // Compte à rebours de l'épisode suivant.
  useEffect(() => {
    if (nextIn == null) return;
    if (nextIn <= 0) {
      setNextIn(null);
      nextEpisode();
      return;
    }
    const t = setTimeout(() => setNextIn(nextIn - 1), 1000);
    return () => clearTimeout(t);
  }, [nextIn, nextEpisode]);

  const playingProg = useMemo(() => (catchup ? catchup : channel ? current(programmes, Math.floor(clock.wall)).now : undefined), [catchup, channel, programmes, clock.wall]);
  const access = profile && channel ? programmeAccess(profile, channel, playingProg) : { ok: true as const };
  const blocked = !access.ok;

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted || blocked;
  }, [muted, blocked]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    const v = videoRef.current;
    if (v && info) applyAudioMode(v, prefs.audioMode);
  }, [prefs.audioMode, info]);

  // Masquage automatique des contrôles.
  const hideTimer = useRef<number>();
  const poke = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3500);
  }, []);
  useEffect(() => poke(), [channel, media, poke]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  /** Flux converti : on relance la conversion à la position voulue. */
  const remuxLoad = (offset: number, audio = remuxRef.current.audio) => {
    const v = videoRef.current;
    if (!v || !info) return;
    const target = Math.max(0, Math.min(offset, (info.duration ?? offset + 1) - 2));
    remuxRef.current = { offset: target, audio };
    setRemuxAudio(audio);
    engineRef.current?.destroy();
    engineRef.current = attach(v, `${info.url}?start=${target.toFixed(1)}&audio=${audio}`, info.remuxFormat === "mpegts" ? "mpegts" : "native", { timeshift: false, live: false }, setEngineError, refreshTracks);
    v.play().catch(() => undefined);
  };
  const seekTo = (pos: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (isRemux) remuxLoad(pos);
    else v.currentTime = pos;
  };
  const seekBy = (d: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (isRemux) {
      remuxLoad(clock.t + d);
      poke();
      return;
    }
    const max = isLiveStream ? clock.end - 1 : v.duration || clock.end;
    v.currentTime = Math.min(Math.max(clock.start, v.currentTime + d), max);
    poke();
  };
  const goLive = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(clock.start, clock.end - 6);
    v.play();
  };
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
    poke();
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else boxRef.current?.requestFullscreen?.().catch(() => undefined);
  };
  const startOver = () => {
    if (!playingProg) return;
    seekBy(-(clock.wall - playingProg.start));
  };
  const floating = () => {
    if (compactSupported) {
      if (isCompact()) exitCompact();
      else {
        if (document.fullscreenElement) document.exitFullscreen();
        enterCompact();
      }
      return;
    }
    const v = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
    v?.requestPictureInPicture?.().catch(() => undefined);
  };
  const setPref = (patch: Partial<typeof prefs>) => useSettings.getState().setPlayerPrefs(patch);

  // Raccourcis clavier / télécommande.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      const inPlayer = fullscreen || compact || boxRef.current?.contains(t);
      switch (e.key) {
        case "ChannelUp":
        case "PageUp":
          zap(-1);
          break;
        case "ChannelDown":
        case "PageDown":
          zap(1);
          break;
        case "MediaPlayPause":
          togglePlay();
          break;
        case "MediaPlay":
          videoRef.current?.play();
          break;
        case "MediaPause":
          videoRef.current?.pause();
          break;
        case "MediaFastForward":
        case "MediaRewind":
          if (!seekable) return;
          seekBy(e.key === "MediaRewind" ? -30 : 30);
          break;
        case "MediaStop":
          if (compact) exitCompact();
          stop();
          break;
        case " ":
          if (!inPlayer || t.tagName === "BUTTON") return;
          togglePlay();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          setMuted((m) => !m);
          break;
        case "ArrowLeft":
        case "ArrowRight":
          if (!fullscreen && !compact) return;
          seekBy(e.key === "ArrowLeft" ? -10 : 10);
          break;
        case "ArrowUp":
        case "ArrowDown":
          if (!fullscreen || !channel) return;
          zap(e.key === "ArrowUp" ? -1 : 1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!active) return null;

  const behind = Math.max(0, clock.end - clock.t);
  const atLive = behind < 15;
  const span = Math.max(1, clock.end - clock.start);
  const seekable = catchup || (media && !media.item.live) ? clock.end > 0 : span > 30;
  const isMini = effective === "mini";
  const hiddenKeep = effective === "hidden-keep";
  const small = isMini || compact;
  const title = channel ? displayName(channel) : media!.item.title;
  const subtitle = media?.episode ? media.episode.title || `${sectionOf(media.item.kind).unit} ${media.episode.episode}` : playingProg ? playingProg.title : media?.item.year ? String(media.item.year) : undefined;

  const style: React.CSSProperties = compact
    ? { position: "fixed", inset: 0, zIndex: 100, borderRadius: 0 }
    : isMini
      ? { position: "fixed", right: miniPos.right, bottom: miniPos.bottom, width: MINI_W, height: (MINI_W * 9) / 16, zIndex: 50 }
      : (effective === "docked" || effective === "theater") && rect
        ? { position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: effective === "theater" ? 66 : 5, borderRadius: effective === "theater" ? 0 : undefined }
        : { position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: -10, top: -10 };

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, .seekbar, .player-panel")) return;
    if (compact) {
      startDragging();
      return;
    }
    if (!isMini) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = miniPos;
    const move = (ev: PointerEvent) =>
      setMiniPos({
        right: Math.min(Math.max(8, start.right - (ev.clientX - sx)), innerWidth - MINI_W - 8),
        bottom: Math.min(Math.max(8, start.bottom - (ev.clientY - sy)), innerHeight - 120),
      });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const shownError = error ?? engineError;
  const expand = () => {
    if (compact) exitCompact();
    setMode("docked");
    useUi.setState({ detailId: null, person: null });
    if (channel) setView("live");
  };

  return (
    <div
      ref={boxRef}
      className={`player ${isMini ? "player-mini" : ""} ${compact ? "player-compact" : ""} ${controlsVisible || !clock.playing ? "show-controls" : ""} ${fullscreen ? "is-fs" : ""}`}
      style={fullscreen ? undefined : style}
      onPointerMove={poke}
      onPointerDown={startDrag}
      onFocusCapture={poke}
      aria-hidden={hiddenKeep}
      data-own-arrows={fullscreen || compact ? "" : undefined}
      data-player-scope={effective === "theater" && !fullscreen ? "" : undefined}
    >
      <div className="video-wrap">
        <video
          ref={videoRef}
          playsInline
          className={blocked ? "video-blocked" : ""}
          style={videoStyle(prefs.aspect, prefs.brightness, prefs.contrast, prefs.saturation)}
          onDoubleClick={compact ? expand : toggleFullscreen}
          onClick={small ? undefined : togglePlay}
        />
      </div>

      {info?.kind === "webpage" && (
        <div className="youtube-wrap">
          <div className="player-center">
            <Icon name="globe" size={small ? 24 : 40} />
            {!small && <span>Cette chaîne diffuse son direct sur son propre site.</span>}
            <button className="btn btn-primary" onClick={() => openExternal(info.url)}>
              Ouvrir le direct sur le site de la chaîne
            </button>
          </div>
        </div>
      )}
      {info?.kind === "youtube" && (
        <div className="youtube-wrap">
          {info.url.includes("/embed/") ? (
            <iframe src={info.url} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : info.url.includes("/embed?u=") ? (
            <iframe src={info.url} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
          ) : (
            <div className="player-center">
              <Icon name="live" size={40} />
              <span>Ce direct est diffusé sur une plateforme vidéo.</span>
              <button className="btn btn-primary" onClick={() => openExternal(info.url)}>
                Ouvrir le direct
              </button>
            </div>
          )}
        </div>
      )}

      {isAudio && (
        <div className="audio-visual">
          {media!.item.poster ? <img src={media!.item.poster} alt="" /> : mascotOn ? <MascotFigure mood={clock.playing ? "dance" : "idle"} color={mascotColor} kind={mascotKind} size={small ? 60 : 120} /> : <Icon name={sectionOf(media!.item.kind).icon} size={64} />}
          {!small && (
            <div>
              <strong>{media!.item.title}</strong>
              {subtitle && <span>{subtitle}</span>}
            </div>
          )}
          {clock.playing && (
            <div className="eq" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      )}

      {!shownError && info?.kind !== "youtube" && info?.kind !== "webpage" && !isAudio && (loading || !clock.ready) && !blocked && (
        <div className="player-center">
          <div className="spinner" />
          {!small && <span>{probing ? `Test de ${streams.length} sources…` : info?.timeshift ? "Préparation du direct…" : streams.length > 1 ? `Connexion (source ${streamIndex + 1}/${streams.length})…` : "Connexion…"}</span>}
        </div>
      )}

      {blocked && !access.ok && access.reason === "blocked" && (
        <div className="player-center player-blocked">
          <Icon name="shield" size={small ? 24 : 48} />
          <strong>Programme non adapté</strong>
          {!small && <span>{access.message}</span>}
        </div>
      )}

      {shownError && (
        <div className="player-center player-error">
          <Icon name="alert" size={small ? 22 : 40} />
          <span>{shownError}</span>
          <button className="btn" onClick={() => retry(isRemux)}>
            Réessayer
          </button>
        </div>
      )}

      {!small && <CastBar />}
      {castOpen && <CastDialog video={videoRef.current} onClose={() => setCastOpen(false)} />}

      {nextIn != null && (
        <div className="next-up">
          <span>Épisode suivant dans {nextIn} s</span>
          <button className="btn btn-primary" onClick={() => (setNextIn(null), nextEpisode())}>
            Lancer
          </button>
          <button className="btn" onClick={() => setNextIn(null)}>
            Annuler
          </button>
        </div>
      )}

      <div className="player-top">
        {channel ? <ChannelLogo channel={channel} size={small ? 24 : 36} /> : null}
        <div className="player-title">
          <strong>{title}</strong>
          {subtitle && !small && (
            <span>
              {subtitle}
              {playingProg?.age ? <em className="age">-{playingProg.age}</em> : null}
              {playingProg && !media ? ` · ${fmtTime(playingProg.start)}–${fmtTime(playingProg.stop)}` : ""}
            </span>
          )}
        </div>
        {channel && (info?.kind === "youtube" || info?.kind === "webpage") && !small && (
          <button className="btn btn-ghost" onClick={() => openExternal(channel.url)} title="Ouvrir le direct officiel dans le navigateur">
            <Icon name="globe" size={16} /> Ouvrir dans le navigateur
          </button>
        )}
        {catchup ? (
          <span className="badge">REPLAY</span>
        ) : isLiveStream && atLive ? (
          <span className="badge live">DIRECT</span>
        ) : isLiveStream ? (
          <span className="badge">-{fmtDuration(behind)}</span>
        ) : null}
        {small ? (
          <>
            {small && (
              <button className="icon-btn" title={clock.playing ? "Pause" : "Lecture"} onClick={togglePlay}>
                <Icon name={clock.playing ? "pause" : "play"} />
              </button>
            )}
            <button className="icon-btn" title="Agrandir" onClick={expand}>
              <Icon name="expand" />
            </button>
            <button className="icon-btn" title="Fermer" onClick={() => (compact && exitCompact(), stop())}>
              <Icon name="close" />
            </button>
          </>
        ) : (
          <button className="icon-btn" title="Réduire dans l'application" onClick={() => setMode("mini")}>
            <Icon name="shrink" />
          </button>
        )}
      </div>

      {!small && (
        <div className="player-controls">
          {seekable && (
            <div
              className="seekbar"
              role="slider"
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={span}
              aria-valuenow={clock.t - clock.start}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seekTo(clock.start + ((e.clientX - r.left) / r.width) * span);
              }}
            >
              <div className="seekbar-fill" style={{ width: `${((clock.t - clock.start) / span) * 100}%` }} />
              {channel && !catchup && playingProg && playingProg.start > clock.wall - (clock.t - clock.start) && (
                <div className="seekbar-mark" title="Début du programme" style={{ left: `${((clock.t - clock.start - (clock.wall - playingProg.start)) / span) * 100}%` }} />
              )}
            </div>
          )}
          <div className="controls-row">
            {channel && (
              <button className="icon-btn" title="Chaîne précédente" onClick={() => zap(-1)} disabled={!!catchup}>
                <Icon name="prev" />
              </button>
            )}
            {seekable && (
              <button className="icon-btn" title="Reculer de 10 s" onClick={() => seekBy(-10)}>
                <Icon name="back30" />
              </button>
            )}
            <button className="icon-btn big" title={clock.playing ? "Pause" : "Lecture"} onClick={togglePlay}>
              <Icon name={clock.playing ? "pause" : "play"} />
            </button>
            {seekable && (
              <button className="icon-btn" title="Avancer de 30 s" onClick={() => seekBy(30)} disabled={isLiveStream && !catchup && atLive}>
                <Icon name="fwd30" />
              </button>
            )}
            {channel ? (
              <button className="icon-btn" title="Chaîne suivante" onClick={() => zap(1)} disabled={!!catchup}>
                <Icon name="next" />
              </button>
            ) : media?.queue.length ? (
              <button className="icon-btn" title="Suivant" onClick={() => nextEpisode()}>
                <Icon name="next" />
              </button>
            ) : null}
            {channel && !catchup && <RecButton channel={channel} prog={playingProg} />}
            {channel && !catchup && seekable && !atLive && (
              <button className="btn btn-live" onClick={goLive}>
                Revenir au direct
              </button>
            )}
            {channel && !catchup && seekable && playingProg && clock.wall - playingProg.start > 60 && clock.wall - playingProg.start < span && (
              <button className="btn" onClick={startOver} title="Reprendre au début du programme">
                <Icon name="restart" size={16} /> Début
              </button>
            )}
            <span className="time">
              {channel && !catchup
                ? `${fmtTime(Math.floor(clock.wall))}${seekable ? ` · tampon ${fmtDuration(span)}` : ""}`
                : seekable
                  ? `${fmtDuration(clock.t)} / ${fmtDuration(clock.end)}`
                  : ""}
            </span>
            <div className="spacer" />
            <button className="icon-btn" title={muted ? "Rétablir le son" : "Couper le son"} onClick={() => setMuted(!muted)}>
              <Icon name={muted ? "mute" : "volume"} />
            </button>
            <input className="volume" type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(+e.target.value)} aria-label="Volume" />
            {tracks.subtitles.length > 0 && (
              <button className={`icon-btn ${tracks.subtitleCurrent >= 0 ? "active" : ""}`} title="Sous-titres" onClick={() => setPanel(panel === "subtitles" ? null : "subtitles")}>
                <Icon name="subtitles" />
              </button>
            )}
            <button className={`icon-btn ${panel ? "active" : ""}`} title="Réglages de lecture" onClick={() => setPanel(panel ? null : tracks.audio.length > 1 || (info?.audioTracks?.length ?? 0) > 1 ? "audio" : tracks.qualities.length > 1 ? "quality" : "picture")}>
              <Icon name="sliders" />
            </button>
            {source && (
              <button className="icon-btn" title="Diffuser sur un autre écran (téléviseur, Chromecast…)" onClick={() => setCastOpen(true)}>
                <Icon name="cast" />
              </button>
            )}
            <button className="icon-btn" title={compactSupported ? "Mini-lecteur flottant (au-dessus de toutes les fenêtres)" : "Image dans l'image"} onClick={floating}>
              <Icon name="pip" />
            </button>
            <button className="icon-btn" title="Plein écran (F)" onClick={toggleFullscreen}>
              <Icon name={fullscreen ? "shrink" : "expand"} />
            </button>
          </div>
        </div>
      )}

      {panel && !small && (
        <div className="player-panel" role="dialog" aria-label="Réglages de lecture">
          <div className="panel-tabs">
            {(
              [
                ["audio", "Audio", tracks.audio.length > 1 || (isRemux && (info?.audioTracks?.length ?? 0) > 1)],
                ["subtitles", "Sous-titres", tracks.subtitles.length > 0],
                ["quality", "Qualité", tracks.qualities.length > 1],
                ["picture", "Image", true],
                ["sound", "Son", true],
                ["speed", "Vitesse", !isLiveStream],
                ["buffer", "Pause du direct", channel != null && !catchup && prefsTimeshift],
                ["sources", `Sources (${streams.length})`, !catchup && !media?.episode && streams.length > 1],
              ] as [Panel, string, boolean][]
            )
              .filter(([, , shown]) => shown)
              .map(([id, label]) => (
                <button key={id} className={panel === id ? "active" : ""} onClick={() => setPanel(id)}>
                  {label}
                </button>
              ))}
            <button className="icon-btn" onClick={() => setPanel(null)} title="Fermer">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="panel-body">
            {panel === "audio" &&
              isRemux &&
              info?.audioTracks?.map((t) => (
                <button key={t.index} className={`opt ${remuxAudio === t.index ? "on" : ""}`} onClick={() => remuxLoad(clock.t, t.index)}>
                  {t.title ?? (t.language ? t.language.toUpperCase() : `Piste ${t.index + 1}`)}
                  <span className="dim">
                    {[t.language?.toUpperCase(), t.codec.toUpperCase(), t.channels ? (t.channels >= 6 ? "5.1" : t.channels === 2 ? "stéréo" : `${t.channels} canaux`) : ""].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            {panel === "audio" &&
              !isRemux &&
              tracks.audio.map((t) => (
                <button key={t.id} className={`opt ${tracks.audioCurrent === t.id ? "on" : ""}`} onClick={() => (setAudio(videoRef.current!, engineRef.current?.hls ?? null, t.id), refreshTracks())}>
                  {t.label}
                </button>
              ))}
            {panel === "subtitles" && (
              <>
                <button className={`opt ${tracks.subtitleCurrent < 0 ? "on" : ""}`} onClick={() => (setSubtitle(videoRef.current!, engineRef.current?.hls ?? null, -1), refreshTracks())}>
                  Désactivés
                </button>
                {tracks.subtitles.map((t) => (
                  <button key={t.id} className={`opt ${tracks.subtitleCurrent === t.id ? "on" : ""}`} onClick={() => (setSubtitle(videoRef.current!, engineRef.current?.hls ?? null, t.id), refreshTracks())}>
                    {t.label}
                  </button>
                ))}
              </>
            )}
            {panel === "quality" && (
              <>
                <button className={`opt ${tracks.qualityCurrent < 0 ? "on" : ""}`} onClick={() => (setQuality(engineRef.current?.hls ?? null, -1), refreshTracks())}>
                  Automatique
                </button>
                {[...tracks.qualities].reverse().map((t) => (
                  <button key={t.id} className={`opt ${tracks.qualityCurrent === t.id ? "on" : ""}`} onClick={() => (setQuality(engineRef.current?.hls ?? null, t.id), refreshTracks())}>
                    {t.label}
                  </button>
                ))}
              </>
            )}
            {panel === "picture" && (
              <>
                <div className="opt-group">
                  <span>Format</span>
                  {(
                    [
                      ["contain", "Adapter"],
                      ["cover", "Remplir (zoom)"],
                      ["fill", "Étirer"],
                      ["16:9", "16:9"],
                      ["4:3", "4:3"],
                      ["21:9", "21:9"],
                    ] as [AspectMode, string][]
                  ).map(([a, l]) => (
                    <button key={a} className={`opt small ${prefs.aspect === a ? "on" : ""}`} onClick={() => setPref({ aspect: a })}>
                      {l}
                    </button>
                  ))}
                </div>
                <div className="opt-group">
                  <span>Préréglage</span>
                  {PICTURE_PRESETS.map((p) => (
                    <button key={p.id} className={`opt small ${prefs.brightness === p.brightness && prefs.contrast === p.contrast && prefs.saturation === p.saturation ? "on" : ""}`} onClick={() => setPref({ brightness: p.brightness, contrast: p.contrast, saturation: p.saturation })}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {(
                  [
                    ["brightness", "Luminosité"],
                    ["contrast", "Contraste"],
                    ["saturation", "Couleurs"],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="slider-row">
                    {l}
                    <input type="range" min={0.5} max={1.6} step={0.05} value={prefs[k]} onChange={(e) => setPref({ [k]: +e.target.value })} />
                    <output>{Math.round(prefs[k] * 100)} %</output>
                  </label>
                ))}
              </>
            )}
            {panel === "sound" &&
              (
                [
                  ["normal", "Normal", "Son d'origine"],
                  ["night", "Nuit", "Écarts de volume réduits : dialogues audibles, explosions atténuées"],
                  ["voice", "Voix", "Dialogues mis en avant"],
                  ["boost", "Renforcé", "Volume augmenté, limiteur anti-saturation"],
                ] as [AudioMode, string, string][]
              ).map(([m, l, d]) => (
                <button key={m} className={`opt ${prefs.audioMode === m ? "on" : ""}`} onClick={() => setPref({ audioMode: m })}>
                  <strong>{l}</strong> <span className="dim">{d}</span>
                </button>
              ))}
            {panel === "sources" &&
              streams.map((st, i) => {
                const source = sourceNames.get(st.channel.sourceId) ?? "Source";
                const status = st.failed ? `échec : ${st.failed}` : st.probe ? (st.probe.ok ? `répond en ${Math.round(st.probe.ms)} ms` : st.probe.error ?? "injoignable") : "non testée";
                return (
                  <button key={st.channel.id} className={`opt ${i === streamIndex ? "on" : ""} ${st.failed || st.probe?.ok === false ? "bad" : ""}`} onClick={() => usePlayer.getState().useStream(i)}>
                    <strong>
                      {i === 0 && !st.failed && st.probe?.ok && <span className="mini-badge ok">conseillée</span>} {st.channel.name}
                    </strong>
                    <span className="dim">
                      {source}
                      {st.quality ? ` · ${st.quality}p` : ""} · {status}
                    </span>
                  </button>
                );
              })}
            {panel === "buffer" && (
              <>
                <BufferChoice compact />
                <button className="opt" onClick={() => retry()}>
                  <strong>Appliquer maintenant</strong> <span className="dim">Relance la chaîne : le retour arrière déjà enregistré est perdu.</span>
                </button>
              </>
            )}
            {panel === "speed" &&
              [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                <button
                  key={s}
                  className={`opt small ${speed === s ? "on" : ""}`}
                  onClick={() => {
                    setSpeed(s);
                    if (videoRef.current) videoRef.current.playbackRate = s;
                  }}
                >
                  ×{s}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Enregistre le programme en cours (ou l'heure qui vient sans guide). */
function RecButton({ channel, prog }: { channel: import("../types").Channel; prog?: import("../types").Programme }) {
  const rec = useRecordings((s) => (prog ? s.find(channel.id, prog.start) : s.list.find((r) => r.channel.id === channel.id && r.status === "recording")));
  const active = rec?.status === "recording" || rec?.status === "scheduled";
  return (
    <button
      className={`icon-btn ${active ? "recording" : ""}`}
      title={active ? "Arrêter l'enregistrement" : prog ? `Enregistrer « ${prog.title} »` : "Enregistrer la prochaine heure"}
      onClick={() => (active && rec ? useRecordings.getState().cancel(rec.id, false) : useRecordings.getState().record(channel, prog))}
    >
      <Icon name="rec" />
    </button>
  );
}
