import { useEffect, useState } from "react";
import { getBackend, type Backend, type RemoteInfo } from "../platform";
import { startTask } from "../store/activity";
import { Icon } from "./Icon";
import { t } from "../lib/t";

/** Réglages › Télécommande : QR code à scanner avec le téléphone. */
export function RemoteSettings() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      void getBackend().then(async (b) => {
        setBackend(b);
        setInfo((await b.remote?.active().catch(() => null)) ?? null);
      }),
    [],
  );

  useEffect(() => {
    if (!info) return;
    const task = startTask(t("Télécommande ouverte"), { detail: info.addresses[0] });
    return () => task.end();
  }, [info]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setInfo(await backend!.remote!.start());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    await backend?.remote?.stop();
    setInfo(null);
  }

  return (
    <div className="settings-section">
      <h2>{t("Télécommande")}</h2>
      <p className="dim">
        {t("Pilotez MyIPTV depuis votre téléphone : flèches et OK, lecture, chaînes, volume, et un clavier pour rechercher. Le téléphone doit être sur le même réseau Wi-Fi. Rien ne passe par Internet.")}
      </p>
      {!backend?.remote ? (
        backend && <p className="card dim">{t("La télécommande s'ouvre depuis l'application de bureau ou Android.")}</p>
      ) : info ? (
        <div className="card remote-card">
          <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qrSvg }} />
          <div>
            <h3>
              <Icon name="phone" /> {t("Scannez avec l'appareil photo du téléphone")}
            </h3>
            <p className="dim small">{t("Ou ouvrez cette adresse dans son navigateur :")}</p>
            <code className="remote-url">{info.url}</code>
            <p className="dim small">{t("L'adresse contient un code secret : ne la partagez pas. La télécommande se ferme après 2 heures sans téléphone connecté.")}</p>
            <button className="btn" onClick={stop}>
              {t("Fermer la télécommande")}
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <button className="btn btn-primary" disabled={busy} onClick={start}>
            <Icon name="phone" /> {busy ? t("Ouverture…") : t("Ouvrir la télécommande")}
          </button>
          {error && <p className="error-text small">{error}</p>}
        </div>
      )}
    </div>
  );
}
