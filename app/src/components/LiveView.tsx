import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile, useSettings, themeFor } from "../store/settings";
import { useUi } from "../store/ui";
import { useNow, useVisibleChannels } from "../lib/hooks";
import { current, fmtTime, normalize, nowSec } from "../lib/util";
import { programmeAccess } from "../lib/parental";
import type { Channel, Programme } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { Icon } from "./Icon";

const ALL = "__all__";

export function LiveView({ scope }: { scope: "all" | "favorites" }) {
  const profile = useActiveProfile()!;
  const customThemes = useSettings((s) => s.customThemes);
  const layout = themeFor(profile, customThemes).layout;
  const visible = useVisibleChannels();
  const loading = useLibrary((s) => s.loading);
  const hasSources = useSettings((s) => s.sources.length > 0);
  const setView = useUi((s) => s.setView);
  const [group, setGroup] = useState(ALL);
  const [filter, setFilter] = useState("");
  const [view, setChannelView] = useState(layout.channelView);
  useEffect(() => setChannelView(layout.channelView), [layout.channelView]);

  const base = useMemo(() => {
    if (scope === "all") return visible;
    const fav = new Set(profile.favorites);
    return visible.filter((c) => fav.has(c.id));
  }, [scope, visible, profile.favorites]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of base) for (const g of (c.group ?? "Sans catégorie").split(";")) counts.set(g.trim(), (counts.get(g.trim()) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const list = useMemo(() => {
    const q = normalize(filter.trim());
    return base.filter(
      (c) =>
        (group === ALL || (c.group ?? "Sans catégorie").split(";").some((g) => g.trim() === group)) &&
        (!q || normalize(c.name).includes(q)),
    );
  }, [base, group, filter]);

  const recent = useMemo(() => {
    if (scope !== "favorites") return [];
    const byId = new Map(visible.map((c) => [c.id, c]));
    return profile.recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 12) as Channel[];
  }, [scope, profile.recent, visible]);

  if (!hasSources) {
    return (
      <div className="empty-state">
        <Icon name="live" size={56} />
        <h2>Aucune source pour l'instant</h2>
        <p>Ajoutez le catalogue gratuit de chaînes en clair, ou votre propre playlist M3U / compte Xtream.</p>
        <button className="btn btn-primary" onClick={() => setView("sources")}>
          <Icon name="plus" /> Ajouter une source
        </button>
      </div>
    );
  }

  return (
    <div className={`live live-player-${layout.playerPosition}`}>
      <section className="live-browser">
        <div className="toolbar">
          <div className="search-field">
            <Icon name="search" size={18} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filtrer ${base.length} chaînes…`} aria-label="Filtrer les chaînes" />
          </div>
          <button className={`icon-btn ${view === "list" ? "active" : ""}`} title="Liste" onClick={() => setChannelView("list")}>
            <Icon name="list" />
          </button>
          <button className={`icon-btn ${view === "grid" ? "active" : ""}`} title="Mosaïque" onClick={() => setChannelView("grid")}>
            <Icon name="grid" />
          </button>
        </div>
        {layout.showGroups && groups.length > 1 && (
          <div className="chips" role="tablist" aria-label="Catégories">
            <button className={`chip ${group === ALL ? "active" : ""}`} onClick={() => setGroup(ALL)}>
              Toutes <span>{base.length}</span>
            </button>
            {groups.slice(0, 60).map(([g, n]) => (
              <button key={g} className={`chip ${group === g ? "active" : ""}`} onClick={() => setGroup(g)}>
                {g} <span>{n}</span>
              </button>
            ))}
          </div>
        )}
        {recent.length > 0 && (
          <div className="recent">
            <h3>Récemment regardées</h3>
            <div className="recent-row">
              {recent.map((c) => (
                <button key={c.id} className="recent-item" onClick={() => usePlayer.getState().play(c, { zapList: recent })} title={c.name}>
                  <ChannelLogo channel={c} size={48} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {loading && !list.length ? (
          <div className="empty-state small">
            <div className="spinner" /> Chargement des chaînes…
          </div>
        ) : list.length === 0 ? (
          <div className="empty-state small">{scope === "favorites" ? "Ajoutez des favoris avec l'étoile ☆." : "Aucune chaîne ne correspond."}</div>
        ) : (
          <ChannelCollection channels={list} mode={view} showNowNext={layout.showNowNext} showProgress={layout.showProgress} />
        )}
      </section>
      <section className="live-side">
        <div id="player-slot" className="player-slot">
          <PlayerPlaceholder />
        </div>
        <NowPanel />
      </section>
    </div>
  );
}

function PlayerPlaceholder() {
  const channel = usePlayer((s) => s.channel);
  if (channel) return null;
  return (
    <div className="player-placeholder">
      <Icon name="play" size={40} />
      <span>Choisissez une chaîne</span>
    </div>
  );
}

function ChannelCollection({ channels, mode, showNowNext, showProgress }: { channels: Channel[]; mode: "list" | "grid"; showNowNext: boolean; showProgress: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rowH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--row-h")) || 60;
  const cols = mode === "grid" ? Math.max(2, Math.floor(width / 150)) : 1;
  const rows = Math.ceil(channels.length / cols);
  const v = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (mode === "grid" ? 140 : rowH),
    overscan: 8,
  });
  const items = v.getVirtualItems();

  // Charge les programmes des chaînes visibles seulement.
  const ensure = useLibrary((s) => s.ensureProgrammes);
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (!showNowNext) return;
    const slice = channels.slice(first * cols, (last + 1) * cols);
    const t = setTimeout(() => ensure(slice, nowSec() - 3600, nowSec() + 6 * 3600), 120);
    return () => clearTimeout(t);
  }, [first, last, cols, channels, ensure, showNowNext]);

  useEffect(() => v.measure(), [mode, rowH, v]);

  return (
    <div ref={parentRef} className="channel-scroll">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {items.map((row) => (
          <div
            key={row.key}
            className={mode === "grid" ? "grid-row" : undefined}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: row.size, transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {channels.slice(row.index * cols, row.index * cols + cols).map((c) =>
              mode === "grid" ? (
                <ChannelTile key={c.id} channel={c} list={channels} />
              ) : (
                <ChannelRow key={c.id} channel={c} list={channels} showNowNext={showNowNext} showProgress={showProgress} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function useChannelState(channel: Channel) {
  const profile = useActiveProfile()!;
  const playing = usePlayer((s) => s.channel?.id === channel.id);
  const progs = useLibrary((s) => s.programmes[channel.id]);
  const now = useNow();
  const { now: prog, next } = current(progs, now);
  const fav = profile.favorites.includes(channel.id);
  return { profile, playing, prog, next, now, fav };
}

function FavButton({ channel, fav }: { channel: Channel; fav: boolean }) {
  return (
    <button
      className={`fav ${fav ? "on" : ""}`}
      title={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
      onClick={(e) => {
        e.stopPropagation();
        useSettings.getState().toggleFavorite(channel.id);
      }}
    >
      <Icon name="star" size={18} filled={fav} />
    </button>
  );
}

function ChannelRow({ channel, list, showNowNext, showProgress }: { channel: Channel; list: Channel[]; showNowNext: boolean; showProgress: boolean }) {
  const { playing, prog, next, now, fav } = useChannelState(channel);
  const logo = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--logo")) || 40;
  return (
    <div className={`channel-row ${playing ? "playing" : ""}`}>
      <button className="channel-main" onClick={() => usePlayer.getState().play(channel, { zapList: list })}>
        <ChannelLogo channel={channel} size={logo} />
        <span className="channel-text">
          <span className="channel-name">
            {channel.name}
            {channel.adult && <Icon name="lock" size={14} />}
            {channel.catchup && <span className="mini-badge" title="Replay disponible">REPLAY</span>}
          </span>
          {showNowNext && prog && (
            <span className="channel-prog">
              {prog.title}
              {next && <span className="dim"> · ensuite {fmtTime(next.start)} {next.title}</span>}
            </span>
          )}
          {showProgress && prog && (
            <span className="progress">
              <span style={{ width: `${((now - prog.start) / (prog.stop - prog.start)) * 100}%` }} />
            </span>
          )}
        </span>
      </button>
      <FavButton channel={channel} fav={fav} />
    </div>
  );
}

function ChannelTile({ channel, list }: { channel: Channel; list: Channel[] }) {
  const { playing, prog, fav } = useChannelState(channel);
  return (
    <div className={`channel-tile ${playing ? "playing" : ""}`}>
      <button className="tile-main" onClick={() => usePlayer.getState().play(channel, { zapList: list })} title={prog ? `${channel.name} — ${prog.title}` : channel.name}>
        <ChannelLogo channel={channel} size={64} />
        <span className="channel-name">{channel.name}</span>
        {prog && <span className="tile-prog">{prog.title}</span>}
      </button>
      <FavButton channel={channel} fav={fav} />
    </div>
  );
}

/** Fiche de la chaîne en cours : programme, à suivre, replay. */
function NowPanel() {
  const channel = usePlayer((s) => s.channel);
  const catchup = usePlayer((s) => s.catchup);
  const progs = useLibrary((s) => (channel ? s.programmes[channel.id] : undefined));
  const profile = useActiveProfile()!;
  const now = useNow();
  if (!channel) return null;
  const idx = progs?.findIndex((p) => p.start <= now && p.stop > now) ?? -1;
  const nowProg = idx >= 0 ? progs![idx] : undefined;
  const past = progs ? progs.filter((p) => p.stop <= now).slice(-6).reverse() : [];
  const upcoming = progs ? progs.filter((p) => p.start > now).slice(0, 5) : [];

  return (
    <div className="now-panel">
      {catchup ? (
        <ProgrammeCard p={catchup} label="Replay" />
      ) : nowProg ? (
        <ProgrammeCard p={nowProg} label="En ce moment" />
      ) : (
        <p className="dim">Pas d'information de programme pour cette chaîne.</p>
      )}
      {upcoming.length > 0 && (
        <>
          <h3>À suivre</h3>
          <ul className="prog-list">
            {upcoming.map((p) => (
              <li key={p.start}>
                <span className="time">{fmtTime(p.start)}</span> {p.title}
                {p.age ? <em className="age">-{p.age}</em> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {channel.catchup && past.length > 0 && (
        <>
          <h3>Revoir</h3>
          <ul className="prog-list">
            {past.map((p) => {
              const ok = programmeAccess(profile, channel, p).ok;
              return (
                <li key={p.start}>
                  <button className="link" disabled={!ok} onClick={() => usePlayer.getState().playCatchup(channel, p)}>
                    <Icon name="replay" size={16} /> <span className="time">{fmtTime(p.start)}</span> {p.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ProgrammeCard({ p, label }: { p: Programme; label: string }) {
  return (
    <div className="prog-card">
      <span className="eyebrow">{label}</span>
      <h2>
        {p.title} {p.age ? <em className="age">-{p.age}</em> : null}
      </h2>
      <span className="dim">
        {fmtTime(p.start)} – {fmtTime(p.stop)}
        {p.category ? ` · ${p.category}` : ""}
        {p.episode ? ` · ${p.episode}` : ""}
      </span>
      {p.subtitle && <p className="subtitle">{p.subtitle}</p>}
      {p.desc && <p className="desc">{p.desc}</p>}
    </div>
  );
}
