import { useEffect, useState } from "react";
import { autoCheckEnabled, canUpdate, setAutoCheck, useUpdates } from "../lib/updater";
import { Toggle } from "./ThemeEditor";
import { Icon } from "./Icon";
import { t } from "../lib/t";

/** Vérification discrète au démarrage, puis bandeau si une version est disponible. */
export function UpdateBanner() {
  const { status, version, progress, install } = useUpdates();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!canUpdate || !autoCheckEnabled()) return;
    const timer = setTimeout(() => void useUpdates.getState().check(), 8000);
    return () => clearTimeout(timer);
  }, []);
  if (hidden || (status !== "available" && status !== "downloading" && status !== "ready")) return null;
  return (
    <div className="update-banner" role="status">
      <Icon name="download" />
      <span>
        {status === "available" && <>{t("MyIPTV {version} est disponible.", { version: version ?? "" })}</>}
        {status === "downloading" && <>{t("Téléchargement de la mise à jour… {pct} %", { pct: Math.round(progress * 100) })}</>}
        {status === "ready" && <>{t("Mise à jour installée, redémarrage…")}</>}
      </span>
      {status === "available" && (
        <>
          <button className="btn btn-primary" onClick={install}>{t("Mettre à jour")}</button>
          <button className="icon-btn" title={t("Plus tard")} onClick={() => setHidden(true)}>
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
      <h3><Icon name="download" /> {t("Mises à jour")}</h3>
      <Toggle label={t("Rechercher au démarrage")} hint={t("Depuis les versions publiées de MyIPTV, signées.")} checked={auto} onChange={(v) => (setAuto(v), setAutoCheck(v))} />
      <div className="row">
        {status === "available" ? (
          <button className="btn btn-primary" onClick={install}>{t("Installer la version {version}", { version: version ?? "" })}</button>
        ) : (
          <button className="btn" disabled={status === "checking" || status === "downloading"} onClick={check}>
            {status === "checking" ? t("Recherche…") : t("Rechercher maintenant")}
          </button>
        )}
        {status === "none" && <span className="dim small">{t("Vous avez la dernière version.")}</span>}
        {status === "downloading" && <span className="dim small">{t("Téléchargement… {pct} %", { pct: Math.round(progress * 100) })}</span>}
      </div>
      {status === "available" && notes && <p className="dim small update-notes">{notes}</p>}
      {status === "error" && <p className="error-text small">{t("Recherche impossible : {error}", { error: error ?? "" })}</p>}
    </div>
  );
}
