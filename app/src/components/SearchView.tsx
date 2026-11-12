import { displayName } from "../lib/variants";
import { useEffect, useMemo, useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { useVisibleChannels } from "../lib/hooks";
import { programmeAccess } from "../lib/parental";
import { langFlag } from "../lib/languages";
import { SECTIONS } from "../lib/sections";
import { fun } from "../lib/fun";
import { fmtDay, fmtTime, normalize, nowSec } from "../lib/util";
import type { Channel, Programme, SearchField, VodFacets, VodKind, VodPage } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { Icon } from "./Icon";
import { VodCard } from "./VodView";
import { translateLabel } from "../lib/i18n";

type Field = SearchField | "channel" | "programme";

const FIELDS: [Field, string][] = [
  ["all", "Tout critère"],
  ["title", "Titre"],
  ["actor", "Acteur / artiste"],
  ["director", "Réalisation / auteur"],
  ["genre", "Genre"],
  ["year", "Année"],
  ["category", "Catégorie"],
  ["plot", "Résumé"],
  ["channel", "Chaîne"],
  ["programme", "Programme TV"],
];

/**
 * Recherche globale : résultats groupés par section, chacune triée par langues
 * favorites. Le lecteur passe en mini-lecteur : on cherche en continuant de regarder.
 */
export function SearchView() {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearch);
  const channels = useVisibleChannels();
  const byId = useLibrary((s) => s.byId);
  const epgVersion = useLibrary((s) => s.epgVersion);
  const libraryVersion = useLibrary((s) => s.libraryVersion);
  const profile = useActiveProfile()!;
  const includeAdult = useSettings((s) => s.parental.adultEnabled) && profile.kind !== "child";
  const [field, setField] = useState<Field>("all");
  const [hits, setHits] = useState<{ ch: Channel; p: Programme }[]>([]);
  const [vod, setVod] = useState<Partial<Record<VodKind, VodPage>>>({});
  const [searching, setSearching] = useState(false);

  const visibleIds = useMemo(() => new Set(channels.map((c) => c.id)), [channels]);
  const q = normalize(query.trim());
  const wantChannels = field === "all" || field === "channel" || field === "title" || field === "category";
  const wantProgrammes = field === "all" || field === "programme" || field === "title";
  const vodField: SearchField | null = field === "channel" || field === "programme" ? null : field;

  // `channels` est déjà trié par langues favorites.
  const channelHits = useMemo(() => {
    if (q.length < 2 || !wantChannels) return [];
    return channels.filter((c) => normalize(c.name).includes(q) || (field !== "title" && c.group && normalize(c.group).includes(q))).slice(0, 60);
  }, [channels, q, wantChannels, field]);

  useEffect(() => {
    if (q.length < 2) {
      setHits([]);
      setVod({});
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      fun.onSearch();
      const b = await getBackend();
      const [progs, media] = await Promise.all([
        wantProgrammes ? b.searchProgrammes(query.trim(), 150).catch(() => []) : Promise.resolve([]),
        vodField ? b.vodSearch(query.trim(), vodField, profile.languages, includeAdult, 12).catch(() => ({})) : Promise.resolve({}),
      ]);
      setHits(
        progs
          .filter((h) => visibleIds.has(h.channelId))
          .map((h) => ({ ch: byId.get(h.channelId)!, p: h.programme }))
          .filter((h) => h.ch && programmeAccess(profile, h.ch, h.p).ok),
      );
      setVod(media);
      setSearching(false);
    }, 280);
    return () => clearTimeout(t);
  }, [q, query, field, visibleIds, byId, profile, epgVersion, libraryVersion, includeAdult, wantProgrammes, vodField]);

  const now = nowSec();
  const live = hits.filter((h) => h.p.start <= now && h.p.stop > now);
  const upcoming = hits.filter((h) => h.p.start > now);
  const past = hits.filter((h) => h.p.stop <= now && h.ch.catchup);
  const vodTotal = Object.values(vod).reduce((n, p) => n + (p?.total ?? 0), 0);
  const nothing = !searching && !channelHits.length && !hits.length && !vodTotal;

  const seeAll = (kind: VodKind) => useUi.setState({ view: `vod:${kind}`, vodFilter: { text: query.trim(), field: vodField ?? "all" } });

  return (
    <div className="search-view">
      <div className="search-bar">
        <div className="search-field big">
          <Icon name="search" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chaîne, film, acteur, émission, podcast…" aria-label="Rechercher" />
          {searching && <div className="spinner small" />}
        </div>
        <div className="chips center-chips" role="radiogroup" aria-label="Critère de recherche">
          {FIELDS.map(([f, label]) => (
            <button key={f} role="radio" aria-checked={field === f} className={`chip ${field === f ? "active" : ""}`} onClick={() => setField(f)}>
              {label}
            </button>
          ))}
        </div>
        {profile.languages.length > 0 && (
          <p className="dim center small">
            Résultats triés par langues favorites : {profile.languages.map((l) => langFlag(l)).join(" ")}
          </p>
        )}
      </div>

      {q.length < 2 ? (
        <Browse />
      ) : (
        <div className="search-results">
          {channelHits.length > 0 && (
            <section>
              <h3>
                <Icon name="live" /> Chaînes ({channelHits.length})
              </h3>
              <div className="search-channels">
                {channelHits.map((c) => (
                  <button key={c.id} className="search-chip" onClick={() => usePlayer.getState().play(c, { zapList: channelHits })}>
                    <ChannelLogo channel={c} size={32} />
                    <span>{c.name}</span>
                    {c.languages?.[0] && <span>{langFlag(c.languages[0])}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <HitList title="À la télé en ce moment" hits={live} action={(h) => usePlayer.getState().play(h.ch)} icon="play" />
          {SECTIONS.map((s) => {
            const page = vod[s.kind];
            if (!page?.total) return null;
            return (
              <section key={s.kind}>
                <div className="row">
                  <h3 className="grow">
                    <Icon name={s.icon} /> {s.label} ({page.total})
                  </h3>
                  {page.total > page.items.length && (
                    <button className="link" onClick={() => seeAll(s.kind)}>
                      Voir tout
                    </button>
                  )}
                </div>
                <div className="vod-row-scroll">
                  {page.items.map((i) => (
                    <VodCard key={i.id} item={i} />
                  ))}
                </div>
              </section>
            );
          })}
          <HitList title="Revoir (replay TV)" hits={past} action={(h) => usePlayer.getState().playCatchup(h.ch, h.p)} icon="replay" />
          <HitList title="Prochainement à la télé" hits={upcoming} />
          {nothing && (
            <div className="empty-state">
              <p>Aucun résultat.</p>
              {wantChannels && (
                <p className="small">
                  Le catalogue intégré ne contient que des chaînes et programmes diffusés gratuitement et légalement. Une chaîne payante n'apparaît
                  que si vous ajoutez la source fournie par votre abonnement (playlist M3U ou compte Xtream).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Recherche vide : parcourir chaque section par genre / catégorie. */
function Browse() {
  const profile = useActiveProfile()!;
  const counts = useLibrary((s) => s.vodCounts);
  const version = useLibrary((s) => s.libraryVersion);
  const includeAdult = useSettings((s) => s.parental.adultEnabled) && profile.kind !== "child";
  const [facets, setFacets] = useState<Partial<Record<VodKind, VodFacets>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await getBackend();
      const out: Partial<Record<VodKind, VodFacets>> = {};
      for (const s of SECTIONS) if (counts[s.kind]) out[s.kind] = await b.vodFacets(s.kind, profile.languages, includeAdult);
      if (!cancelled) setFacets(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [counts, profile.languages, includeAdult, version]);

  const open = (kind: VodKind, f: { genre?: string; category?: string }) => useUi.setState({ view: `vod:${kind}`, vodFilter: f });

  return (
    <div className="search-results">
      <h2>Parcourir par catégorie</h2>
      {SECTIONS.filter((s) => facets[s.kind]).map((s) => {
        const f = facets[s.kind]!;
        const useGenres = f.genres.length >= 3;
        const list = (useGenres ? f.genres : f.categories).slice(0, 18);
        if (!list.length) return null;
        return (
          <section key={s.kind}>
            <h3>
              <Icon name={s.icon} /> {s.label}
            </h3>
            <div className="browse-tiles">
              {list.map((c) => (
                <button key={c.name} className="browse-tile" onClick={() => open(s.kind, useGenres ? { genre: c.name } : { category: c.name })}>
                  <strong>{translateLabel(c.label ?? c.name, profile.languages[0])}</strong>
                  <span>{c.count}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {!Object.keys(facets).length && <p className="dim center">Tapez au moins deux lettres. La lecture continue dans le mini-lecteur.</p>}
    </div>
  );
}

function HitList({ title, hits, action, icon }: { title: string; hits: { ch: Channel; p: Programme }[]; action?: (h: { ch: Channel; p: Programme }) => void; icon?: string }) {
  if (!hits.length) return null;
  return (
    <section>
      <h3>
        <Icon name="guide" /> {title} ({hits.length})
      </h3>
      <ul className="hit-list">
        {hits.slice(0, 40).map((h) => (
          <li key={h.ch.id + h.p.start}>
            <button className="hit" disabled={!action} onClick={() => action?.(h)}>
              <ChannelLogo channel={h.ch} size={36} />
              <span className="hit-text">
                <strong>{h.p.title}</strong>
                <span className="dim">
                  {displayName(h.ch)} · {fmtDay(h.p.start)} {fmtTime(h.p.start)}
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
