import { useActiveProfile } from "../store/settings";
import { useUi } from "../store/ui";
import { langFlag, langName } from "../lib/languages";
import type { Facet } from "../types";
import { Icon } from "./Icon";
import { Dropdown } from "./Dropdown";
import { translateLabel } from "../lib/i18n";

/** Langue d'affichage des catégories : première langue favorite du profil. */
function useDisplayLang() {
  return useActiveProfile()?.languages[0];
}

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

/** Traduit le filtre de langue en paramètres de requête. */
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
 * Filtre de langue en un seul menu : « Toutes », « Mes langues », puis les langues
 * favorites et les autres langues présentes, avec leur nombre de contenus.
 */
export function LangSelect({ available }: { available?: Facet[] }) {
  const profile = useActiveProfile()!;
  const value = useUi((s) => s.langFilter);
  const prefs = profile.languages;
  const count = (code: string) => available?.find((f) => f.name === code)?.count;
  const others = (available ?? []).filter((f) => !prefs.includes(f.name));
  return (
    <Dropdown<string>
      ariaLabel="Langue"
      icon="globe"
      value={value}
      active={value !== "all"}
      onChange={(v) => useUi.setState({ langFilter: v })}
      options={[
        { value: "all", label: "Toutes les langues" },
        ...(prefs.length ? [{ value: "mine", label: "Mes langues", prefix: <Icon name="heart" size={13} /> }] : []),
        ...prefs.map((l) => ({ value: l, label: langName(l), prefix: langFlag(l), hint: count(l) != null ? String(count(l)) : undefined })),
        ...others.map((o) => ({ value: o.name, label: langName(o.name), prefix: langFlag(o.name), hint: String(o.count) })),
      ]}
    />
  );
}

/** Menu des catégories (recherche intégrée), langues favorites en tête, libellés nettoyés. */
export function CategorySelect({ categories, value, onChange, langFilter }: { categories: Facet[]; value?: string; onChange(c?: string): void; langFilter: string }) {
  const profile = useActiveProfile()!;
  const lang = useDisplayLang();
  const visible = categories.filter((c) => c.name === value || langMatch(langFilter, profile.languages, c.language ? [c.language] : undefined));
  if (visible.length < 2) return null;
  return (
    <Dropdown<string>
      ariaLabel="Catégorie"
      icon="grid"
      value={value ?? ""}
      active={!!value}
      onChange={(v) => onChange(v || undefined)}
      options={[
        { value: "", label: "Toutes les catégories" },
        ...visible.map((c) => ({ value: c.name, label: translateLabel(c.label, lang), prefix: c.language ? langFlag(c.language) : undefined, hint: String(c.count) })),
      ]}
    />
  );
}

/**
 * Onglets discrets (genres, groupes de chaînes) : une seule ligne défilante,
 * l'onglet actif souligné. Plus léger qu'une rangée de pilules.
 */
export function FilterTabs({ items, value, onChange, allLabel }: { items: Facet[]; value?: string; onChange(v?: string): void; allLabel: string }) {
  const lang = useDisplayLang();
  if (!items.length) return null;
  return (
    <div className="filter-tabs" role="tablist">
      <button role="tab" aria-selected={!value} className={!value ? "active" : ""} onClick={() => onChange(undefined)}>
        {allLabel}
      </button>
      {items.map((f) => (
        <button key={f.name} role="tab" aria-selected={value === f.name} className={value === f.name ? "active" : ""} onClick={() => onChange(value === f.name ? undefined : f.name)} title={f.name}>
          {f.language && <span className="flag">{langFlag(f.language)}</span>}
          {translateLabel(f.label, lang)}
          <small>{f.count}</small>
        </button>
      ))}
    </div>
  );
}
