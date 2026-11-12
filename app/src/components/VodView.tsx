import { LazyImg } from "./LazyImg";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { sectionOf } from "../lib/sections";
import { fmtDuration } from "../lib/util";
import type { HistoryEntry } from "../lib/parental";
import type { SearchField, VodFacets, VodItem, VodKind, VodSort } from "../types";
import { Icon } from "./Icon";
import { CategorySelect, FilterTabs, LangBadge, LangSelect, langQuery } from "./Filters";
import { Dropdown } from "./Dropdown";
import { countryFlag, countryName } from "../lib/languages";

const PAGE = 60;

/** Ouvre un contenu : les radios se lancent directement, le reste ouvre sa fiche. */
export function openItem(item: VodItem) {
  if (item.kind === "radio" || (item.kind === "music" && item.url)) usePlayer.getState().playMedia(item);
  else useUi.setState({ detailId: item.id });
}

export function VodCard({ item, progress }: { item: VodItem; progress?: number }) {
  const meta = sectionOf(item.kind);
  const profile = useActiveProfile();
  const fav = profile?.vodFavorites.includes(item.id);
  const stars = profile?.ratings[item.id];
  const [broken, setBroken] = useState(false);
  return (
    <button className={`vod-card shape-${meta.shape}`} onClick={() => openItem(item)} title={item.year ? `${item.title} (${item.year})` : item.title}>
      <span className="vod-poster">
        {item.poster && !broken ? (
          <LazyImg src={item.poster} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <span className="vod-poster-fallback">
            <Icon name={meta.icon} size={34} />
            <span>{item.title}</span>
          </span>
        )}
        {fav && <span className="vod-fav"><Icon name="heart" size={14} filled /></span>}
        <LangBadge langs={item.languages} />
        {item.rating ? <span className="vod-rating">★ {item.rating.toFixed(1)}</span> : null}
        {item.live && <span className="vod-live">EN DIRECT</span>}
        {progress != null && progress > 0 && (
          <span className="vod-progress">
            <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="vod-title">{item.title}</span>
      <span className="vod-sub">
        {item.year ?? (item.kind === "radio" || item.kind === "podcast" ? item.category ?? "" : "")}
        {stars ? ` · ${"★".repeat(stars)}` : ""}
      </span>
    </button>
  );
}

/** Rangée horizontale (Reprendre, Ma liste…). */
export function VodRow({ title, items, progress }: { title: string; items: VodItem[]; progress?: Record<string, number> }) {
  if (!items.length) return null;
  return (
    <section className="vod-row">
      <h3>{title}</h3>
      <div className="vod-row-scroll">
        {items.map((i) => (
          <VodCard key={i.id} item={i} progress={progress?.[i.id]} />
        ))}
      </div>
    </section>
  );
}

/** Contenus d'une liste d'identifiants, dans l'ordre (favoris, historique). */
export function useItemsByIds(ids: string[], kind?: VodKind) {
  const [items, setItems] = useState<VodItem[]>([]);
  const version = useLibrary((s) => s.libraryVersion);
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) {
      setItems([]);
      return;
    }
    getBackend()
      .then((b) => b.vodQuery({ ids, kind, preferLanguages: [], includeAdult: true, limit: 60 }))
      .then((p) => setItems(p.items))
      .catch(() => setItems([]));
  }, [key, kind, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return items;
}

export function historyProgress(history: HistoryEntry[]) {
  return Object.fromEntries(history.map((h) => [h.itemId, h.finished ? 1 : h.duration ? h.position / h.duration : 0]));
}

export function VodView({ kind }: { kind: VodKind }) {
  const meta = sectionOf(kind);
  const profile = useActiveProfile()!;
  const adultEnabled = useSettings((s) => s.parental.adultEnabled);
  const includeAdult = adultEnabled && profile.kind !== "child";
  const version = useLibrary((s) => s.libraryVersion);
  const loading = useLibrary((s) => s.loading);
  const filter = useUi((s) => s.vodFilter);

  const [facets, setFacets] = useState<VodFacets | null>(null);
  const [category, setCategory] = useState<string | undefined>();
  const [genre, setGenre] = useState<string | undefined>();
  const langFilter = useUi((s) => s.langFilter);
  const [sort, setSort] = useState<VodSort>("default");
  const [text, setText] = useState("");
  const [field, setField] = useState<SearchField>("all");
  const [country, setCountry] = useState<string>("");
  const [items, setItems] = useState<VodItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // Filtre reçu d'ailleurs (genre cliqué dans une fiche, « Voir tout » d'une recherche).
  useEffect(() => {
    if (!filter) return;
    setText(filter.text ?? "");
    setField((filter.field as SearchField) ?? "all");
    setGenre(filter.genre);
    setCategory(filter.category);
    useUi.setState({ vodFilter: null });
  }, [filter]);

  useEffect(() => {
    setCategory(undefined);
    setGenre(undefined);
    setCountry("");
  }, [kind]);

  useEffect(() => {
    getBackend()
      .then((b) => b.vodFacets(kind, profile.languages, includeAdult))
      .then(setFacets)
      .catch(() => setFacets(null));
  }, [kind, profile.languages, includeAdult, version]);

  const query = useCallback(
    (offset: number) =>
      getBackend().then((b) =>
        b.vodQuery({ kind, category, genre, country: country || undefined, ...langQuery(langFilter, profile.languages), sort, text: text.trim() || undefined, field, preferLanguages: profile.languages, includeAdult, offset, limit: PAGE }),
      ),
    [kind, category, genre, country, langFilter, sort, text, field, profile.languages, includeAdult],
  );

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      query(0)
        .then((p) => {
          if (cancelled) return;
          setItems(p.items);
          setTotal(p.total);
        })
        .finally(() => !cancelled && setBusy(false));
    }, text ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, text, version]);

  // Pagination infinie.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !busy && items.length < total) {
        setBusy(true);
        query(items.length)
          .then((p) => setItems((cur) => [...cur, ...p.items]))
          .finally(() => setBusy(false));
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, total, busy, query]);

  const historyIds = useMemo(() => profile.history.filter((h) => h.kind === kind && !h.finished).map((h) => h.itemId), [profile.history, kind]);
  const resume = useItemsByIds(historyIds, kind);
  const favorites = useItemsByIds(profile.vodFavorites, kind);
  const progress = useMemo(() => historyProgress(profile.history), [profile.history]);
  const filtered = !!(category || genre || text || country);
  // Contenus masqués par le filtre de langue : proposés plutôt qu'un écran vide.
  const hiddenByLanguage = facets && langFilter !== "all" ? Math.max(0, facets.total - total) : 0;

  const surprise = async () => {
    const b = await getBackend();
    const p = await b.vodQuery({ kind, preferLanguages: profile.languages, language: profile.languages[0], includeAdult, limit: 1, offset: Math.floor(Math.random() * Math.max(1, Math.min(total, 500))) });
    if (p.items[0]) openItem(p.items[0]);
  };

  return (
    <div className="page vod-page">
      <header className="page-head">
        <div>
          <h1>
            <Icon name={meta.icon} size={26} /> {meta.label}
          </h1>
          <p className="dim">{facets ? `${facets.total.toLocaleString("fr-FR")} disponibles` : ""}</p>
        </div>
        <div className="row">
          {useSettings.getState().fun.surprise && total > 0 && (
            <button className="btn" onClick={surprise} title="Un contenu au hasard dans vos langues">
              <Icon name="dice" /> Surprends-moi
            </button>
          )}
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" size={18} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Rechercher dans ${meta.label.toLowerCase()}…`} aria-label="Rechercher" />
        </div>
        <Dropdown<SearchField>
          ariaLabel="Critère de recherche"
          icon="search"
          value={field}
          active={field !== "all"}
          onChange={setField}
          options={[
            { value: "all", label: "Tout critère" },
            { value: "title", label: "Titre" },
            { value: "actor", label: kind === "music" ? "Artiste" : "Acteur / voix" },
            { value: "director", label: kind === "audiobook" ? "Auteur" : kind === "podcast" ? "Éditeur" : "Réalisation" },
            { value: "genre", label: "Genre" },
            { value: "year", label: "Année" },
            { value: "category", label: "Catégorie" },
            { value: "plot", label: "Résumé" },
          ]}
        />
        {facets && facets.countries.length > 1 && (
          <Dropdown<string>
            ariaLabel="Pays"
            icon="globe"
            value={country}
            active={!!country}
            onChange={setCountry}
            options={[
              { value: "", label: "Tous les pays" },
              ...facets.countries.map((c) => ({ value: c.name, label: countryName(c.name), prefix: countryFlag(c.name), hint: String(c.count) })),
            ]}
          />
        )}
        <LangSelect available={facets?.languages} />
        {facets && facets.genres.length > 0 && <CategorySelect categories={facets.categories} value={category} onChange={setCategory} langFilter={langFilter} />}
        <Dropdown<VodSort>
          ariaLabel="Tri"
          label="Tri :"
          value={sort}
          onChange={setSort}
          options={[
            { value: "default", label: "Mes langues d'abord" },
            { value: "added", label: "Ajouts récents" },
            { value: "rating", label: "Mieux notés" },
            { value: "title", label: "Titre (A-Z)" },
            { value: "year", label: "Année" },
          ]}
        />
      </div>

      {/* Genres en onglets ; sans genres (listes IPTV), les catégories prennent leur place. */}
      {facets && facets.genres.length > 0 ? (
        <FilterTabs items={facets.genres.slice(0, 30)} value={genre} onChange={setGenre} allLabel="Tous les genres" />
      ) : facets ? (
        <FilterTabs items={facets.categories.slice(0, 40)} value={category} onChange={setCategory} allLabel="Toutes les catégories" />
      ) : null}

      {!filtered && (
        <>
          <VodRow title={kind === "radio" ? "Écoutées récemment" : "Reprendre"} items={resume} progress={progress} />
          <VodRow title="Ma liste" items={favorites} />
        </>
      )}

      {total === 0 && !busy && !loading ? (
        hiddenByLanguage > 0 && !filtered ? (
          <div className="empty-state small column">
            <span>Aucun contenu dans la langue choisie, mais {hiddenByLanguage.toLocaleString("fr-FR")} dans d'autres langues.</span>
            <button className="btn btn-primary" onClick={() => useUi.setState({ langFilter: "all" })}>
              <Icon name="globe" /> Tout afficher
            </button>
          </div>
        ) : (
          <div className="empty-state small">{filtered ? "Aucun résultat." : meta.empty}</div>
        )
      ) : (
        <>
          {filtered && <p className="dim">{total.toLocaleString("fr-FR")} résultat(s)</p>}
          <div className={`vod-grid shape-${meta.shape}`}>
            {items.map((i) => (
              <VodCard key={i.id} item={i} progress={progress[i.id]} />
            ))}
          </div>
        </>
      )}
      <div ref={sentinel} className="sentinel">
        {(busy || loading) && <div className="spinner" />}
      </div>
    </div>
  );
}

export function fmtRuntime(secs?: number) {
  if (!secs) return "";
  return secs >= 3600 ? `${Math.floor(secs / 3600)} h ${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}` : fmtDuration(secs);
}
