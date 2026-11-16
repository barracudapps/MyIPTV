import { useEffect, useState } from "react";
import { autoCheckEnabled, canUpdate, setAutoCheck, useUpdates } from "../lib/updater";
import { Toggle } from "./ThemeEditor";
import { Icon } from "./Icon";

/** Vérification discrète au démarrage, puis bandeau si une version est disponible. */
export function UpdateBanner() {
  const { status, version, progress, install } = useUpdates();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!canUpdate || !autoCheckEnabled()) return;
    const t = setTimeout(() => void useUpdates.getState().check(), 8000);
    return () => clearTimeout(t);
  }, []);
  if (hidden || (status !== "available" && status !== "downloading" && status !== "ready")) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="download" />
      <span>
        {status === "available" && <>MyIPTV {version} est disponible.</>}
        {status === "downloading" && <>Téléchargement de la mise à jour… {Math.round(progress * 100)} %</>}
        {status === "ready" && <>Mise à jour installée, redémarrage…</>}
      </span>
      {status === "available" && (
        <>
          <button className="btn btn-primary" onClick={install}>Mettre à jour</button>
          <button className="icon-btn" title="Plus tard" onClick={() => setHidden(true)}>
            <Icon name="close" />
          </button>
        </>
      )}
    </div>
  );
}

/** Carte « Mises à jour » de la page À propos. */
export function UpdateCard() {
  const { status, version, notes, progress, error, check, install } = useUpdates();
  const [auto, setAuto] = useState(autoCheckEnabled);
  if (!canUpdate) return null;
  return (
    <div className="card">
      <h3><Icon name="download" /> Mises à jour</h3>
      <Toggle label="Rechercher au démarrage" hint="Depuis les versions publiées de MyIPTV, signées." checked={auto} onChange={(v) => (setAuto(v), setAutoCheck(v))} />
      <div className="row">
        {status === "available" ? (
          <button className="btn btn-primary" onClick={install}>Installer la version {version}</button>
        ) : (
          <button className="btn" disabled={status === "checking" || status === "downloading"} onClick={check}>
            {status === "checking" ? "Recherche…" : "Rechercher maintenant"}
          </button>
        )}
        {status === "none" && <span className="dim small">Vous avez la dernière version.</span>}
        {status === "downloading" && <span className="dim small">Téléchargement… {Math.round(progress * 100)} %</span>}
      </div>
      {status === "available" && notes && <p className="dim small update-notes">{notes}</p>}
      {status === "error" && <p className="error-text small">Recherche impossible : {error}</p>}
    </div>
  );
}
