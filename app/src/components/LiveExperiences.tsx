import { useEffect, useMemo, useRef, useState } from "react";
import { useVisibleChannels, useNow } from "../lib/hooks";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile } from "../store/settings";
import { current, fmtTime, nowSec } from "../lib/util";
import { displayName } from "../lib/variants";
import { translateLabel } from "../lib/i18n";
import type { Channel } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { GuideView } from "./GuideView";
import { NowPanel } from "./LiveView";
import { Icon } from "./Icon";

/**
 * Dispositions alternatives de l'écran Direct, choisies par le thème :
 * - « immersive » : la chaîne en plein écran, une bande de chaînes qui apparaît au besoin ;
 * - « guide » : la grille des programmes comme écran principal ;
 * - « magazine » : une scène en tête et des rangées de grandes cartes par catégorie.
 */
export type Experience = "classic" | "immersive" | "guide" | "magazine";

/** Programme en cours d'une chaîne (le guide est chargé pour les chaînes affichées). */
function useNowProgramme(channel: Channel) {
  const progs = useLibrary((s) => s.programmes[channel.id]);
  const time = useNow();
  return { ...current(progs, time), time };
}

function ChannelCard({ channel, list, wide = false }: { channel: Channel; list: Channel[]; wide?: boolean }) {
  const { now: prog, next, time: now } = useNowProgramme(channel);
  const playing = usePlayer((s) => s.channel?.id === channel.id);
  const pct = prog ? Math.min(100, ((now - prog.start) / (prog.stop - prog.start)) * 100) : 0;
  return (
    <button className={`xp-card ${wide ? "wide" : ""} ${playing ? "playing" : ""}`} onClick={() => usePlayer.getState().play(channel, { zapList: list })} title={displayName(channel)}>
      <span className="xp-card-logo">
        <ChannelLogo channel={channel} size={wide ? 56 : 44} />
      </span>
      <span className="xp-card-text">
        <strong>{displayName(channel)}</strong>
        <span className="xp-card-prog">{prog ? prog.title : "Programme non communiqué"}</span>
        {wide && next && (
          <span className="dim small">
            Ensuite {fmtTime(next.start)} · {next.title}
          </span>
        )}
      </span>
      {prog && (
        <span className="xp-progress">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  );
}

/** Charge les programmes d'une liste de chaînes affichées. */
function useEnsureProgrammes(channels: Channel[]) {
  const ensure = useLibrary((s) => s.ensureProgrammes);
  const key = channels.map((c) => c.id).join();
  useEffect(() => {
    if (!channels.length) return;
    const t = setTimeout(() => ensure(channels, nowSec() - 3600, nowSec() + 6 * 3600), 150);
    return () => clearTimeout(t);
  }, [key]);
}

// ------------------------------------------------------------------ Salon (immersif)

export function ImmersiveLive() {
  const channels = useVisibleChannels();
  const playing = usePlayer((s) => s.channel);
  const [shown, setShown] = useState(true);
  const [index, setIndex] = useState(0);
  const timer = useRef<number>();
  const strip = useRef<HTMLDivElement>(null);

  // Bande visible au moindre geste, masquée après 5 s d'inactivité pendant la lecture.
  useEffect(() => {
    const wake = () => {
      setShown(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => usePlayer.getState().channel && setShown(false), 5000);
    };
    wake();
    const events = ["mousemove", "keydown", "pointerdown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, wake));
    return () => {
      window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, []);

  // La chaîne en cours au centre de la bande.
  useEffect(() => {
    const i = playing ? channels.findIndex((c) => c.id === playing.id) : -1;
    if (i >= 0) setIndex(i);
  }, [playing, channels]);
  const start = Math.max(0, index - 12);
  const visible = channels.slice(start, start + 40);
  useEnsureProgrammes(visible);
  useEffect(() => {
    strip.current?.querySelector(".xp-card.playing")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [playing, shown]);

  return (
    <div className="xp-immersive">
      <div id="player-slot" className="player-slot xp-stage">
        {!playing && (
          <div className="player-placeholder">
            <Icon name="play" size={48} />
            <span>Choisissez une chaîne dans la bande ci-dessous</span>
          </div>
        )}
      </div>
      <div className={`xp-strip ${shown ? "shown" : ""}`} ref={strip} aria-label="Chaînes">
        <div className="xp-strip-head">
          <button className="icon-btn" title="Chaînes précédentes" onClick={() => setIndex((i) => Math.max(0, i - 20))}>
            <Icon name="prev" />
          </button>
          <span className="dim small">
            {channels.length ? `${start + 1}–${Math.min(channels.length, start + 40)} sur ${channels.length} chaînes` : "Aucune chaîne"}
          </span>
          <button className="icon-btn" title="Chaînes suivantes" onClick={() => setIndex((i) => Math.min(channels.length - 1, i + 20))}>
            <Icon name="next" />
          </button>
        </div>
        <div className="xp-strip-row">
          {visible.map((c) => (
            <ChannelCard key={c.id} channel={c} list={channels} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Programme TV

export function GuideLive() {
  return (
    <div className="xp-guide">
      <div className="xp-guide-top">
        <div id="player-slot" className="player-slot">
          <GuidePlaceholder />
        </div>
        <NowPanel />
      </div>
      <div className="xp-guide-grid">
        <GuideView />
      </div>
    </div>
  );
}

function GuidePlaceholder() {
  const channel = usePlayer((s) => s.channel);
  if (channel) return null;
  return (
    <div className="player-placeholder">
      <Icon name="guide" size={40} />
      <span>Choisissez un programme dans la grille</span>
    </div>
  );
}

// ------------------------------------------------------------------ Magazine

export function MagazineLive() {
  const channels = useVisibleChannels();
  const profile = useActiveProfile()!;
  const channel = usePlayer((s) => s.channel);
  // Une rangée par catégorie, les plus fournies d'abord ; les favoris en tête.
  const rows = useMemo(() => {
    const byGroup = new Map<string, Channel[]>();
    for (const c of channels) {
      const g = (c.group ?? "Autres").split(";")[0].trim() || "Autres";
      (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(c);
    }
    const fav = new Set(profile.favorites);
    const favorites = channels.filter((c) => fav.has(c.id));
    // Ordre d'apparition dans la liste déjà triée par langues favorites : les rangées dans vos langues d'abord.
    const groups = [...byGroup.entries()].filter(([, l]) => l.length >= 3).slice(0, 14);
    const merged = new Map<string, Channel[]>();
    for (const [g, l] of groups) {
      const label = translateLabel(g, "fr");
      merged.set(label, [...(merged.get(label) ?? []), ...l]);
    }
    return [...(favorites.length ? [["Mes favoris", favorites] as [string, Channel[]]] : []), ...[...merged.entries()].map(([g, l]) => [g, l.slice(0, 30)] as [string, Channel[]])];
  }, [channels, profile.favorites]);

  return (
    <div className="xp-magazine">
      <header className="xp-mag-stage">
        <div id="player-slot" className="player-slot">
          {!channel && channels[0] && (
            <div className="player-placeholder">
              <Icon name="live" size={44} />
              <span>À la une : {displayName(channels[0])}</span>
              <button className="btn btn-primary" onClick={() => usePlayer.getState().play(channels[0], { zapList: channels })}>
                <Icon name="play" /> Regarder
              </button>
            </div>
          )}
        </div>
        <div className="xp-mag-now">
          <NowPanel />
          {!channel && <p className="xp-mag-hint">Parcourez les rangées ci-dessous : chaque carte montre l'émission en cours.</p>}
        </div>
      </header>
      {rows.map(([title, list]) => (
        <MagazineRow key={title} title={title} channels={list} />
      ))}
    </div>
  );
}

function MagazineRow({ title, channels }: { title: string; channels: Channel[] }) {
  // Programmes chargés quand la rangée approche de l'écran.
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEnsureProgrammes(near ? channels : []);
  return (
    <section className="xp-mag-row" ref={ref}>
      <h3>{title}</h3>
      <div className="xp-mag-scroll">
        {channels.map((c) => (
          <ChannelCard key={c.id} channel={c} list={channels} wide />
        ))}
      </div>
    </section>
  );
}
