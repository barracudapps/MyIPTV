import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { normalize } from "../lib/util";
import { Icon } from "./Icon";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Emoji ou icône affiché avant le libellé. */
  prefix?: ReactNode;
  hint?: string;
}

/**
 * Menu déroulant au style de l'application (remplace les `<select>` natifs,
 * dont l'apparence varie selon le système et détonne à côté des puces).
 * Recherche intégrée au-delà de 10 options ; utilisable au clavier et à la télécommande.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = "Choisir…",
  icon,
  ariaLabel,
  active,
}: {
  value: T | "";
  options: DropdownOption<T>[];
  onChange(v: T): void;
  /** Préfixe fixe du bouton, ex. « Tri : ». */
  label?: string;
  placeholder?: string;
  icon?: string;
  ariaLabel: string;
  /** Mise en avant (filtre actif). */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const searchable = options.length > 10;
  const shown = useMemo(() => {
    const n = normalize(q.trim());
    return n ? options.filter((o) => normalize(o.label).includes(n)) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    // Focus sur la recherche ou sur l'option sélectionnée.
    requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>(".dd-search input, .dd-option.on, .dd-option") ?? null)?.focus());
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
    ref.current?.querySelector<HTMLElement>(".dd-button")?.focus();
  };

  return (
    <div
      className={`dd ${open ? "open" : ""}`}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          e.preventDefault();
          setOpen(false);
          ref.current?.querySelector<HTMLElement>(".dd-button")?.focus();
        }
      }}
    >
      <button className={`dd-button ${active ? "active" : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} size={15} />}
        {label && <span className="dd-label">{label}</span>}
        {current?.prefix && <span className="dd-prefix">{current.prefix}</span>}
        <span className="dd-value">{current?.label ?? placeholder}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="dd-menu" role="listbox" aria-label={ariaLabel} data-modal>
          {searchable && (
            <div className="dd-search">
              <Icon name="search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher dans la liste" />
            </div>
          )}
          <div className="dd-options">
            {shown.map((o) => (
              <button key={o.value} role="option" aria-selected={o.value === value} className={`dd-option ${o.value === value ? "on" : ""}`} onClick={() => pick(o.value)}>
                {o.prefix && <span className="dd-prefix">{o.prefix}</span>}
                <span className="grow">{o.label}</span>
                {o.hint && <span className="dd-hint">{o.hint}</span>}
                {o.value === value && <Icon name="check" size={14} />}
              </button>
            ))}
            {!shown.length && <p className="dim small dd-empty">Aucun résultat.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
