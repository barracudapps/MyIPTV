import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { usePlayer } from "../store/player";
import { useLibrary } from "../store/library";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { programmeAccess } from "../lib/parental";
import { current, fmtDuration, fmtTime, nowSec } from "../lib/util";
import { Icon } from "./Icon";
import { ChannelLogo } from "./ChannelLogo";

type Engine = { destroy(): void; playingDate?: () => Date | null; recover?: () => void };

interface Clock {
  playing: boolean;
  t: number;
  start: number;
  end: number;
  live: boolean;
  /** Heure murale (s) de la position de lecture. */
  wall: number;
}

const MINI_W = 360;

function attach(video: HTMLVideoElement, url: string, kind: string, timeshift: boolean, onFatal: (msg: string) => void): Engine {
  if (kind === "hls" && Hls.isSupported()) {
    const hls = new Hls({
      liveSyncDurationCount: timeshift ? 2 : 3,
      // Ne jamais ramener de force au direct : c'est l'utilisateur qui décide (pause du direct).
      liveMaxLatencyDurationCount: Infinity,
      backBufferLength: timeshift ? 120 : 600,
      maxBufferLength: 30,
      enableWorker: true,
      lowLatencyMode: false,
    });
    let recovered = false;
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true;
        hls.recoverMediaError();
      } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !recovered) {
        recovered = true;
        hls.startLoad();
      } else onFatal(d.details === "manifestLoadError" ? "La chaîne ne répond pas." : `Lecture impossible (${d.details}).`);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return { destroy: () => hls.destroy(), playingDate: () => hls.playingDate };
  }
  if (kind === "mpegts" && mpegts.getFeatureList().mseLivePlayback) {
    const p = mpegts.createPlayer({ type: "mpegts", isLive: true, url }, { enableStashBuffer: false, lazyLoad: false, liveBufferLatencyChasing: false });
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
  return {
    destroy: () => {
      video.removeAttribute("src");
      video.load();
    },
  };
}

