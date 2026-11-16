import { useEffect, useMemo, useState } from "react";
import { getBackend } from "../platform";
import { usePlayer, mediaAccess } from "../store/player";
import { metaKeys, useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { fun } from "../lib/fun";
import { sectionOf } from "../lib/sections";
import { langFlag, langName } from "../lib/languages";
import { errorMessage, fmtDuration } from "../lib/util";
import { useExit } from "../lib/motion";
import { LazyImg } from "./LazyImg";
import type { Episode, Person, PersonView as PersonData, VodDetail } from "../types";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";
import { CollectionMenu } from "./Collections";
import { fmtRuntime, openItem, VodCard } from "./VodView";
import { Dropdown } from "./Dropdown";
import { translateLabel } from "../lib/i18n";
import { t, plural, locale, uiLanguage } from "../lib/t";

function Stars({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="stars" role="radiogroup" aria-label={t("Ma note")} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} className={(hover || value) >= n ? "on" : ""} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)} title={plural(n, "{n} étoile", "{n} étoiles")}>
          ★
        </button>
      ))}
    </div>
  );
}

function PersonChip({ p }: { p: Person }) {
  return (
    <button className="person-chip" onClick={() => useUi.setState({ person: { name: p.name, tmdbId: p.tmdbId } })} title={t("Tous les contenus avec {name}", { name: p.name })}>
      <span className="person-photo">{p.photo ? <LazyImg src={p.photo} alt="" /> : p.name.slice(0, 1)}</span>
      <span className="person-name">{p.name}</span>
      {p.role && <span className="person-role">{p.role}</span>}
    </button>
  );
}

