import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type HlsType from "hls.js";
import { getBackend, type SysStats } from "../platform";
import { usePlayer } from "../store/player";

type EngineRef = MutableRefObject<{ hls?: HlsType; kind?: string; stats?: () => { speedKBps?: number; decodedFrames?: number; droppedFrames?: number } } | null>;

interface Sample {
  fps: number;
  dropped: number;
  droppedTotal: number;
  width: number;
  height: number;
  bufferAhead: number;
  liveLatency: number | null;
  throughputKbps: number | null;
  estimateKbps: number | null;
  levelKbps: number | null;
  codecs: string | null;
  uiFps: number;
  lagMs: number;
  heapMb: number | null;
  sys: SysStats | null;
}

const HISTORY = 60;

function fmtRate(kbps: number | null) {
  if (kbps == null || !Number.isFinite(kbps)) return "—";
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mb/s` : `${kbps.toFixed(0)} kb/s`;
}

function mask(url: string) {
  // Identifiants d'abonnement masqués (chemins Xtream, paramètres de connexion).
  return url
    .replace(/(\/(?:live|movie|series)\/)[^/]+\/[^/]+\//i, "$1•••/•••/")
    .replace(/([?&](?:username|password|user|pass|token|key)=)[^&]+/gi, "$1•••")
    .slice(0, 110);
}

function Spark({ values, max }: { values: number[]; max: number }) {
  const w = 220;
  const h = 34;
  const top = Math.max(max, 1);
  const pts = values.map((v, i) => `${(i / (HISTORY - 1)) * w},${h - (Math.min(v, top) / top) * h}`).join(" ");
  return (
    <svg className="hk-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

/** Mesures techniques en direct, façon terminal (mode « Hacker »). */
export function HackerOverlay({ video, engine }: { video: HTMLVideoElement | null; engine: EngineRef }) {
  const info = usePlayer((s) => s.info);
  const source = usePlayer((s) => s.source);
  const streams = usePlayer((s) => s.streams);
  const streamIndex = usePlayer((s) => s.streamIndex);
  const [sample, setSample] = useState<Sample | null>(null);
  const history = useRef<number[]>([]);
  const frames = useRef(0);
  const lag = useRef(0);
  const bytes = useRef({ loaded: 0, at: performance.now() });

  // Fluidité de l'interface (images par seconde) et réactivité (retard de la boucle d'événements).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frames.current++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    let expected = performance.now() + 200;
    const t = setInterval(() => {
      const now = performance.now();
      lag.current = Math.max(lag.current * 0.8, now - expected);
      expected = now + 200;
    }, 200);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  // Débit réel : octets des fragments HLS reçus.
  useEffect(() => {
    const hls = engine.current?.hls;
    if (!hls) return;
    const onFrag = (_e: unknown, d: { frag?: { stats?: { loaded?: number } } }) => {
      bytes.current.loaded += d.frag?.stats?.loaded ?? 0;
    };
    hls.on("hlsFragLoaded" as never, onFrag as never);
    return () => hls.off("hlsFragLoaded" as never, onFrag as never);
  }, [engine, info]);

  useEffect(() => {
    let prevDecoded: number | null = null;
    let prevDropped = 0;
    let prevAt = performance.now();
    const t = setInterval(async () => {
      const v = video;
      const now = performance.now();
      const dt = (now - prevAt) / 1000;
      prevAt = now;
      const e = engine.current;
      const q = v?.getVideoPlaybackQuality?.();
      const extra = e?.stats?.();
      const decoded = q?.totalVideoFrames ?? extra?.decodedFrames ?? 0;
      const droppedTotal = q?.droppedVideoFrames ?? extra?.droppedFrames ?? 0;
      const fps = prevDecoded == null ? 0 : Math.max(0, (decoded - prevDecoded) / dt);
      const dropped = Math.max(0, droppedTotal - prevDropped);
      prevDecoded = decoded;
      prevDropped = droppedTotal;
      let bufferAhead = 0;
      if (v) for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) >= v.currentTime) bufferAhead = v.buffered.end(i) - v.currentTime;
      const hls = e?.hls;
      const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
      const b = bytes.current;
      const measured = hls ? (b.loaded * 8) / 1000 / ((now - b.at) / 1000) : extra?.speedKBps != null ? extra.speedKBps * 8 : null;
      bytes.current = { loaded: 0, at: now };
      const sys = await getBackend()
        .then((x) => x.sysStats?.() ?? null)
        .catch(() => null);
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      const s: Sample = {
        fps,
        dropped,
        droppedTotal,
        width: v?.videoWidth ?? 0,
        height: v?.videoHeight ?? 0,
        bufferAhead,
        liveLatency: hls?.latency && Number.isFinite(hls.latency) ? hls.latency : null,
        throughputKbps: measured,
        estimateKbps: hls?.bandwidthEstimate && Number.isFinite(hls.bandwidthEstimate) ? hls.bandwidthEstimate / 1000 : null,
        levelKbps: level?.bitrate ? level.bitrate / 1000 : null,
        codecs: level ? [level.videoCodec, level.audioCodec].filter(Boolean).join(" + ") || null : null,
        uiFps: frames.current / dt,
        lagMs: lag.current,
        heapMb: heap ? heap / 1048576 : null,
        sys,
      };
      frames.current = 0;
      history.current = [...history.current, measured ?? 0].slice(-HISTORY);
      setSample(s);
    }, 1000);
    return () => clearInterval(t);
  }, [video, engine]);

  if (!sample) return <div className="hk-overlay">initialisation…</div>;
  const s = sample;
  const engineName = info?.kind === "remux" ? `ffmpeg → ${info.remuxFormat}` : info?.timeshift ? "timeshift disque + hls.js" : engine.current?.kind ?? info?.kind ?? "natif";
  const peak = Math.max(...history.current, s.levelKbps ?? 0);
  return (
    <div className="hk-overlay" aria-label="Mesures techniques">
      <div className="hk-title">▌MyIPTV // diagnostics</div>
      <dl>
        <dt>vidéo</dt>
        <dd>
          {s.width && s.height ? `${s.width}×${s.height}` : "—"} · <b className={s.fps && s.fps < 20 ? "warn" : ""}>{s.fps.toFixed(1)} i/s</b> · perdues {s.dropped}/s ({s.droppedTotal})
        </dd>
        <dt>codecs</dt>
        <dd>{s.codecs ?? "—"}</dd>
        <dt>tampon</dt>
        <dd>
          <b className={s.bufferAhead < 2 ? "warn" : ""}>{s.bufferAhead.toFixed(1)} s</b> d'avance{s.liveLatency != null ? ` · retard direct ${s.liveLatency.toFixed(1)} s` : ""}
        </dd>
        <dt>réseau</dt>
        <dd>
          reçu <b>{fmtRate(s.throughputKbps)}</b> · estimé {fmtRate(s.estimateKbps)} · flux {fmtRate(s.levelKbps)}
        </dd>
        <dd className="hk-graph">
          <Spark values={history.current} max={peak * 1.15} />
        </dd>
        <dt>système</dt>
        <dd>
          {s.sys ? (
            <>
              CPU app <b className={s.sys.processCpu > 80 * Math.max(1, s.sys.cores / 4) ? "warn" : ""}>{s.sys.processCpu.toFixed(0)} %</b> · machine {s.sys.systemCpu.toFixed(0)} % ({s.sys.cores} cœurs) · RAM app {(s.sys.processMemory / 1048576).toFixed(0)} Mo · machine {((s.sys.usedMemory / s.sys.totalMemory) * 100).toFixed(0)} %
            </>
          ) : (
            "CPU non mesurable dans le navigateur"
          )}
        </dd>
        <dt>interface</dt>
        <dd>
          {s.uiFps.toFixed(0)} i/s · réactivité <b className={s.lagMs > 50 ? "warn" : ""}>{s.lagMs.toFixed(0)} ms</b>
          {s.heapMb != null ? ` · mémoire JS ${s.heapMb.toFixed(0)} Mo` : ""}
        </dd>
        <dt>moteur</dt>
        <dd>
          {engineName}
          {streams.length > 1 ? ` · copie ${streamIndex + 1}/${streams.length}${streams[streamIndex]?.probe?.ok ? ` (${Math.round(streams[streamIndex].probe!.ms)} ms)` : ""}` : ""}
        </dd>
        {source && (
          <>
            <dt>flux</dt>
            <dd className="hk-url">{mask(source.url)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