export function Player() {
  const { channel, info, catchup, loading, error, mode, setMode, stop, retry, zap } = usePlayer();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const profile = useActiveProfile();
  const autoMini = useSettings((s) => s.playback.autoMiniPlayer);
  const programmes = useLibrary((s) => (channel ? s.programmes[channel.id] : undefined));
  const ensureProgrammes = useLibrary((s) => s.ensureProgrammes);

  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [clock, setClock] = useState<Clock>({ playing: false, t: 0, start: 0, end: 0, live: true, wall: nowSec() });
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [miniPos, setMiniPos] = useState({ right: 16, bottom: 16 });

  // Le lecteur reste monté en permanence : la vidéo continue quand on change d'écran.
  const slotView = view === "live" || view === "favorites";
  const effective = mode === "hidden" || !channel ? "hidden" : mode === "docked" && !slotView ? (autoMini ? "mini" : "hidden-keep") : mode;

  useLayoutEffect(() => {
    if (effective !== "docked") return;
    let raf = 0;
    const update = () => {
      const slot = document.getElementById("player-slot");
      const r = slot?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [effective]);

  // Moteur de lecture.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !info) return;
    setEngineError(null);
    const engine = attach(video, info.url, info.kind, info.timeshift, setEngineError);
    engineRef.current = engine;
    video.play().catch(() => {
      // Lecture automatique refusée (son) : on relance en muet.
      video.muted = true;
      setMuted(true);
      video.play().catch(() => undefined);
    });
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [info]);

  useEffect(() => {
    if (channel) ensureProgrammes([channel], nowSec() - 3 * 3600, nowSec() + 6 * 3600);
  }, [channel, ensureProgrammes]);

  // Horloge de lecture (position, fenêtre enregistrée, heure murale).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tick = () => {
      const s = video.seekable;
      const start = s.length ? s.start(0) : 0;
      const end = s.length ? s.end(s.length - 1) : video.duration || 0;
      const isLive = !catchup && !Number.isFinite(video.duration) ? true : !catchup && info?.timeshift === true;
      const pd = engineRef.current?.playingDate?.();
      const wall = catchup
        ? catchup.start + video.currentTime
        : pd
          ? pd.getTime() / 1000
          : nowSec() - Math.max(0, end - video.currentTime);
      setClock({ playing: !video.paused, t: video.currentTime, start, end, live: isLive, wall });
    };
    const id = setInterval(tick, 500);
    video.addEventListener("play", tick);
    video.addEventListener("pause", tick);
    return () => {
      clearInterval(id);
      video.removeEventListener("play", tick);
      video.removeEventListener("pause", tick);
    };
  }, [info, catchup]);

  const playingProg = useMemo(() => (catchup ? catchup : current(programmes, Math.floor(clock.wall)).now), [catchup, programmes, clock.wall]);
  const access = profile && channel ? programmeAccess(profile, channel, playingProg) : { ok: true as const };
  const blocked = !access.ok;

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted || blocked;
  }, [muted, blocked]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  // Masquage automatique des contrôles.
  const hideTimer = useRef<number>();
  const poke = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3500);
  }, []);
  useEffect(() => poke(), [channel, poke]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === boxRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const seekBy = (d: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(clock.start, v.currentTime + d), clock.end - 1);
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
  const pip = () => {
    const v = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
    v?.requestPictureInPicture?.().catch(() => undefined);
  };

  // Raccourcis clavier / télécommande.
  useEffect(() => {
    if (!channel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const inPlayer = fullscreen || boxRef.current?.contains(t);
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
          if (!fullscreen) return;
          seekBy(e.key === "ArrowLeft" ? -10 : 10);
          break;
        case "ArrowUp":
        case "ArrowDown":
          if (!fullscreen) return;
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

  if (!channel) return null;

  const behind = Math.max(0, clock.end - clock.t);
  const atLive = behind < 15;
  const span = Math.max(1, clock.end - clock.start);
  const showBar = catchup ? clock.end > 0 : span > 30;
  const isMini = effective === "mini";
  const hiddenKeep = effective === "hidden-keep";

  const style: React.CSSProperties = isMini
    ? { position: "fixed", right: miniPos.right, bottom: miniPos.bottom, width: MINI_W, height: (MINI_W * 9) / 16, zIndex: 50 }
    : effective === "docked" && rect
      ? { position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 5 }
      : { position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: -10, top: -10 };

  const startDrag = (e: React.PointerEvent) => {
    if (!isMini || (e.target as HTMLElement).closest("button")) return;
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

  return (
    <div
      ref={boxRef}
      className={`player ${isMini ? "player-mini" : ""} ${controlsVisible || !clock.playing ? "show-controls" : ""} ${fullscreen ? "is-fs" : ""}`}
      style={fullscreen ? undefined : style}
      onPointerMove={poke}
      onPointerDown={startDrag}
      onFocusCapture={poke}
      aria-hidden={hiddenKeep}
      data-own-arrows={fullscreen ? "" : undefined}
    >
      <video ref={videoRef} playsInline className={blocked ? "video-blocked" : ""} onDoubleClick={toggleFullscreen} onClick={isMini ? undefined : togglePlay} />

      {(loading || (!clock.playing && !shownError && clock.t === 0)) && !blocked && (
        <div className="player-center">
          <div className="spinner" />
          {!isMini && <span>{info?.timeshift ? "Préparation du direct…" : "Connexion…"}</span>}
        </div>
      )}

      {blocked && !access.ok && access.reason === "blocked" && (
        <div className="player-center player-blocked">
          <Icon name="shield" size={isMini ? 24 : 48} />
          <strong>Programme non adapté</strong>
          {!isMini && <span>{access.message}</span>}
        </div>
      )}

      {shownError && (
        <div className="player-center player-error">
          <Icon name="alert" size={isMini ? 22 : 40} />
          <span>{shownError}</span>
          <button className="btn" onClick={retry}>
            Réessayer
          </button>
        </div>
      )}

      <div className="player-top">
        <ChannelLogo channel={channel} size={isMini ? 24 : 36} />
        <div className="player-title">
          <strong>{channel.name}</strong>
          {playingProg && !isMini && (
            <span>
              {playingProg.title}
              {playingProg.age ? <em className="age">-{playingProg.age}</em> : null} · {fmtTime(playingProg.start)}–{fmtTime(playingProg.stop)}
            </span>
          )}
        </div>
        {catchup ? <span className="badge">REPLAY</span> : atLive && clock.live ? <span className="badge live">DIRECT</span> : <span className="badge">-{fmtDuration(behind)}</span>}
        {isMini ? (
          <>
            <button className="icon-btn" title="Agrandir" onClick={() => { setMode("docked"); setView("live"); }}>
              <Icon name="expand" />
            </button>
            <button className="icon-btn" title="Fermer" onClick={stop}>
              <Icon name="close" />
            </button>
          </>
        ) : (
          <button className="icon-btn" title="Réduire (mini-lecteur)" onClick={() => setMode("mini")}>
            <Icon name="shrink" />
          </button>
        )}
      </div>

      {!isMini && (
        <div className="player-controls">
          {showBar && (
            <div
              className="seekbar"
              role="slider"
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={span}
              aria-valuenow={clock.t - clock.start}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const v = videoRef.current;
                if (v) v.currentTime = clock.start + ((e.clientX - r.left) / r.width) * span;
              }}
            >
              <div className="seekbar-fill" style={{ width: `${((clock.t - clock.start) / span) * 100}%` }} />
              {!catchup && playingProg && playingProg.start > clock.wall - (clock.t - clock.start) && (
                <div className="seekbar-mark" title="Début du programme" style={{ left: `${((clock.t - clock.start - (clock.wall - playingProg.start)) / span) * 100}%` }} />
              )}
            </div>
          )}
          <div className="controls-row">
            <button className="icon-btn" title="Chaîne précédente" onClick={() => zap(-1)} disabled={!!catchup}>
              <Icon name="prev" />
            </button>
            {showBar && (
              <button className="icon-btn" title="Reculer de 30 s" onClick={() => seekBy(-30)}>
                <Icon name="back30" />
              </button>
            )}
            <button className="icon-btn big" title={clock.playing ? "Pause" : "Lecture"} onClick={togglePlay}>
              <Icon name={clock.playing ? "pause" : "play"} />
            </button>
            {showBar && (
              <button className="icon-btn" title="Avancer de 30 s" onClick={() => seekBy(30)} disabled={!catchup && atLive}>
                <Icon name="fwd30" />
              </button>
            )}
            <button className="icon-btn" title="Chaîne suivante" onClick={() => zap(1)} disabled={!!catchup}>
              <Icon name="next" />
            </button>
            {!catchup && showBar && !atLive && (
              <button className="btn btn-live" onClick={goLive}>
                Revenir au direct
              </button>
            )}
            {!catchup && showBar && playingProg && clock.wall - playingProg.start > 60 && clock.wall - playingProg.start < span && (
              <button className="btn" onClick={startOver} title="Reprendre au début du programme">
                <Icon name="restart" size={16} /> Début
              </button>
            )}
            <span className="time">
              {catchup ? `${fmtDuration(clock.t)} / ${fmtDuration(clock.end)}` : `${fmtTime(Math.floor(clock.wall))}${showBar ? ` · tampon ${fmtDuration(span)}` : ""}`}
            </span>
            <div className="spacer" />
            <button className="icon-btn" title={muted ? "Rétablir le son" : "Couper le son"} onClick={() => setMuted(!muted)}>
              <Icon name={muted ? "mute" : "volume"} />
            </button>
            <input className="volume" type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(+e.target.value)} aria-label="Volume" />
            <button className="icon-btn" title="Image dans l'image" onClick={pip}>
              <Icon name="pip" />
            </button>
            <button className="icon-btn" title="Plein écran (F)" onClick={toggleFullscreen}>
              <Icon name={fullscreen ? "shrink" : "expand"} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
