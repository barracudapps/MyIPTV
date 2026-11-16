import { LazyImg } from "./LazyImg";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { themeFor, useActiveProfile, useSettings } from "../store/settings";
import { Showcase } from "./Showcase";
import { useUi } from "../store/ui";
import { sectionOf } from "../lib/sections";
import { fmtDuration } from "../lib/util";
import type { Collection, HistoryEntry } from "../lib/parental";
import { useRecommendations } from "../lib/recommend";
import type { SearchField, VodFacets, VodItem, VodKind, VodSort } from "../types";
import { Icon } from "./Icon";
import { CategorySelect, FilterTabs, LangBadge, LangSelect, langQuery } from "./Filters";
import { Dropdown } from "./Dropdown";
import { countryFlag, countryName } from "../lib/languages";
import { t, locale } from "../lib/t";

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
        {item.live && <span className="vod-live">{t("EN DIRECT")}</span>}
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

/**
 * Bouton à confirmer : un premier appui demande confirmation, un second (dans les
 * 4 secondes) agit. Utilisable à la télécommande, sans fenêtre.
 */
export function ConfirmButton({ label, confirm, onConfirm, className = "link" }: { label: string; confirm: string; onConfirm(): void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`${className} ${armed ? "danger armed" : ""}`} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirm : label}
    </button>
  );
}

/** Identifiants d'un contenu et de ses copies regroupées (l'historique peut viser l'une d'elles). */
export function itemIds(item: VodItem): string[] {
  return [item.id, ...(item.alternates ?? []).map((a) => a.id)];
}

