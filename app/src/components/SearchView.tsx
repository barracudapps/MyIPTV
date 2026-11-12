import { useEffect, useMemo, useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile } from "../store/settings";
import { useUi } from "../store/ui";
import { useVisibleChannels } from "../lib/hooks";
import { programmeAccess } from "../lib/parental";
import { fmtDay, fmtTime, normalize, nowSec } from "../lib/util";
import type { Channel, Programme } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { Icon } from "./Icon";

/**
 * Recherche globale. Le lecteur passe en mini-lecteur pendant la recherche :
 * on continue de regarder en cherchant autre chose.
 */
export function SearchView() {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearch);
  const channels = useVisibleChannels();
  const byId = useLibrary((s) => s.byId);
  const epgVersion = useLibrary((s) => s.epgVersion);
  const profile = useActiveProfile()!;
  const [hits, setHits] = useState<{ ch: Channel; p: Programme }[]>([]);
  const [searching, setSearching] = useState(false);

  const visibleIds = useMemo(() => new Set(channels.map((c) => c.id)), [channels]);
  const q = normalize(query.trim());

  const channelHits = useMemo(() => {
    if (q.length < 2) return [];
    return channels.filter((c) => normalize(c.name).includes(q) || (c.group && normalize(c.group).includes(q))).slice(0, 60);
  }, [channels, q]);

  useEffect(() => {
    if (q.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await (await getBackend()).searchProgrammes(query.trim(), 150).catch(() => []);
      setHits(
        res
          .filter((h) => visibleIds.has(h.channelId))
          .map((h) => ({ ch: byId.get(h.channelId)!, p: h.programme }))
          .filter((h) => h.ch && programmeAccess(profile, h.ch, h.p).ok),
      );
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, query, visibleIds, byId, profile, epgVersion]);

  const now = nowSec();
  const live = hits.filter((h) => h.p.start <= now && h.p.stop > now);
  const upcoming = hits.filter((h) => h.p.start > now);
  const past = hits.filter((h) => h.p.stop <= now && h.ch.catchup);

  return (
    <div className="search-view">
      <div className="search-field big">
        <Icon name="search" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chaîne, émission, film, série…" aria-label="Rechercher" />
        {searching && <div className="spinner small" />}
      </div>
      {q.length < 2 ? (
        <p className="dim center">Tapez au moins deux lettres. La lecture continue dans le mini-lecteur.</p>
      ) : (
        <div className="search-results">
          {channelHits.length > 0 && (
            <section>
              <h3>Chaînes ({channelHits.length})</h3>
              <div className="search-channels">
                {channelHits.map((c) => (
                  <button key={c.id} className="search-chip" onClick={() => usePlayer.getState().play(c, { zapList: channelHits })}>
                    <ChannelLogo channel={c} size={32} />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <HitList title="En ce moment" hits={live} action={(h) => usePlayer.getState().play(h.ch)} icon="play" />
          <HitList title="Revoir" hits={past} action={(h) => usePlayer.getState().playCatchup(h.ch, h.p)} icon="replay" />
          <HitList title="À venir" hits={upcoming} />
          {!searching && !channelHits.length && !hits.length && <p className="dim center">Aucun résultat.</p>}
        </div>
      )}
    </div>
  );
}

function HitList({ title, hits, action, icon }: { title: string; hits: { ch: Channel; p: Programme }[]; action?: (h: { ch: Channel; p: Programme }) => void; icon?: string }) {
  if (!hits.length) return null;
  return (
    <section>
      <h3>
        {title} ({hits.length})
      </h3>
      <ul className="hit-list">
        {hits.map((h) => (
          <li key={h.ch.id + h.p.start}>
            <button className="hit" disabled={!action} onClick={() => action?.(h)}>
              <ChannelLogo channel={h.ch} size={36} />
              <span className="hit-text">
                <strong>{h.p.title}</strong>
                <span className="dim">
                  {h.ch.name} · {fmtDay(h.p.start)} {fmtTime(h.p.start)}
                  {h.p.subtitle ? ` · ${h.p.subtitle}` : ""}
                </span>
              </span>
              {icon && <Icon name={icon} />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