export function TrailerDialog({ youtubeKey, title, onClose }: { youtubeKey: string; title: string; onClose(): void }) {
  return (
    <Modal title={t("Bande-annonce · {title}", { title })} onClose={onClose} wide>
      <div className="trailer">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&rel=0`}
          title={t("Bande-annonce")}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    </Modal>
  );
}

const closeDetail = () => useUi.setState({ detailId: null });

export function DetailView() {
  const id = useUi((s) => s.detailId);
  const profile = useActiveProfile();
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState(0);
  const [trailer, setTrailer] = useState(false);
  const [posterBroken, setPosterBroken] = useState(false);

  useEffect(() => {
    if (!id) return;
    setDetail(null);
    setError(null);
    setSeason(0);
    setPosterBroken(false);
    getBackend()
      .then((b) => b.vodDetail(id, metaKeys()))
      .then((d) => {
        setDetail(d);
        // Saison de l'épisode en cours, sinon la première.
        const h = useSettings.getState().profiles.find((p) => p.id === useSettings.getState().activeProfileId)?.history.find((x) => x.itemId === id);
        const idx = h?.episodeId ? d.seasons.findIndex((s) => s.episodes.some((e) => e.id === h.episodeId)) : 0;
        setSeason(Math.max(0, idx));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  const history = profile?.history.find((h) => h.itemId === id);
  const queue = useMemo(() => detail?.seasons.flatMap((s) => s.episodes) ?? [], [detail]);

  const [closing, close] = useExit(closeDetail);
  if (!id || !profile) return null;
  const meta = sectionOf(detail?.item.kind);
  const item = detail?.item;
  const fav = profile.vodFavorites.includes(id);
  const access = item ? mediaAccess(profile, item, detail?.age) : { ok: true as const };

  const playEpisode = (e: Episode, resumeAt = 0) => {
    if (!detail) return;
    usePlayer.getState().playMedia(detail.item, { episode: e, queue, resumeAt, age: detail.age });
    close();
  };
  const play = () => {
    if (!detail) return;
    if (queue.length) {
      const current = history?.episodeId ? queue.find((e) => e.id === history.episodeId) : undefined;
      if (current && !history?.finished) playEpisode(current, history!.position);
      else if (current && history?.finished) playEpisode(queue[queue.indexOf(current) + 1] ?? queue[0]);
      else playEpisode(queue[0]);
    } else {
      usePlayer.getState().playMedia(detail.item, { resumeAt: history && !history.finished ? history.position : 0, age: detail.age });
      close();
    }
  };
  const resumeLabel =
    history && !history.finished && history.position > 30
      ? history.episodeLabel
        ? t("Reprendre {episode} ({time})", { episode: history.episodeLabel, time: fmtDuration(history.position) })
        : t("Reprendre ({time})", { time: fmtDuration(history.position) })
      : history?.finished && queue.length
        ? t("Épisode suivant")
        : t("Lecture");

  const toggleFav = () => {
    useSettings.getState().toggleVodFavorite(id);
    fun.onFavorite(!fav, profile.vodFavorites.length + 1);
  };

  return (
    <div className={`detail-backdrop ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="detail" role="dialog" aria-modal="true" aria-label={item?.title ?? t("Fiche")} data-modal>
        <header className="detail-hero" style={item?.backdrop ? { backgroundImage: `url(${item.backdrop})` } : undefined}>
          <button className="icon-btn detail-close" onClick={close} title={t("Fermer")}>
            <Icon name="close" />
          </button>
        </header>
        {error && (
          <div className="detail-body">
            <p className="error-text">{error}</p>
          </div>
        )}
        {!detail && !error && (
          <div className="detail-body center">
            <div className="spinner" />
          </div>
        )}
        {detail && item && (
          <div className="detail-body">
            <div className="detail-top">
              <div className={`detail-poster shape-${meta.shape}`}>
                {item.poster && !posterBroken ? <img src={item.poster} alt="" onError={() => setPosterBroken(true)} /> : <Icon name={meta.icon} size={48} />}
              </div>
              <div className="detail-info">
                <span className="eyebrow">{t(meta.label)}</span>
                <h1>{item.title}</h1>
                {detail.tagline && <p className="tagline">{detail.tagline}</p>}
                <div className="detail-facts">
                  {item.year && <span>{item.year}</span>}
                  {item.duration ? <span>{fmtRuntime(item.duration)}</span> : null}
                  {detail.seasons.length > 1 && <span>{t("{n} saisons", { n: detail.seasons.length })}</span>}
                  {queue.length > 0 && <span>{queue.length} {t(meta.unit)}s</span>}
                  {detail.age ? <span className="age-badge">-{detail.age}</span> : null}
                  {item.languages?.map((l) => (
                    <span key={l} title={langName(l)}>
                      {langFlag(l)} {langName(l)}
                    </span>
                  ))}
                </div>
                <div className="ratings">
                  {detail.imdbRating && (
                    <span className="rating-imdb" title={detail.imdbVotes ? t("{n} votes", { n: detail.imdbVotes }) : undefined}>
                      IMDb <strong>{detail.imdbRating.toFixed(1)}</strong>
                    </span>
                  )}
                  {detail.tmdbRating && (
                    <span className="rating-tmdb">
                      TMDB <strong>{detail.tmdbRating.toFixed(1)}</strong>
                    </span>
                  )}
                  {!detail.imdbRating && !detail.tmdbRating && item.rating ? (
                    <span className="rating-tmdb">
                      {t("Note")} <strong>{item.rating.toFixed(1)}</strong>
                    </span>
                  ) : null}
                  <Stars value={profile.ratings[id] ?? 0} onChange={(v) => useSettings.getState().rate(id, v)} />
                </div>
                {!access.ok && access.reason === "blocked" && <p className="error-text">{access.message}</p>}
                <div className="actions left">
                  <button className="btn btn-primary" onClick={play} disabled={!access.ok && access.reason === "blocked"}>
                    <Icon name="play" /> {resumeLabel}
                  </button>
                  {history && !history.finished && history.position > 30 && !queue.length && (
                    <button className="btn" onClick={() => (usePlayer.getState().playMedia(item, { age: detail.age }), close())}>
                      <Icon name="restart" /> {t("Depuis le début")}
                    </button>
                  )}
                  {item.trailer && (
                    <button className="btn" onClick={() => setTrailer(true)}>
                      <Icon name="film" /> {t("Bande-annonce")}
                    </button>
                  )}
                  <button className={`btn ${fav ? "btn-on" : ""}`} onClick={toggleFav}>
                    <Icon name="heart" filled={fav} /> {fav ? t("Dans ma liste") : t("Ma liste")}
                  </button>
                  <CollectionMenu itemId={id} />
                  {history && (
                    <button className="btn" onClick={() => useSettings.getState().removeHistory(id)} title={t("Retirer de l'historique")}>
                      <Icon name="history" /> {t("Oublier")}
                    </button>
                  )}
                </div>
                {item.genres && item.genres.length > 0 && (
                  <div className="chips wrap">
                    {/* Étiquettes identiques une fois traduites (« 50s », « 1950's ») : une seule. */}
                    {item.genres.filter((g, i, all) => all.findIndex((x) => translateLabel(x, uiLanguage()) === translateLabel(g, uiLanguage())) === i).map((g) => (
                      <button key={g} className="chip" onClick={() => (useUi.setState({ view: `vod:${item.kind ?? "movie"}`, vodFilter: { genre: g }, detailId: null }))}>
                        {translateLabel(g, uiLanguage())}
                      </button>
                    ))}
                  </div>
                )}
                {item.plot && <p className="plot">{item.plot}</p>}
                {detail.countries.length > 0 && <p className="dim small">{detail.countries.join(", ")}</p>}
              </div>
            </div>

            {detail.crew.length > 0 && (
              <section>
                <h3>{t("Équipe")}</h3>
                <div className="people">
                  {detail.crew.slice(0, 12).map((p, i) => (
                    <PersonChip key={p.name + i} p={p} />
                  ))}
                </div>
              </section>
            )}
            {detail.cast.length > 0 && (
              <section>
                <h3>{item.kind === "music" ? t("Artistes") : t("Casting")}</h3>
                <div className="people">
                  {detail.cast.slice(0, 24).map((p, i) => (
                    <PersonChip key={p.name + i} p={p} />
                  ))}
                </div>
              </section>
            )}

            {detail.seasons.length > 0 && (
              <section>
                {detail.seasons.length > 1 && (
                  <SeasonPicker seasons={detail.seasons} value={season} onChange={setSeason} currentEpisodeId={history?.episodeId} finished={!!history?.finished} />
                )}
                {detail.seasons.length === 1 && <h3>{detail.seasons[0].name}</h3>}
                <ol className="episodes">
                  {detail.seasons[season]?.episodes.map((e) => {
                    const current = history?.episodeId === e.id;
                    return (
                      <li key={e.id} className={current ? "current" : ""}>
                        <button className="episode" onClick={() => playEpisode(e, current && !history?.finished ? history!.position : 0)} disabled={!access.ok && access.reason === "blocked"}>
                          {e.still ? <LazyImg src={e.still} alt="" wrapClassName="ep-still" /> : <span className="ep-num">{e.episode}</span>}
                          <span className="ep-text">
                            <strong>{e.title || `${t(meta.unit)} ${e.episode}`}</strong>
                            <span className="dim">
                              {[e.airDate?.slice(0, 16), e.duration ? fmtRuntime(e.duration) : ""].filter(Boolean).join(" · ")}
                            </span>
                            {e.plot && <span className="ep-plot">{e.plot}</span>}
                            {current && history && history.duration > 0 && (
                              <span className="vod-progress inline">
                                <span style={{ width: `${history.finished ? 100 : (history.position / history.duration) * 100}%` }} />
                              </span>
                            )}
                          </span>
                          <Icon name="play" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </div>
        )}
      </div>
      {trailer && item?.trailer && <TrailerDialog youtubeKey={item.trailer} title={item.title} onClose={() => setTrailer(false)} />}
    </div>
  );
}

/** Tous les contenus d'un acteur, réalisateur ou auteur, et sa filmographie. */
export function PersonDialog() {
  const person = useUi((s) => s.person);
  const [data, setData] = useState<PersonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const hasTmdb = useSettings((s) => !!s.meta.tmdb);

  useEffect(() => {
    if (!person) return;
    setData(null);
    setError(null);
    getBackend()
      .then((b) => b.person(person.name, person.tmdbId, metaKeys()))
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [person]);

  if (!person) return null;
  const close = () => useUi.setState({ person: null });
  const credits = data?.credits.filter((c) => !onlyAvailable || c.availableId) ?? [];

  return (
    <Modal title={person.name} onClose={close} wide>
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="spinner" />}
      {data && (
        <div className="person-view">
          <div className="row top">
            {data.photo && <img className="person-big" src={data.photo} alt="" />}
            <div className="grow">
              {data.knownFor && <span className="eyebrow">{data.knownFor}</span>}
              {data.birthday && <p className="dim small">{t("Né(e) le {date}", { date: new Date(data.birthday).toLocaleDateString(locale()) })}</p>}
              {data.biography && <p className="bio">{data.biography}</p>}
              {!hasTmdb && <p className="dim small">{t("Ajoutez une clé TMDB (Réglages › Métadonnées) pour la photo, la biographie et la filmographie complète.")}</p>}
            </div>
          </div>
          <h3>{t("Disponible ({n})", { n: data.items.length })}</h3>
          {data.items.length ? (
            <div className="vod-grid shape-portrait compact">
              {data.items.map((i) => (
                <VodCard key={i.id} item={i} />
              ))}
            </div>
          ) : (
            <p className="dim">{t("Aucun contenu disponible avec {name} dans vos sources.", { name: person.name })}</p>
          )}
          {data.credits.length > 0 && (
            <>
              <div className="row">
                <h3 className="grow">{t("Filmographie ({n})", { n: data.credits.length })}</h3>
                <label className="check">
                  <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} /> {t("Seulement disponibles")}
                </label>
              </div>
              <ul className="credits">
                {credits.map((c) => (
                  <li key={`${c.kind}${c.tmdbId}`}>
                    <button className="credit" disabled={!c.availableId} onClick={() => c.availableId && (close(), useUi.setState({ detailId: c.availableId }))}>
                      <span className="time">{c.year ?? "—"}</span>
                      <strong>{c.title}</strong>
                      {c.role && <span className="dim"> · {c.role}</span>}
                      {c.availableId && <span className="mini-badge ok">{t("disponible")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Sélecteur de saison : menu déroulant avec le nombre d'épisodes et la progression,
 * flèches précédente / suivante. La progression suppose un visionnage dans l'ordre :
 * les saisons avant l'épisode en cours sont considérées comme vues.
 */
function SeasonPicker({ seasons, value, onChange, currentEpisodeId, finished }: { seasons: import("../types").Season[]; value: number; onChange(i: number): void; currentEpisodeId?: string; finished: boolean }) {
  const currentSeason = currentEpisodeId ? seasons.findIndex((s) => s.episodes.some((e) => e.id === currentEpisodeId)) : -1;
  const progress = (i: number) => {
    if (currentSeason < 0 || i > currentSeason) return "";
    if (i < currentSeason) return t("✓ vue");
    const eps = seasons[i].episodes;
    const at = eps.findIndex((e) => e.id === currentEpisodeId) + (finished ? 1 : 0);
    return at >= eps.length ? t("✓ vue") : `${at}/${eps.length}`;
  };
  return (
    <div className="season-picker">
      <button className="icon-btn" title={t("Saison précédente")} disabled={value === 0} onClick={() => onChange(value - 1)}>
        <Icon name="prev" size={16} />
      </button>
      <Dropdown<string>
        ariaLabel={t("Saison")}
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        options={seasons.map((s, i) => ({
          value: String(i),
          label: s.name,
          hint: [progress(i) || t("{n} ép.", { n: s.episodes.length }), i === currentSeason ? t("en cours") : ""].filter(Boolean).join(" · "),
        }))}
      />
      <button className="icon-btn" title={t("Saison suivante")} disabled={value === seasons.length - 1} onClick={() => onChange(value + 1)}>
        <Icon name="next" size={16} />
      </button>
      <span className="dim small">
        {plural(seasons[value].episodes.length, "{n} épisode", "{n} épisodes")}
        {progress(value) ? ` · ${progress(value)}` : ""}
      </span>
      {currentSeason >= 0 && currentSeason !== value && (
        <button className="link" onClick={() => onChange(currentSeason)}>
          {t("Aller à la saison en cours")}
        </button>
      )}
    </div>
  );
}

export { openItem };
