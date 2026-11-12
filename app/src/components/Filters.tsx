import { useMemo, useState } from "react";
import { useActiveProfile } from "../store/settings";
import { useUi } from "../store/ui";
import { langFlag, langName } from "../lib/languages";
import { normalize } from "../lib/util";
import type { Facet } from "../types";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";

/** Drapeaux de langue posés sur une vignette (affiche, logo). */
export function LangBadge({ langs, max = 2 }: { langs?: string[]; max?: number }) {
  if (!langs?.length) return null;
  return (
    <span className="lang-badge" title={langs.map(langName).join(", ")}>
      {langs.slice(0, max).map((l) => (
        <span key={l}>{langFlag(l)}</span>
      ))}
      {langs.length > max && <small>+{langs.length - max}</small>}
    </span>
  );
}

/** Traduit le filtre rapide de langue en paramètres de requête. */
export function langQuery(filter: string, prefs: string[]) {
  if (filter === "all" || (filter === "mine" && !prefs.length)) return {};
  if (filter === "mine") return { anyLanguages: prefs, includeUnknownLanguage: true };
  return { language: filter };
}

export function langMatch(filter: string, prefs: string[], langs: string[] | undefined) {
  if (filter === "all" || (filter === "mine" && !prefs.length)) return true;
  if (filter === "mine") return !langs?.length || langs.some((l) => prefs.includes(l));
  return !!langs?.includes(filter);
}

/**
 * Filtre rapide de langue : « Mes langues » (défaut), « Toutes », chacune des langues
 * favorites, puis les autres langues présentes dans un menu.
 */
