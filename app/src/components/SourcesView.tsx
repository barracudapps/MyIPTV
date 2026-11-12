import { useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { CATALOG_ALL, CATALOG_CATEGORIES, CATALOG_COUNTRIES, CATALOG_LANGUAGES, type CatalogEntry } from "../lib/catalog";
import { errorMessage, uid } from "../lib/util";
import { LEGAL_TEST_LIST, SUSPICIOUS_TEST_LIST } from "../lib/testLists";
import type { RiskReport, Source, SourceKind } from "../types";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";

type Tab = "catalog" | "url" | "file" | "xtream" | "jellyfin" | "test";

export function SourcesView() {
  const sources = useSettings((s) => s.sources);
  const errors = useLibrary((s) => s.errors);
  const channels = useLibrary((s) => s.channels);
  const epgStats = useLibrary((s) => s.epgStats);
  const loading = useLibrary((s) => s.loading);
  const epgLoading = useLibrary((s) => s.epgLoading);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);

  const count = (id: string) => channels.filter((c) => c.sourceId === id).length;
  const describe = (s: Source) => {
    switch (s.kind) {
      case "xtream":
        return `Xtream · ${s.server}`;
      case "m3uUrl":
        return s.url;
      case "m3uText":
        return "Fichier importé";
      case "archive":
        return "Internet Archive · domaine public / licences libres";
      case "radioBrowser":
        return `Radio Browser · ${s.countries.join(", ") || "monde"}`;
      case "podcasts":
        return `Apple Podcasts · ${s.countries.join(", ").toUpperCase()}`;
      case "librivox":
        return `LibriVox · ${s.languages.join(", ")}`;
      case "jellyfin":
        return `Serveur multimédia · ${s.server}`;
    }
  };

  const remove = async (s: Source) => {
    useSettings.getState().removeSource(s.id);
    await (await getBackend()).removeSource(s.id, true);
    useLibrary.getState().loadAll();
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Sources</h1>
          <p className="dim">
            {channels.length} chaînes chargées
            {epgStats ? ` · guide : ${epgStats.programmes.toLocaleString("fr-FR")} programmes` : ""}
            {epgLoading ? " · mise à jour du guide…" : ""}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => useLibrary.getState().loadAll(true)} disabled={loading}>
            <Icon name="refresh" /> Tout actualiser
          </button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Ajouter
          </button>
        </div>
      </header>

      {sources.length === 0 && (
        <div className="card notice">
          <strong>Bienvenue !</strong> Les sources gratuites et légales intégrées peuvent être réactivées ici. Commencez par le catalogue gratuit (chaînes publiques et gratuites du monde entier), ou ajoutez l'abonnement
          de votre fournisseur.
        </div>
      )}

      <ul className="source-list">
        {sources.map((s) => (
          <li key={s.id} className="card source">
            <label className="switch" title={s.enabled ? "Désactiver" : "Activer"}>
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => {
                  useSettings.getState().updateSource(s.id, { enabled: e.target.checked });
                  useLibrary.getState().loadAll();
                }}
              />
              <span />
            </label>
            <div className="source-info">
              <strong>
                {s.name} {s.builtin && <span className="mini-badge ok">gratuit et légal</span>}
              </strong>
              <span className="dim">
                {describe(s)}
                {count(s.id) > 0 && ` · ${count(s.id)} chaînes`}
                {s.risk && s.risk !== "low" && <span className="mini-badge warn">import à risque confirmé</span>}
              </span>
              {errors[s.id] && <span className="error-text">{errors[s.id]}</span>}
            </div>
            {!s.builtin && (
              <>
                <button className="icon-btn" title="Modifier" onClick={() => setEditing(s)}>
                  <Icon name="settings" />
                </button>
                <button className="icon-btn" title="Supprimer" onClick={() => remove(s)}>
                  <Icon name="trash" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {epgStats && epgStats.errors.length > 0 && (
        <div className="card">
          <strong>Guides en erreur</strong>
          <ul className="dim">
            {epgStats.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {epgStats?.missing && epgStats.missing.length > 0 && (
        <details className="card dim small">
          <summary>
            {epgStats.missing.length} guide{epgStats.missing.length > 1 ? "s" : ""} annoncé{epgStats.missing.length > 1 ? "s" : ""} par les listes
            {epgStats.missing.length > 1 ? " n'existent" : " n'existe"} plus sur leur serveur : ignoré{epgStats.missing.length > 1 ? "s" : ""}, nouvel essai dans une semaine.
          </summary>
          <ul>
            {epgStats.missing.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </details>
      )}

      {adding && <AddSourceDialog onClose={() => setAdding(false)} />}
      {editing && <EditSourceDialog source={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditSourceDialog({ source, onClose }: { source: Source; onClose(): void }) {
  const [name, setName] = useState(source.name);
  const [epg, setEpg] = useState(source.epgUrls.join("\n"));
  return (
    <Modal title="Modifier la source" onClose={onClose}>
      <label className="field">
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Guides XMLTV supplémentaires (un par ligne)
        <textarea rows={3} value={epg} onChange={(e) => setEpg(e.target.value)} placeholder="https://…/guide.xml.gz" />
      </label>
      <div className="actions">
        <button
          className="btn btn-primary"
          onClick={() => {
            useSettings.getState().updateSource(source.id, { name, epgUrls: epg.split(/\s+/).filter(Boolean) });
            useLibrary.getState().loadAll();
            onClose();
          }}
        >
          Enregistrer
        </button>
      </div>
    </Modal>
  );
}

function AddSourceDialog({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<Tab>("catalog");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [xt, setXt] = useState({ server: "", username: "", password: "" });
  const [jf, setJf] = useState({ server: "", username: "", password: "" });
  const [epg, setEpg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRisk, setPendingRisk] = useState<{ source: Source; report: RiskReport } | null>(null);
  const toast = useUi((s) => s.toast);
  const testMode = useSettings((s) => s.testMode);

  const commit = (source: Source) => {
    useSettings.getState().addSource(source);
    useLibrary.getState().loadAll();
    toast(`« ${source.name} » ajoutée.`, "success");
    onClose();
  };

  /** Télécharge et analyse la source avant de l'enregistrer. */
  const submit = async (kind: SourceKind, defaultName: string, trusted = false) => {
    const source = {
      ...kind,
      id: uid(),
      name: name.trim() || defaultName,
      epgUrls: epg.split(/\s+/).filter(Boolean),
      enabled: true,
      addedAt: Date.now(),
    } as Source;
    if (trusted) return commit(source);
    setBusy(true);
    setError(null);
    try {
      const preview = await (await getBackend()).previewSource(source);
      if (preview.risk.total === 0) throw new Error("Aucune chaîne trouvée dans cette source.");
      if (preview.risk.level === "low") commit(source);
      else setPendingRisk({ source: { ...source, risk: preview.risk.level }, report: preview.risk });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addCatalog = (e: CatalogEntry) => submit({ kind: "m3uUrl", url: e.url }, `Gratuit · ${e.name}`, true);

  if (pendingRisk) {
    return <RiskDialog report={pendingRisk.report} onCancel={() => setPendingRisk(null)} onConfirm={() => commit(pendingRisk.source)} />;
  }

  return (
    <Modal title="Ajouter une source" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {(
          [
            ["catalog", "Catalogue gratuit"],
            ["url", "Lien M3U"],
            ["file", "Fichier M3U"],
            ["xtream", "Xtream Codes"],
            ["jellyfin", "Jellyfin / Emby"],
            ...(testMode ? [["test", "🧪 Test"]] : []),
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "test" ? (
        <div className="catalog">
          <p className="dim">
            Mode test : deux listes d'exemple pour essayer le parcours d'ajout. La liste suspecte est simulée (adresses factices <code>example.invalid</code>) : elle ne
            contient aucun flux réel et sert uniquement à déclencher l'avertissement et la double confirmation.
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={() => submit({ kind: "m3uText", content: LEGAL_TEST_LIST }, "Test · liste légale")}>
              <Icon name="check" /> Ajouter une liste légale
            </button>
            <button className="btn" disabled={busy} onClick={() => submit({ kind: "m3uText", content: SUSPICIOUS_TEST_LIST }, "Test · liste suspecte (simulée)")}>
              <Icon name="alert" /> Ajouter une liste suspecte simulée
            </button>
          </div>
        </div>
      ) : tab === "catalog" ? (
        <div className="catalog">
          <p className="dim">
            Chaînes diffusées gratuitement par leurs éditeurs (télévisions publiques, chaînes en clair, chaînes gratuites financées par la publicité), recensées
            par le projet communautaire iptv-org. Certaines peuvent être géo-restreintes à leur pays.
          </p>
          <button className="btn btn-primary" onClick={() => addCatalog(CATALOG_ALL)}>
            <Icon name="plus" /> {CATALOG_ALL.name} <span className="dim">({CATALOG_ALL.hint})</span>
          </button>
          <CatalogGroup title="Par pays" entries={CATALOG_COUNTRIES} onPick={addCatalog} />
          <CatalogGroup title="Par langue" entries={CATALOG_LANGUAGES} onPick={addCatalog} />
          <CatalogGroup title="Par thème" entries={CATALOG_CATEGORIES} onPick={addCatalog} />
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (tab === "jellyfin") {
              setBusy(true);
              setError(null);
              getBackend()
                .then((b) => b.jellyfinLogin(jf.server.trim(), jf.username, jf.password))
                .then((r) => submit({ kind: "jellyfin", server: r.server, userId: r.userId, token: r.token }, r.serverName ?? "Mon serveur multimédia", true))
                .catch((err) => setError(errorMessage(err)))
                .finally(() => setBusy(false));
              return;
            }
            if (tab === "url") submit({ kind: "m3uUrl", url: url.trim() }, new URL(url.trim()).hostname);
            else if (tab === "file") submit({ kind: "m3uText", content }, "Playlist importée");
            else submit({ kind: "xtream", ...xt, server: xt.server.trim() }, xt.server.replace(/^https?:\/\//, ""));
          }}
        >
          <label className="field">
            Nom (facultatif)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon fournisseur" />
          </label>
          {tab === "url" && (
            <label className="field">
              Adresse de la playlist
              <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/playlist.m3u" />
            </label>
          )}
          {tab === "file" && (
            <label className="field">
              Fichier .m3u / .m3u8
              <input
                required
                type="file"
                accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"
                onChange={async (e) => setContent((await e.target.files?.[0]?.text()) ?? "")}
              />
            </label>
          )}
          {tab === "jellyfin" && (
            <>
              <p className="dim small">
                Jellyfin (gratuit et libre) ou Emby : votre serveur multimédia personnel, avec vos propres films et séries. Ils apparaissent dans Films et Séries
                avec affiches, casting, saisons et reprise de lecture. Seul un jeton de connexion est conservé, jamais le mot de passe.
              </p>
              <label className="field">
                Adresse du serveur
                <input required value={jf.server} onChange={(e) => setJf({ ...jf, server: e.target.value })} placeholder="http://192.168.1.10:8096" />
              </label>
              <div className="row">
                <label className="field">
                  Utilisateur
                  <input required value={jf.username} onChange={(e) => setJf({ ...jf, username: e.target.value })} autoComplete="username" />
                </label>
                <label className="field">
                  Mot de passe
                  <input type="password" value={jf.password} onChange={(e) => setJf({ ...jf, password: e.target.value })} autoComplete="current-password" />
                </label>
              </div>
            </>
          )}
          {tab === "xtream" && (
            <>
              <label className="field">
                Serveur
                <input required value={xt.server} onChange={(e) => setXt({ ...xt, server: e.target.value })} placeholder="http://exemple.com:8080" />
              </label>
              <div className="row">
                <label className="field">
                  Identifiant
                  <input required value={xt.username} onChange={(e) => setXt({ ...xt, username: e.target.value })} autoComplete="off" />
                </label>
                <label className="field">
                  Mot de passe
                  <input required type="password" value={xt.password} onChange={(e) => setXt({ ...xt, password: e.target.value })} autoComplete="off" />
                </label>
              </div>
            </>
          )}
          <label className="field">
            Guide des programmes XMLTV (facultatif, un par ligne)
            <textarea rows={2} value={epg} onChange={(e) => setEpg(e.target.value)} placeholder="https://…/guide.xml.gz" />
          </label>
          <p className="dim small">
            Seuls les contenus que vous êtes autorisé à recevoir doivent être ajoutés. MyIPTV analyse chaque liste et vous prévient si elle présente les signes
            d'une offre illégale.
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? <div className="spinner small" /> : <Icon name="check" />} Vérifier et ajouter
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function CatalogGroup({ title, entries, onPick }: { title: string; entries: CatalogEntry[]; onPick(e: CatalogEntry): void }) {
  return (
    <section>
      <h3>{title}</h3>
      <div className="chips wrap">
        {entries.map((e) => (
          <button key={e.id} className="chip" onClick={() => onPick(e)}>
            {e.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Double validation avant l'import d'une liste suspecte : l'utilisateur doit
 * cocher l'attestation, puis confirmer une seconde fois après un court délai.
 */
function RiskDialog({ report, onCancel, onConfirm }: { report: RiskReport; onCancel(): void; onConfirm(): void }) {
  const [attested, setAttested] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [countdown, setCountdown] = useState(0);
  const high = report.level === "high";

  const toStep2 = () => {
    setStep(2);
    setCountdown(5);
    const t = setInterval(() => setCountdown((c) => (c <= 1 ? (clearInterval(t), 0) : c - 1)), 1000);
  };

  return (
    <Modal title={high ? "Cette liste semble illégale" : "Cette liste présente des signes suspects"} onClose={onCancel} wide>
      <div className={`risk ${high ? "risk-high" : "risk-medium"}`}>
        <Icon name="alert" size={32} />
        <div>
          <p>
            Sur {report.total} entrées, l'analyse a relevé :
          </p>
          <ul>
            {report.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {report.examples.length > 0 && <p className="dim small">Exemples : {report.examples.join(", ")}</p>}
        </div>
      </div>
      <div className="card">
        <p>
          <strong>Les chaînes payantes, le sport premium et les films ou séries récents ne sont jamais diffusés gratuitement ni à bas prix.</strong> Une
          offre de ce type est presque toujours une offre pirate, même si elle est vendue sur une boutique en ligne ou par un revendeur.
        </p>
        <ul className="dim">
          <li>Le téléchargement ou la diffusion d'œuvres sans autorisation est illégal dans la plupart des pays et passible d'amendes.</li>
          <li>Ces services disparaissent souvent sans préavis et sans remboursement.</li>
          <li>Les données de paiement et les applications associées sont un vecteur fréquent de fraude et de logiciels malveillants.</li>
          <li>La redevance audiovisuelle ne couvre pas les chaînes et plateformes payantes.</li>
        </ul>
        <p className="dim small">
          MyIPTV est un simple lecteur : il ne fournit aucun contenu et n'est pas responsable des sources que vous ajoutez. Vous êtes seul responsable de
          leur légalité.
        </p>
      </div>
      {step === 1 ? (
        <>
          <label className="check">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            J'atteste disposer d'un abonnement légal auprès du fournisseur de cette liste et des droits nécessaires pour la lire.
          </label>
          <div className="actions">
            <button className="btn btn-primary" onClick={onCancel}>
              Ne pas importer
            </button>
            <button className="btn" disabled={!attested} onClick={toStep2}>
              Continuer
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button className="btn btn-primary" onClick={onCancel}>
            Annuler l'import
          </button>
          <button className="btn btn-danger" disabled={countdown > 0} onClick={onConfirm}>
            {countdown > 0 ? `Confirmer définitivement (${countdown})` : "Confirmer définitivement"}
          </button>
        </div>
      )}
    </Modal>
  );
}
