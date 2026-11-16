import { useEffect, useRef, useState } from "react";
import { useActiveProfile, useSettings } from "../store/settings";
import { Icon } from "./Icon";
import { t } from "../lib/t";

/** Bouton « Collections » d'une fiche : ajouter le contenu à une ou plusieurs collections. */
export function CollectionMenu({ itemId }: { itemId: string }) {
  const profile = useActiveProfile()!;
  const collections = profile.collections ?? [];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const inCount = collections.filter((c) => c.itemIds.includes(itemId)).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function create() {
    if (!name.trim()) return;
    useSettings.getState().createCollection(name, itemId);
    setName("");
  }

  return (
    <div className="collection-menu" ref={box}>
      <button className={`btn ${inCount ? "btn-on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="folder" /> {inCount ? t("Collections ({n})", { n: inCount }) : t("Collection")}
      </button>
      {open && (
        <div className="collection-pop" role="menu">
          {collections.map((c) => (
            <label key={c.id} className="collection-opt">
              <input type="checkbox" checked={c.itemIds.includes(itemId)} onChange={() => useSettings.getState().toggleInCollection(c.id, itemId)} />
              <span>{c.name}</span>
              <small className="dim">{c.itemIds.length}</small>
            </label>
          ))}
          {!collections.length && <p className="dim small">{t("Rangez vos contenus par thème : « Soirées d'hiver », « Pour les enfants »…")}</p>}
          <form className="collection-new" onSubmit={(e) => (e.preventDefault(), create())}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nouvelle collection")} maxLength={60} />
            <button className="btn btn-primary" disabled={!name.trim()}>
              {t("Créer")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