export function LangBar({ available }: { available?: Facet[] }) {
  const profile = useActiveProfile()!;
  const value = useUi((s) => s.langFilter);
  const set = (v: string) => useUi.setState({ langFilter: v });
  const prefs = profile.languages;
  const others = (available ?? []).filter((f) => !prefs.includes(f.name));
  const count = (code: string) => available?.find((f) => f.name === code)?.count;
  return (
    <div className="lang-bar" role="radiogroup" aria-label="Langue">
      {prefs.length > 0 && (
        <button role="radio" aria-checked={value === "mine"} className={value === "mine" ? "active" : ""} onClick={() => set("mine")} title="Contenus dans mes langues favorites (et ceux dont la langue est inconnue)">
          <Icon name="heart" size={14} filled={value === "mine"} /> Mes langues
        </button>
      )}
      <button role="radio" aria-checked={value === "all"} className={value === "all" ? "active" : ""} onClick={() => set("all")}>
        <Icon name="globe" size={14} /> Toutes
      </button>
      {prefs.map((l) => (
        <button key={l} role="radio" aria-checked={value === l} className={value === l ? "active" : ""} onClick={() => set(l)} title={langName(l)}>
          <span className="flag">{langFlag(l)}</span> {langName(l)}
          {count(l) != null && <small>{count(l)}</small>}
        </button>
      ))}
      {others.length > 0 && (
        <select
          value={others.some((o) => o.name === value) ? value : ""}
          onChange={(e) => e.target.value && set(e.target.value)}
          aria-label="Autre langue"
          className={others.some((o) => o.name === value) ? "active" : ""}
        >
          <option value="">Autre langue…</option>
          {others.map((o) => (
            <option key={o.name} value={o.name}>
              {langFlag(o.name)} {langName(o.name)} ({o.count})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Libellé d'une catégorie avec son drapeau. */
export function CategoryLabel({ f }: { f: Facet }) {
  return (
    <>
      {f.language && <span className="flag">{langFlag(f.language)}</span>} {f.label}
    </>
  );
}

/**
 * Catégories ergonomiques : les plus pertinentes en puces (langues favorites d'abord,
 * libellés nettoyés), et toutes les autres dans un panneau avec recherche, groupées par langue.
 */
export function CategoryBar({
  categories,
  genres,
  category,
  genre,
  onCategory,
  onGenre,
  langFilter,
}: {
  categories: Facet[];
  genres: Facet[];
  category?: string;
  genre?: string;
  onCategory(c?: string): void;
  onGenre(g?: string): void;
  langFilter: string;
}) {
  const profile = useActiveProfile()!;
  const [open, setOpen] = useState(false);
  const visibleCats = useMemo(() => categories.filter((c) => langMatch(langFilter, profile.languages, c.language ? [c.language] : undefined)), [categories, langFilter, profile.languages]);
  const top = visibleCats.slice(0, 14);
  const selectedCat = categories.find((c) => c.name === category);

  return (
    <div className="category-bar">
      {genres.length > 0 && (
        <div className="chips" aria-label="Genres">
          <button className={`chip ${!genre ? "active" : ""}`} onClick={() => onGenre(undefined)}>
            Tous genres
          </button>
          {genres.slice(0, 24).map((g) => (
            <button key={g.name} className={`chip ${genre === g.name ? "active" : ""}`} onClick={() => onGenre(genre === g.name ? undefined : g.name)}>
              {g.label} <span>{g.count}</span>
            </button>
          ))}
        </div>
      )}
      {visibleCats.length > 1 && (
        <div className="chips" aria-label="Catégories">
          <button className={`chip ${!category ? "active" : ""}`} onClick={() => onCategory(undefined)}>
            Toutes catégories
          </button>
          {selectedCat && !top.includes(selectedCat) && (
            <button className="chip active" onClick={() => onCategory(undefined)}>
              <CategoryLabel f={selectedCat} /> <Icon name="close" size={12} />
            </button>
          )}
          {top.map((c) => (
            <button key={c.name} className={`chip ${category === c.name ? "active" : ""}`} onClick={() => onCategory(category === c.name ? undefined : c.name)} title={c.name}>
              <CategoryLabel f={c} /> <span>{c.count}</span>
            </button>
          ))}
          {visibleCats.length > top.length && (
            <button className="chip more" onClick={() => setOpen(true)}>
              <Icon name="grid" size={14} /> Toutes les catégories ({visibleCats.length})
            </button>
          )}
        </div>
      )}
      {open && (
        <CategoryPicker
          categories={visibleCats}
          current={category}
          onPick={(c) => {
            onCategory(c);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function CategoryPicker({ categories, current, onPick, onClose }: { categories: Facet[]; current?: string; onPick(c?: string): void; onClose(): void }) {
  const profile = useActiveProfile()!;
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const n = normalize(q.trim());
    const filtered = categories.filter((c) => !n || normalize(c.label).includes(n) || normalize(c.name).includes(n));
    const by = new Map<string, Facet[]>();
    for (const c of filtered) {
      const k = c.language ?? "";
      by.set(k, [...(by.get(k) ?? []), c]);
    }
    const rank = (l: string) => {
      const i = profile.languages.indexOf(l);
      return l === "" ? 999 : i < 0 ? 100 : i;
    };
    return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
  }, [categories, q, profile.languages]);

  return (
    <Modal title="Toutes les catégories" onClose={onClose} wide>
      <div className="search-field">
        <Icon name="search" size={18} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une catégorie" />
      </div>
      <div className="category-groups">
        {groups.map(([lang, list]) => (
          <section key={lang || "none"}>
            <h3>{lang ? `${langFlag(lang)} ${langName(lang)}` : "Autres"}</h3>
            <div className="browse-tiles">
              {list
                .sort((a, b) => a.label.localeCompare(b.label, "fr"))
                .map((c) => (
                  <button key={c.name} className={`browse-tile ${current === c.name ? "active" : ""}`} onClick={() => onPick(c.name)} title={c.name}>
                    <strong>{c.label}</strong>
                    <span>{c.count}</span>
                  </button>
                ))}
            </div>
          </section>
        ))}
        {!groups.length && <p className="dim">Aucune catégorie ne correspond.</p>}
      </div>
    </Modal>
  );
}
