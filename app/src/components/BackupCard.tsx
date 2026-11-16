import { useRef, useState } from "react";
import { canEncrypt, exportBackup, isSealed, readBackup } from "../lib/backup";
import type { SharePayload } from "../lib/share";
import { useUi } from "../store/ui";
import { track } from "../store/activity";
import { ReceivePreview } from "./ShareSettings";
import { Toggle } from "./ThemeEditor";
import { Icon } from "./Icon";
import { t } from "../lib/t";

/** Sauvegarde de toute la configuration dans un fichier, et restauration. */
export function BackupCard() {
  const toast = useUi((s) => s.toast);
  const [history, setHistory] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [unlock, setUnlock] = useState("");
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await track(t("Sauvegarde de la configuration"), () => exportBackup({ history, password: password || undefined }));
      toast(t("Sauvegarde enregistrée : {where}", { where: r.where }), "success");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(text: string, pass?: string) {
    setError(null);
    try {
      setPayload(await readBackup(text, pass));
      setPending(null);
      setUnlock("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    if (isSealed(text)) {
      setPending(text);
      setError(null);
    } else void open(text);
  }

  if (payload) return <ReceivePreview payload={payload} onDone={() => setPayload(null)} />;

  return (
    <div className="card">
      <h3><Icon name="save" /> {t("Sauvegarde dans un fichier")}</h3>
      <p className="dim small">
        {t("Sources, comptes, profils, favoris, thèmes et réglages dans un fichier")} <code>.myiptv</code>
        {t(", à garder ou à ouvrir sur un autre appareil. Le contenu adulte n'est jamais réactivé par une restauration.")}
      </p>
      <Toggle label={t("Inclure l'historique de visionnage")} hint={t("Reprises de lecture de chaque profil.")} checked={history} onChange={setHistory} />
      {canEncrypt && (
        <label className="field">
          {t("Mot de passe (facultatif)")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Chiffre le fichier : comptes et clés protégés")} autoComplete="new-password" />
        </label>
      )}
      {!password && <p className="dim small">{t("Sans mot de passe, les identifiants des comptes sont lisibles dans le fichier.")}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          <Icon name="download" /> {busy ? t("Sauvegarde…") : t("Sauvegarder")}
        </button>
        <button className="btn" onClick={() => input.current?.click()}>
          <Icon name="upload" /> {t("Restaurer…")}
        </button>
        <input ref={input} type="file" accept=".myiptv,.json,application/json" hidden onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
      {pending && (
        <form className="row" onSubmit={(e) => (e.preventDefault(), void open(pending, unlock))}>
          <label className="field">
            {t("Mot de passe de la sauvegarde")}
            <input type="password" autoFocus value={unlock} onChange={(e) => setUnlock(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="btn btn-primary" disabled={!unlock}>{t("Ouvrir")}</button>
          <button type="button" className="btn" onClick={() => (setPending(null), setError(null))}>{t("Annuler")}</button>
        </form>
      )}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}
