import { useEffect, useMemo, useState } from "react";
import { getBackend, type Backend, type ShareInfo, type ShareStatus } from "../platform";
import { applyPayload, buildPayload, parsePayload, shareableSources, type SharePayload } from "../lib/share";
import { useSettings } from "../store/settings";
import { askPin, useUi } from "../store/ui";
import { useLibrary } from "../store/library";
import { startTask, track } from "../store/activity";
import { Toggle } from "./ThemeEditor";
import { Icon } from "./Icon";

const LAST_ADDRESS_KEY = "myiptv-share-address";

function readLastAddress(): string {
  try {
    return localStorage.getItem(LAST_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function ShareSettings() {
  const [backend, setBackend] = useState<Backend | null>(null);
  useEffect(() => void getBackend().then(setBackend), []);
  return (
    <div className="settings-section">
      <h2>Partage en réseau</h2>
      <p className="dim">
        Copiez vos sources, comptes et réglages vers un autre appareil du même réseau (TV, téléphone, autre ordinateur) sans rien ressaisir. Le
        transfert est chiffré par un code à usage limité, valable 10 minutes.
      </p>
      {backend?.share ? <SendCard backend={backend} /> : backend && <p className="card dim">L'envoi se fait depuis l'application de bureau ou Android ; cet appareil peut recevoir.</p>}
      {backend && <ReceiveCard backend={backend} />}
    </div>
  );
}

function SendCard({ backend }: { backend: Backend }) {
  const all = useSettings((s) => s.sources);
  const meta = useSettings((s) => s.meta);
  const themes = useSettings((s) => s.customThemes);
  const sources = useMemo(() => shareableSources(all), [all]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sources.map((s) => s.id)));
  const [withMeta, setWithMeta] = useState(true);
  const [withProfiles, setWithProfiles] = useState(true);
  const [withThemes, setWithThemes] = useState(true);
  const [withSettings, setWithSettings] = useState(true);
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasKeys = !!(meta.tmdb || meta.omdb);

  const sharing = !!info && status?.active !== false;
  useEffect(() => {
    if (!sharing || !info) return;
    const task = startTask("Partage réseau ouvert", { detail: `Code ${info.code}` });
    return () => task.end();
  }, [sharing, info]);
  useEffect(() => {
    if (!info) return;
    const tick = () => backend.share!.status().then(setStatus, () => {});
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, [info, backend]);
  useEffect(() => () => void backend.share?.stop(), [backend]);

  const withCredentials = sources.some((s) => picked.has(s.id) && (s.kind === "xtream" || s.kind === "jellyfin")) || (withMeta && hasKeys);
  const nothing = !picked.size && !(withMeta && hasKeys) && !withProfiles && !(withThemes && themes.length) && !withSettings;

  async function start() {
    setError(null);
    if (withCredentials && !(await askPin("Partager des comptes", "Les identifiants des comptes sélectionnés seront transmis à l'appareil qui saisira le code."))) return;
    setBusy(true);
    try {
      const payload = await buildPayload({ sourceIds: [...picked], meta: withMeta, profiles: withProfiles, themes: withThemes, settings: withSettings });
      setStatus(null);
      setInfo(await backend.share!.start(JSON.stringify(payload)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    await backend.share!.stop();
    setInfo(null);
    setStatus(null);
  }

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  if (info) {
    const active = status?.active ?? true;
    const minutes = Math.max(0, Math.ceil((info.expiresAt - Date.now() / 1000) / 60));
    const address = info.addresses[0] ?? "adresse introuvable";
    const portSuffix = info.port === 47820 ? "" : `:${info.port}`;
    return (
      <div className="card share-live">
        <h3><Icon name="upload" /> Partage ouvert</h3>
        {active ? (
          <>
            <p className="dim">Sur l'autre appareil : Réglages › Partage en réseau › Recevoir, puis saisissez :</p>
            <dl className="share-code">
              <dt>Adresse</dt>
              <dd>{address}{portSuffix}</dd>
              {info.addresses.slice(1).map((a) => <dd key={a} className="dim small">ou {a}{portSuffix}</dd>)}
              <dt>Code</dt>
              <dd className="code">{info.code}</dd>
            </dl>
            <p className="dim small">
              {status?.downloads ? `Reçu par ${status.downloads} appareil${status.downloads > 1 ? "s" : ""}. ` : "En attente d'un appareil… "}
              Se ferme dans {minutes} min, ou après 10 codes erronés.
            </p>
          </>
        ) : (
          <p className="dim">Partage terminé{status?.downloads ? ` : reçu par ${status.downloads} appareil${status.downloads > 1 ? "s" : ""}` : ""}.</p>
        )}
        <button className="btn" onClick={stop}>{active ? "Arrêter le partage" : "Fermer"}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3><Icon name="upload" /> Envoyer vers un autre appareil</h3>
      {sources.length > 0 && (
        <fieldset className="share-pick">
          <legend>Sources et comptes</legend>
          {sources.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
              <span>{s.name}</span>
              <span className="dim small">{s.kind === "xtream" ? "Xtream Codes" : s.kind === "jellyfin" ? "Jellyfin" : "M3U"}</span>
            </label>
          ))}
        </fieldset>
      )}
      {hasKeys && <Toggle label="Clés de métadonnées (TMDB, OMDb)" checked={withMeta} onChange={setWithMeta} />}
      <Toggle label="Profils" hint="Avec favoris, langues et préférences ; l'historique reste sur cet appareil." checked={withProfiles} onChange={setWithProfiles} />
      {themes.length > 0 && <Toggle label={`Thèmes personnalisés (${themes.length})`} checked={withThemes} onChange={setWithThemes} />}
      <Toggle label="Réglages" hint="Lecture, menu, fun, code PIN et protections. Le contenu adulte n'est jamais activé à distance." checked={withSettings} onChange={setWithSettings} />
      {withCredentials && <p className="small warn-text"><Icon name="lock" /> Contient des identifiants : ne communiquez le code qu'à vos propres appareils.</p>}
      {error && <p className="error-text small">{error}</p>}
      <button className="btn btn-primary" disabled={busy || nothing} onClick={start}>
        {busy ? "Préparation…" : "Ouvrir le partage"}
      </button>
    </div>
  );
}

function ReceiveCard({ backend }: { backend: Backend }) {
  const [address, setAddress] = useState(readLastAddress);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SharePayload | null>(null);

  async function fetchShare() {
    setError(null);
    setBusy(true);
    try {
      const p = parsePayload(await track("Réception d'une configuration", backend.shareFetch(address, code), address));
      try {
        localStorage.setItem(LAST_ADDRESS_KEY, address.trim());
      } catch {
        /* préférence facultative */
      }
      setPayload(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (payload) return <ReceivePreview payload={payload} onDone={() => (setPayload(null), setCode(""))} />;

  return (
    <div className="card">
      <h3><Icon name="download" /> Recevoir d'un autre appareil</h3>
      <p className="dim small">Ouvrez le partage sur l'appareil qui a la configuration, puis recopiez son adresse et son code.</p>
      <form className="row" onSubmit={(e) => (e.preventDefault(), fetchShare())}>
        <label className="field">
          Adresse
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20" inputMode="decimal" autoComplete="off" />
        </label>
        <label className="field">
          Code
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} />
        </label>
        <button className="btn btn-primary" disabled={busy || !address.trim() || code.replace(/[^a-z0-9]/gi, "").length < 8}>
          {busy ? "Réception…" : "Recevoir"}
        </button>
      </form>
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

function ReceivePreview({ payload, onDone }: { payload: SharePayload; onDone(): void }) {
  const toast = useUi((s) => s.toast);
  const currentPin = useSettings((s) => s.parental.pinHash);
  const [sources, setSources] = useState(true);
  const [meta, setMeta] = useState(true);
  const [profiles, setProfiles] = useState(true);
  const [themes, setThemes] = useState(true);
  const [settings, setSettings] = useState(true);
  const pinChanges = !!payload.settings && payload.settings.parental.pinHash !== currentPin;

  function apply() {
    const r = applyPayload(payload, { sources, meta, profiles, themes, settings });
    const parts = [
      r.sources && `${r.sources} source${r.sources > 1 ? "s" : ""}`,
      r.profiles && `${r.profiles} profil${r.profiles > 1 ? "s" : ""}`,
      r.themes && `${r.themes} thème${r.themes > 1 ? "s" : ""}`,
      r.settings && "réglages",
      r.meta && "clés de métadonnées",
    ].filter(Boolean);
    toast(parts.length ? `Importé : ${parts.join(", ")}.` : "Rien de nouveau : tout était déjà sur cet appareil.", "success");
    if (r.sources) useLibrary.getState().loadAll();
    onDone();
  }

  return (
    <div className="card">
      <h3><Icon name="download" /> Configuration reçue</h3>
      <p className="dim small">Rien n'est supprimé sur cet appareil : les éléments déjà présents sont conservés.</p>
      {!!payload.sources?.length && (
        <Toggle label={`Sources et comptes (${payload.sources.length})`} hint={payload.sources.map((s) => s.name).join(" · ")} checked={sources} onChange={setSources} />
      )}
      {payload.meta && <Toggle label="Clés de métadonnées" checked={meta} onChange={setMeta} />}
      {!!payload.profiles?.length && (
        <Toggle label={`Profils (${payload.profiles.length})`} hint={payload.profiles.map((p) => `${p.avatar} ${p.name}`).join(" · ")} checked={profiles} onChange={setProfiles} />
      )}
      {!!payload.themes?.length && <Toggle label={`Thèmes personnalisés (${payload.themes.length})`} checked={themes} onChange={setThemes} />}
      {payload.settings && (
        <Toggle
          label="Réglages"
          hint={pinChanges ? "Le code PIN de l'appareil d'origine remplacera celui de cet appareil." : "Lecture, menu, fun et contrôle parental."}
          checked={settings}
          onChange={setSettings}
        />
      )}
      <div className="row">
        <button className="btn" onClick={onDone}>Annuler</button>
        <button className="btn btn-primary" onClick={apply}>Importer</button>
      </div>
    </div>
  );
}
