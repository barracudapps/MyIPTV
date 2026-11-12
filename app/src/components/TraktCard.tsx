import { useEffect, useRef, useState } from "react";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { disconnect, importHistory, startDeviceAuth, waitForDevice, type DeviceCode } from "../lib/trakt";
import { errorMessage } from "../lib/util";
import { Icon } from "./Icon";

/** Connexion Trakt du profil actif ; `withApp` : réglage de l'application (administrateur). */
export function TraktCard({ withApp = false }: { withApp?: boolean }) {
  const profile = useActiveProfile()!;
  const meta = useSettings((s) => s.meta);
  const setMeta = useSettings((s) => s.setMeta);
  const toast = useUi((s) => s.toast);
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  const configured = !!(meta.traktClientId?.trim() && meta.traktClientSecret?.trim());
  if (profile.kind === "child") return null;
  if (!configured && !withApp) return null;

  async function connect() {
    setError(null);
    cancelled.current = false;
    try {
      const c = await startDeviceAuth();
      setCode(c);
      const session = await waitForDevice(c, () => cancelled.current);
      useSettings.getState().updateProfile(profile.id, { trakt: session });
      setCode(null);
      toast(`Trakt connecté${session.username ? ` (${session.username})` : ""}.`, "success");
      const n = await importHistory().catch(() => 0);
      if (n) toast(`${n} contenu${n > 1 ? "s" : ""} mis à jour depuis Trakt.`, "info");
    } catch (e) {
      setCode(null);
      if (!cancelled.current) setError(errorMessage(e));
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const n = await importHistory();
      toast(n ? `${n} contenu${n > 1 ? "s" : ""} mis à jour depuis Trakt.` : "Historique déjà à jour.", "success");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card trakt-card">
      <h3>
        <Icon name="history" /> Trakt
      </h3>
      <p className="dim small">
        Synchronise ce que {profile.name} regarde avec trakt.tv : films et épisodes marqués comme vus, reprise de lecture d'un appareil à l'autre. Les contenus sont
        reconnus par leur identifiant TMDB (fourni par la source ou par la clé TMDB ci-dessus).
      </p>
      {withApp && (
        <>
          <label className="field">
            Identifiant de l'application Trakt (Client ID)
            <input value={meta.traktClientId ?? ""} onChange={(e) => setMeta({ traktClientId: e.target.value.trim() })} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            Secret de l'application (Client Secret)
            <input type="password" value={meta.traktClientSecret ?? ""} onChange={(e) => setMeta({ traktClientSecret: e.target.value.trim() })} autoComplete="off" />
          </label>
          <p className="dim small">
            Gratuit : sur trakt.tv › Settings › Your API Apps, créez une application avec l'adresse de redirection <code>urn:ietf:wg:oauth:2.0:oob</code>, puis
            copiez ses deux identifiants ici.
          </p>
        </>
      )}
      {configured &&
        (profile.trakt ? (
          <div className="row">
            <span>
              <Icon name="check" /> Connecté{profile.trakt.username ? ` : ${profile.trakt.username}` : ""}
            </span>
            <button className="btn" disabled={busy} onClick={sync}>
              <Icon name="refresh" /> {busy ? "Synchronisation…" : "Synchroniser"}
            </button>
            <button className="btn" onClick={() => void disconnect()}>
              Déconnecter
            </button>
          </div>
        ) : code ? (
          <div className="trakt-code">
            <span className="dim">Sur un téléphone ou un ordinateur, ouvrez</span>
            <strong>{code.verificationUrl}</strong>
            <span className="dim">et saisissez le code</span>
            <span className="code">{code.userCode}</span>
            <button className="btn" onClick={() => ((cancelled.current = true), setCode(null))}>
              Annuler
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={connect}>
            Connecter {profile.name} à Trakt
          </button>
        ))}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}
