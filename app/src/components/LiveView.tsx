import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile, useSettings, themeFor } from "../store/settings";
import { useUi } from "../store/ui";
import { useNow, useVisibleChannels } from "../lib/hooks";
import { current, fmtTime, normalize, nowSec } from "../lib/util";
import type { Channel, Programme } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { fun } from "../lib/fun";
import { FilterTabs, LangBadge, LangSelect, langMatch } from "./Filters";
import { CatchupBrowser, ReplayBadge } from "./Catchup";
import { Dropdown } from "./Dropdown";
import { countryFlag, countryName, countryOrLang } from "../lib/languages";
import { historyProgress, useItemsByIds, VodRow } from "./VodView";
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
  const langFilter = useUi((s) => s.langFilter);
  const [replayOnly, setReplayOnly] = useState(false);
  const [country, setCountry] = useState("");
  const [sortBy, setSortBy] = useState<"languages" | "country" | "name">("languages");
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
        langMatch(langFilter, profile.languages, c.languages) &&
        (!replayOnly || !!c.catchup) &&
        (!country || !!c.countries?.includes(country)) &&
        (!q || normalize(c.name).includes(q)),
    );
  }, [base, group, filter, langFilter, profile.languages, replayOnly, country]);

  const hiddenByFilters = useMemo(() => {
    const q = normalize(filter.trim());
    return list.length || !q ? 0 : base.filter((c) => normalize(c.name).includes(q)).length;
  }, [list, base, filter]);
  // `base` est déjà trié par langues favorites ; les autres tris s'appliquent par-dessus.
  const sorted = useMemo(() => {
    if (sortBy === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (sortBy === "country") {
      const key = (c: Channel) => (c.countries?.[0] ? countryName(c.countries[0]) : "\uffff");
      return [...list].sort((a, b) => key(a).localeCompare(key(b), "fr") || a.name.localeCompare(b.name, "fr"));
    }
    return list;
  }, [list, sortBy]);
  const countries = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of base) for (const k of c.countries ?? []) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0]), "fr"));
  }, [base]);
  const replayCount = useMemo(() => base.filter((c) => c.catchup).length, [base]);

  // Langues présentes, les favorites en tête.
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of base) for (const l of c.languages ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
    const rank = (l: string) => {
      const i = profile.languages.indexOf(l);
      return i < 0 ? 99 : i;
    };
    return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]).map(([name, count]) => ({ name, count, label: name }));
  }, [base, profile.languages]);
  const vodFavorites = useItemsByIds(scope === "favorites" ? profile.vodFavorites : []);
  const historyItems = useItemsByIds(scope === "favorites" ? profile.history.map((h) => h.itemId).slice(0, 30) : []);

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
          <LangSelect available={languages} />
          {countries.length > 1 && (
            <Dropdown<string>
              ariaLabel="Pays"
              icon="globe"
              value={country}
              active={!!country}
              onChange={setCountry}
              options={[{ value: "", label: "Tous les pays" }, ...countries.map(([c, n]) => ({ value: c, label: countryName(c), prefix: countryFlag(c), hint: String(n) }))]}
            />
          )}
          <Dropdown<"languages" | "country" | "name">
            ariaLabel="Tri des chaînes"
            label="Tri :"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "languages", label: "Mes langues d'abord" },
              { value: "country", label: "Par pays" },
              { value: "name", label: "Nom (A-Z)" },
            ]}
          />
          {replayCount > 0 && (
            <button className={`dd-button ${replayOnly ? "active" : ""}`} aria-pressed={replayOnly} onClick={() => setReplayOnly(!replayOnly)} title="Seulement les chaînes dont on peut revoir les émissions passées">
              <Icon name="replay" size={15} /> Replay
            </button>
          )}
          <div className="spacer" />
          <button className={`icon-btn ${view === "list" ? "active" : ""}`} title="Liste" onClick={() => setChannelView("list")}>
            <Icon name="list" />
          </button>
          <button className={`icon-btn ${view === "grid" ? "active" : ""}`} title="Mosaïque" onClick={() => setChannelView("grid")}>
            <Icon name="grid" />
          </button>
        </div>
        {scope === "favorites" && (
          <>
            <VodRow title="Ma liste" items={vodFavorites} />
            <VodRow title="Historique" items={historyItems} progress={historyProgress(profile.history)} />
          </>
        )}
        {layout.showGroups && groups.length > 1 && (
          <FilterTabs items={groups.slice(0, 60).map(([g, n]) => ({ name: g, count: n, ...groupLabel(g) }))} value={group === ALL ? undefined : group} onChange={(g) => setGroup(g ?? ALL)} allLabel="Toutes" />
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
        {loading && !sorted.length ? (
          <div className="empty-state small">
            <div className="spinner" /> Chargement des chaînes…
          </div>
        ) : sorted.length === 0 ? (
          scope === "favorites" && (vodFavorites.length || historyItems.length) ? null : scope === "all" && filter.trim() ? (
            <NoChannelMatch
              hiddenByFilters={hiddenByFilters}
              canAddSource={profile.kind !== "child"}
              onReset={() => {
                setGroup(ALL);
                setCountry("");
                setReplayOnly(false);
                useUi.setState({ langFilter: "all" });
              }}
              onAddSource={() => setView("sources")}
            />
          ) : (
            <div className="empty-state small">{scope === "favorites" ? "Ajoutez des favoris avec l'étoile ☆ ou le cœur ♡ d'un film." : "Aucune chaîne ne correspond."}</div>
          )
        ) : (
          <ChannelCollection channels={sorted} mode={view} showNowNext={layout.showNowNext} showProgress={layout.showProgress} />
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
        const p = useSettings.getState().profiles.find((x) => x.id === useSettings.getState().activeProfileId);
        fun.onFavorite(!fav, (p?.favorites.length ?? 0) + (p?.vodFavorites.length ?? 0));
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
        <span className="logo-wrap">
          <ChannelLogo channel={channel} size={logo} />
          <LangBadge langs={channel.languages} max={1} />
        </span>
        <span className="channel-text">
          <span className="channel-name">
            {channel.name}
            {channel.adult && <Icon name="lock" size={14} />}
            <ReplayBadge channel={channel} />
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
        <span className="logo-wrap">
          <ChannelLogo channel={channel} size={64} />
          <LangBadge langs={channel.languages} />
        </span>
        <span className="channel-name">
          {channel.name} <ReplayBadge channel={channel} compact />
        </span>
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
  const now = useNow();
  if (!channel) return null;
  const idx = progs?.findIndex((p) => p.start <= now && p.stop > now) ?? -1;
  const nowProg = idx >= 0 ? progs![idx] : undefined;
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
      <CatchupBrowser channel={channel} />
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

/** Groupe « FR | Info » : drapeau et libellé « Info ». */
function groupLabel(name: string): { label: string; language?: string } {
  const m = name.match(/^\s*[[(|]?\s*([A-Za-z]{2,3})\s*[\]):|\-]\s*(.+)$/);
  const code = m ? countryOrLang(m[1]) : undefined;
  return m && code ? { label: m[2], language: code } : { label: name };
}

/** Recherche de chaîne sans résultat : filtres trop stricts, ou chaîne absente des sources. */
function NoChannelMatch({ hiddenByFilters, canAddSource, onReset, onAddSource }: { hiddenByFilters: number; canAddSource: boolean; onReset: () => void; onAddSource: () => void }) {
  if (hiddenByFilters > 0) {
    return (
      <div className="empty-state small">
        <span>
          {hiddenByFilters} chaîne{hiddenByFilters > 1 ? "s" : ""} masquée{hiddenByFilters > 1 ? "s" : ""} par les filtres (langue, pays, catégorie, replay).
        </span>
        <button className="btn" onClick={onReset}>
          Afficher tout
        </button>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <Icon name="live" size={40} />
      <h3>Cette chaîne n'est dans aucune de vos sources</h3>
      <p>
        Le catalogue intégré ne contient que des chaînes diffusées gratuitement et légalement sur Internet. Les chaînes payantes (bouquets Canal+,
        box opérateur, offres thématiques…) n'y figurent pas : pour les regarder ici, ajoutez la playlist M3U ou le compte Xtream fourni par votre
        abonnement, s'il en propose un.
      </p>
      {canAddSource && (
        <button className="btn btn-primary" onClick={onAddSource}>
          <Icon name="plus" /> Ajouter une source
        </button>
      )}
    </div>
  );
}
