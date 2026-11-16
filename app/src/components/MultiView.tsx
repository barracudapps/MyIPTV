import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getBackend } from "../platform";
import { Hls, loadEngines, mpegts } from "../lib/engines";
import { useVisibleChannels } from "../lib/hooks";
import { displayName, streamsOf } from "../lib/variants";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { safeLocalStorage } from "../store/settings";
import { useUi } from "../store/ui";
import type { Channel } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { Icon } from "./Icon";

type Layout = 2 | 4;

interface MultiState {
  layout: Layout;
  tiles: (string | null)[];
  /** Tuile dont on entend le son. */
  audio: number;
  setLayout(l: Layout): void;
  set(i: number, id: string | null): void;
  setAudio(i: number): void;
}

const useMulti = create<MultiState>()(
  persist(
    (set) => ({
      layout: 4,
      tiles: [null, null, null, null],
      audio: 0,
      setLayout: (layout) => set((s) => ({ layout, audio: s.audio < layout ? s.audio : 0 })),
      set: (i, id) => set((s) => ({ tiles: s.tiles.map((t, j) => (j === i ? id : t)) })),
      setAudio: (audio) => set({ audio }),
    }),
    { name: "myiptv-multiview", storage: createJSONStorage(() => safeLocalStorage) },
  ),
);

/** Plusieurs directs en mosaïque, le son sur une seule tuile. */
export function MultiView() {
  const { layout, tiles, audio, setLayout } = useMulti();
  const byId = useLibrary((s) => s.byId);

  // La lecture principale s'arrête : deux sons en même temps n'aideraient personne.
  useEffect(() => {
    if (usePlayer.getState().channel || usePlayer.getState().media) usePlayer.getState().stop();
  }, []);

  return (
    <div className={`multiview layout-${layout}`}>
      <header className="multiview-head">
        <h1>
          <Icon name="grid" size={24} /> Multivue
        </h1>
        <span className="dim small">Cliquez sur une tuile pour entendre son son.</span>
        <div className="segmented">
          {([2, 4] as Layout[]).map((l) => (
            <button key={l} className={layout === l ? "active" : ""} onClick={() => setLayout(l)}>
              {l} écrans
            </button>
          ))}
        </div>
      </header>
      <div className="multiview-grid">
        {tiles.slice(0, layout).map((id, i) => {
          const ch = id ? byId.get(id) : undefined;
          return ch ? <Tile key={`${i}:${ch.id}`} index={i} channel={ch} hearing={audio === i} /> : <EmptyTile key={`${i}:empty`} index={i} />;
        })}
      </div>
    </div>
  );
}

function Tile({ index, channel, hearing }: { index: number; channel: Channel; hearing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copy, setCopy] = useState(0);
  const copies = useMemo(() => streamsOf(channel), [channel]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let destroy: (() => void) | undefined;
    let cancelled = false;
    setError(null);
    setReady(false);
    // Une copie qui échoue passe la main à la suivante.
    const fail = (msg: string) => (copy + 1 < copies.length ? setCopy(copy + 1) : setError(msg));
    (async () => {
      const s = copies[copy];
      const info = await (await getBackend()).openStream({ url: s.url, userAgent: s.userAgent, referrer: s.referrer });
      await loadEngines(info);
      if (cancelled) return;
      if (info.kind === "hls" && Hls?.isSupported()) {
        // Tuiles petites : qualité limitée à la taille affichée, tampon court.
        const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 12, backBufferLength: 10, enableWorker: true });
        hls.on(Hls.Events.ERROR, (_e, d) => d.fatal && fail("La chaîne ne répond pas."));
        hls.loadSource(info.url);
        hls.attachMedia(v);
        destroy = () => hls.destroy();
      } else if (info.kind === "mpegts" && mpegts?.getFeatureList().mseLivePlayback) {
        const p = mpegts.createPlayer({ type: "mpegts", isLive: true, url: info.url }, { lazyLoad: false, liveBufferLatencyChasing: true });
        p.on(mpegts.Events.ERROR, () => fail("La chaîne ne répond pas."));
        p.attachMediaElement(v);
        p.load();
        destroy = () => (p.unload(), p.detachMediaElement(), p.destroy());
      } else if (info.kind === "hls" || info.kind === "mpegts" || info.kind === "native") {
        v.src = info.url;
        v.onerror = () => fail("Flux illisible.");
        destroy = () => (v.removeAttribute("src"), v.load());
      } else throw new Error("Cette chaîne ne peut pas s'afficher en multivue.");
      v.play().catch(() => undefined);
    })().catch((e) => !cancelled && fail(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      v.onerror = null;
      destroy?.();
    };
  }, [copies, copy]);

  useEffect(() => {
    if (video.current) video.current.muted = !hearing;
  }, [hearing]);

  const m = useMulti.getState();
  return (
    <div className={`mv-tile ${hearing ? "hearing" : ""}`} onClick={() => m.setAudio(index)}>
      <video ref={video} playsInline muted={!hearing} onPlaying={() => setReady(true)} />
      {!ready && !error && <span className="spinner mv-center" />}
      {error && <p className="mv-center error-text small">{error}</p>}
      <div className="mv-bar">
        <ChannelLogo channel={channel} size={28} />
        <strong>{displayName(channel)}</strong>
        <Icon name={hearing ? "volume" : "mute"} size={16} />
        <button
          className="icon-btn"
          title="Regarder en grand"
          onClick={(e) => {
            e.stopPropagation();
            usePlayer.getState().play(channel);
            useUi.getState().setView("live");
          }}
        >
          <Icon name="expand" size={16} />
        </button>
        <button className="icon-btn" title="Retirer" onClick={(e) => (e.stopPropagation(), m.set(index, null))}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptyTile({ index }: { index: number }) {
  const channels = useVisibleChannels();
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Les chaînes adultes restent hors de la multivue, sans exception.
    const pool = channels.filter((c) => !c.adult);
    return (q ? pool.filter((c) => displayName(c).toLowerCase().includes(q)) : pool).slice(0, 40);
  }, [channels, query]);
  return (
    <div className="mv-tile empty">
      <label className="mv-search">
        <Icon name="search" size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Choisir une chaîne…" />
      </label>
      <ul className="mv-pick">
        {list.map((c) => (
          <li key={c.id}>
            <button onClick={() => useMulti.getState().set(index, c.id)}>
              <ChannelLogo channel={c} size={24} />
              <span>{displayName(c)}</span>
            </button>
          </li>
        ))}
        {!list.length && <li className="dim small">Aucune chaîne trouvée.</li>}
      </ul>
    </div>
  );
}
