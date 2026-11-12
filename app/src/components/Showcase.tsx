import { useEffect, useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { langQuery } from "./Filters";
import { openItem, VodRow } from "./VodView";
import { Icon } from "./Icon";
import { LazyImg } from "./LazyImg";
import { translateLabel } from "../lib/i18n";
import type { VodItem, VodKind } from "../types";

const HERO_MS = 9000;

/**
 * Vitrine façon plateforme de streaming : grande bannière d'un contenu mis en avant,
 * puis une rangée d'affiches par genre. Affichée par les thèmes « vitrine ».
 */
export function Showcase({ kind, genres, part }: { kind: VodKind; genres: string[]; part: "hero" | "rows" }) {
  const profile = useActiveProfile()!;
  const adultEnabled = useSettings((s) => s.parental.adultEnabled);
  const includeAdult = adultEnabled && profile.kind !== "child";
  const langFilter = useUi((s) => s.langFilter);
  const version = useLibrary((s) => s.libraryVersion);
  const [featured, setFeatured] = useState<VodItem[]>([]);
  const [rows, setRows] = useState<{ genre: string; items: VodItem[] }[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    const base = { kind, ...langQuery(langFilter, profile.languages), preferLanguages: profile.languages, includeAdult };
    void getBackend().then(async (b) => {
      if (part === "rows") {
        // Un genre par libellé traduit (« Comedy » et « comedy » ne font qu'une rangée).
        const labels = new Set<string>();
        const unique = genres.filter((g) => {
          const l = translateLabel(g, "fr").toLowerCase();
          return !labels.has(l) && (labels.add(l), true);
        });
        const found = await Promise.all(unique.slice(0, 8).map(async (genre) => ({ genre, items: (await b.vodQuery({ ...base, genre, limit: 24 })).items })));
        if (alive) setRows(found.filter((r) => r.items.length >= 4));
        return;
      }
      // Mis en avant : les mieux notés qui ont une image, dans les langues du profil.
      const top = await b.vodQuery({ ...base, sort: "rating", limit: 60 });
      if (!alive) return;
      // Une vraie image de fond, ou à défaut une affiche accompagnée d'un résumé : pas de simple logo.
      const worthy = top.items.filter((i) => i.backdrop || (i.poster && i.plot && i.plot.length > 60));
      setFeatured(worthy.slice(0, 6));
      setIndex(0);
    });
    return () => void (alive = false);
  }, [part, kind, genres.join("|"), langFilter, profile.languages.join(), includeAdult, version]);

  useEffect(() => {
    if (featured.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % featured.length), HERO_MS);
    return () => clearInterval(t);
  }, [featured]);

  const hero = profile.kind === "child" || part !== "hero" ? undefined : featured[index];
  if (part === "rows") return <>{rows.map((r) => <VodRow key={r.genre} title={translateLabel(r.genre, "fr")} items={r.items} />)}</>;
  return (
    <>
      {hero && (
        <section className="hero" key={hero.id} aria-label="À la une">
          <div className="hero-art" aria-hidden="true">
            <LazyImg src={hero.backdrop ?? hero.poster!} alt="" referrerPolicy="no-referrer" unload={false} />
          </div>
          <div className="hero-text">
            <span className="hero-kicker">À la une</span>
            <h2 className="hero-title">{hero.title}</h2>
            <p className="hero-meta">
              {[hero.year, hero.rating ? `★ ${hero.rating.toFixed(1)}` : null, ...(hero.genres ?? []).slice(0, 3).map((g) => translateLabel(g, "fr"))].filter(Boolean).join("  ·  ")}
            </p>
            {hero.plot && <p className="hero-plot">{hero.plot}</p>}
            <div className="row">
              <button className="btn btn-primary hero-play" onClick={() => openItem(hero)}>
                <Icon name="play" /> Regarder
              </button>
              <button className="btn hero-more" onClick={() => useUi.setState({ detailId: hero.id })}>
                <Icon name="info" /> Plus d'infos
              </button>
            </div>
          </div>
          {featured.length > 1 && (
            <div className="hero-dots" role="tablist" aria-label="Contenus à la une">
              {featured.map((f, i) => (
                <button key={f.id} role="tab" aria-selected={i === index} aria-label={f.title} className={i === index ? "on" : ""} onClick={() => setIndex(i)} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