/** Rangée horizontale (Reprendre, Ma liste…) ; `onRemove` et `onClear` la rendent modifiable. */
export function VodRow({
  title,
  items,
  progress,
  onRemove,
  onClear,
  clearLabel = t("Tout effacer"),
}: {
  title: string;
  items: VodItem[];
  progress?: Record<string, number>;
  onRemove?(item: VodItem): void;
  onClear?(): void;
  clearLabel?: string;
}) {
  if (!items.length) return null;
  return (
    <section className="vod-row">
      <div className="vod-row-head">
        <h3>{title}</h3>
        {onClear && <ConfirmButton label={clearLabel} confirm={t("Confirmer ?")} onConfirm={onClear} />}
      </div>
      <div className="vod-row-scroll">
        {items.map((i) =>
          onRemove ? (
            <div key={i.id} className="vod-card-wrap">
              <VodCard item={i} progress={progress?.[i.id]} />
              <button type="button" className="vod-remove" title={t("Retirer « {title} » de l'historique", { title: i.title })} aria-label={t("Retirer {title} de l'historique", { title: i.title })} onClick={() => onRemove(i)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ) : (
            <VodCard key={i.id} item={i} progress={progress?.[i.id]} />
          ),
        )}
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

/** Collection personnelle : ses contenus de la section affichée. */
function CollectionRow({ collection, kind }: { collection: Collection; kind: VodKind }) {
  const items = useItemsByIds(collection.itemIds, kind);
  return (
    <VodRow
      title={collection.name}
      items={items}
      onRemove={(i) => useSettings.getState().toggleInCollection(collection.id, i.id)}
      onClear={() => useSettings.getState().deleteCollection(collection.id)}
      clearLabel={t("Supprimer la collection")}
    />
  );
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
  const recommendations = useRecommendations(kind, profile, includeAdult);
  const progress = useMemo(() => historyProgress(profile.history), [profile.history]);
  const filtered = !!(category || genre || text || country);
  // Thèmes « vitrine » : bannière et rangées par genre pour les films, séries et émissions.
  const customThemes = useSettings((s) => s.customThemes);
  const showcase = !!themeFor(profile, customThemes).layout.showcase && (kind === "movie" || kind === "series" || kind === "show");
  // Contenus masqués par le filtre de langue : proposés plutôt qu'un écran vide.
  const hiddenByLanguage = facets && langFilter !== "all" ? Math.max(0, facets.total - total) : 0;

  const surprise = async () => {
    const b = await getBackend();
    const p = await b.vodQuery({ kind, preferLanguages: profile.languages, language: profile.languages[0], includeAdult, limit: 1, offset: Math.floor(Math.random() * Math.max(1, Math.min(total, 500))) });
    if (p.items[0]) openItem(p.items[0]);
  };

  return (
    <div className={`page vod-page ${showcase && !filtered ? "with-hero" : ""}`}>
      {!filtered && showcase && facets && <Showcase part="hero" kind={kind} genres={facets.genres.map((g) => g.name)} />}
      <header className="page-head">
        <div>
          <h1>
            <Icon name={meta.icon} size={26} /> {t(meta.label)}
          </h1>
          <p className="dim">{facets ? t("{n} disponibles", { n: facets.total.toLocaleString(locale()) }) : ""}</p>
        </div>
        <div className="row">
          {useSettings.getState().fun.surprise && total > 0 && (
            <button className="btn" onClick={surprise} title={t("Un contenu au hasard dans vos langues")}>
              <Icon name="dice" /> {t("Surprends-moi")}
            </button>
          )}
        </div>
      </header>

      <div className="toolbar">
        <div className="search-field">
          <Icon name="search" size={18} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Rechercher dans {section}…", { section: t(meta.label).toLowerCase() })} aria-label={t("Rechercher")} />
        </div>
        <Dropdown<SearchField>
          ariaLabel={t("Critère de recherche")}
          icon="search"
          value={field}
          active={field !== "all"}
          onChange={setField}
          options={[
            { value: "all", label: t("Tout critère") },
            { value: "title", label: t("Titre") },
            { value: "actor", label: kind === "music" ? t("Artiste") : t("Acteur / voix") },
            { value: "director", label: kind === "audiobook" ? t("Auteur") : kind === "podcast" ? t("Éditeur") : t("Réalisation") },
            { value: "genre", label: t("Genre") },
            { value: "year", label: t("Année") },
            { value: "category", label: t("Catégorie") },
            { value: "plot", label: t("Résumé") },
          ]}
        />
        {facets && facets.countries.length > 1 && (
          <Dropdown<string>
            ariaLabel={t("Pays")}
            icon="globe"
            value={country}
            active={!!country}
            onChange={setCountry}
            options={[
              { value: "", label: t("Tous les pays") },
              ...facets.countries.map((c) => ({ value: c.name, label: countryName(c.name), prefix: countryFlag(c.name), hint: String(c.count) })),
            ]}
          />
        )}
        <LangSelect available={facets?.languages} />
        {facets && facets.genres.length > 0 && <CategorySelect categories={facets.categories} value={category} onChange={setCategory} langFilter={langFilter} />}
        <Dropdown<VodSort>
          ariaLabel={t("Tri")}
          label={t("Tri :")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "default", label: t("Mes langues d'abord") },
            { value: "added", label: t("Ajouts récents") },
            { value: "rating", label: t("Mieux notés") },
            { value: "title", label: t("Titre (A-Z)") },
            { value: "year", label: t("Année") },
          ]}
        />
      </div>

      {/* Genres en onglets ; sans genres (listes IPTV), les catégories prennent leur place. */}
      {facets && facets.genres.length > 0 ? (
        <FilterTabs items={facets.genres.slice(0, 30)} value={genre} onChange={setGenre} allLabel={t("Tous les genres")} />
      ) : facets ? (
        <FilterTabs items={facets.categories.slice(0, 40)} value={category} onChange={setCategory} allLabel={t("Toutes les catégories")} />
      ) : null}

      {!filtered && showcase && facets && <Showcase part="rows" kind={kind} genres={facets.genres.map((g) => g.name)} />}
      {!filtered && (
        <>
          <VodRow
            title={kind === "radio" ? t("Écoutées récemment") : t("Reprendre")}
            items={resume}
            progress={progress}
            onRemove={(i) => useSettings.getState().removeHistory(itemIds(i))}
            onClear={() => useSettings.getState().clearHistory(kind)}
          />
          <VodRow title={t("Ma liste")} items={favorites} onRemove={(i) => useSettings.getState().toggleVodFavorite(i.id)} />
          {(profile.collections ?? []).map((c) => (
            <CollectionRow key={c.id} collection={c} kind={kind} />
          ))}
          {recommendations.map((r) => (
            <VodRow key={r.title} title={r.title} items={r.items} />
          ))}
        </>
      )}
      {!filtered && showcase && <h3 className="catalog-title">{t("Tout le catalogue")}</h3>}

      {total === 0 && !busy && !loading ? (
        hiddenByLanguage > 0 && !filtered ? (
          <div className="empty-state small column">
            <span>{t("Aucun contenu dans la langue choisie, mais {n} dans d'autres langues.", { n: hiddenByLanguage.toLocaleString(locale()) })}</span>
            <button className="btn btn-primary" onClick={() => useUi.setState({ langFilter: "all" })}>
              <Icon name="globe" /> {t("Tout afficher")}
            </button>
          </div>
        ) : (
          <div className="empty-state small">{filtered ? t("Aucun résultat.") : t(meta.empty)}</div>
        )
      ) : (
        <>
          {filtered && <p className="dim">{t("{n} résultat(s)", { n: total.toLocaleString(locale()) })}</p>}
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
