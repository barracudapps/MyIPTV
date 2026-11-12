import { useEffect, useState } from "react";
import { allThemes, themeFor, useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { applyTheme, COLOR_LABELS, type Theme, type ThemeColors, type ThemeLayout } from "../lib/themes";
import { uid } from "../lib/util";
import { Icon } from "./Icon";

/** Choix du thème du profil actif + éditeur complet (couleurs, typographie, disposition des écrans). */
export function AppearanceSettings() {
  const profile = useActiveProfile()!;
  const custom = useSettings((s) => s.customThemes);
  const themes = allThemes(custom);
  const active = themeFor(profile, custom);
  const [draft, setDraft] = useState<Theme | null>(null);
  const [io, setIo] = useState(false);

  const pick = (t: Theme) => useSettings.getState().updateProfile(profile.id, { themeId: t.id });

  return (
    <div className="settings-section">
      <h2>Thème de « {profile.name} »</h2>
      <div className="theme-grid">
        {themes.map((t) => (
          <div key={t.id} className={`theme-card ${t.id === active.id ? "active" : ""}`}>
            <button className="theme-swatch" onClick={() => pick(t)} style={{ background: t.colors.bg, color: t.colors.text, borderRadius: t.radius }}>
              <span style={{ background: t.colors.surface, borderRadius: t.radius / 2 }} />
              <span style={{ background: t.colors.accent, borderRadius: t.radius / 2 }} />
              <strong>{t.name}</strong>
              {t.id === active.id && <Icon name="check" />}
            </button>
            <div className="row">
              <button className="link" onClick={() => setDraft({ ...structuredClone(t), id: t.builtin ? uid() : t.id, name: t.builtin ? `${t.name} (perso)` : t.name, builtin: false })}>
                {t.builtin ? "Personnaliser" : "Modifier"}
              </button>
              {!t.builtin && (
                <button className="link danger" onClick={() => useSettings.getState().removeTheme(t.id)}>
                  Supprimer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setDraft({ ...structuredClone(active), id: uid(), name: "Mon écran", builtin: false })}>
          <Icon name="palette" /> Créer mon écran
        </button>
        <button className="btn" onClick={() => setIo(true)}>
          <Icon name="upload" /> Importer / exporter
        </button>
      </div>
      {draft && <Editor initial={draft} onClose={() => setDraft(null)} />}
      {io && <ThemeIO active={active} onClose={() => setIo(false)} />}
    </div>
  );
}

function Editor({ initial, onClose }: { initial: Theme; onClose(): void }) {
  const profile = useActiveProfile()!;
  const custom = useSettings((s) => s.customThemes);
  const [t, setT] = useState(initial);
  const toast = useUi((s) => s.toast);

  // Aperçu en direct sur toute l'application ; restauré à la fermeture.
  useEffect(() => applyTheme(t), [t]);
  useEffect(() => () => applyTheme(themeFor(useSettings.getState().profiles.find((p) => p.id === profile.id), useSettings.getState().customThemes)), [profile.id]);

  const color = (k: keyof ThemeColors, v: string) => setT({ ...t, colors: { ...t.colors, [k]: v } });
  const lay = <K extends keyof ThemeLayout>(k: K, v: ThemeLayout[K]) => setT({ ...t, layout: { ...t.layout, [k]: v } });
  const save = () => {
    useSettings.getState().saveTheme(t);
    useSettings.getState().updateProfile(profile.id, { themeId: t.id });
    toast(`Écran « ${t.name} » enregistré.`, "success");
    onClose();
  };

  return (
    <div className="editor-panel" data-modal role="dialog" aria-label="Éditeur d'écran">
      <header>
        <h2>Personnaliser l'écran</h2>
        <button className="icon-btn" onClick={onClose} title="Annuler">
          <Icon name="close" />
        </button>
      </header>
      <div className="editor-body">
        <label className="field">
          Nom
          <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </label>

        <h3>Couleurs</h3>
        <div className="color-grid">
          {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((k) => (
            <label key={k} className="color-field">
              <input type="color" value={t.colors[k]} onChange={(e) => color(k, e.target.value)} />
              {COLOR_LABELS[k]}
            </label>
          ))}
        </div>

        <h3>Texte et formes</h3>
        <label className="field">
          Police
          <select value={t.font} onChange={(e) => setT({ ...t, font: e.target.value as Theme["font"] })}>
            <option value="system">Système</option>
            <option value="rounded">Arrondie</option>
            <option value="serif">Avec empattements</option>
            <option value="mono">Chasse fixe</option>
          </select>
        </label>
        <Range label="Taille du texte" value={t.fontScale} min={0.85} max={1.6} step={0.05} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => setT({ ...t, fontScale: v })} />
        <Range label="Arrondi des angles" value={t.radius} min={0} max={28} step={1} fmt={(v) => `${v} px`} onChange={(v) => setT({ ...t, radius: v })} />

        <h3>Disposition</h3>
        <Segmented label="Menu" value={t.layout.nav} options={[["left", "À gauche"], ["top", "En haut"], ["bottom", "En bas"]]} onChange={(v) => lay("nav", v)} />
        <Segmented label="Lecteur" value={t.layout.playerPosition} options={[["right", "À droite"], ["left", "À gauche"], ["top", "En haut"]]} onChange={(v) => lay("playerPosition", v)} />
        <Range label="Taille du lecteur" value={t.layout.playerSize} min={25} max={75} step={1} fmt={(v) => `${v} %`} onChange={(v) => lay("playerSize", v)} />
        <Segmented label="Chaînes" value={t.layout.channelView} options={[["list", "Liste"], ["grid", "Mosaïque"]]} onChange={(v) => lay("channelView", v)} />
        <Segmented label="Densité" value={t.layout.density} options={[["compact", "Compacte"], ["comfortable", "Confort"], ["tv", "TV (grand)"]]} onChange={(v) => lay("density", v)} />
        <Range label="Taille des logos" value={t.layout.logoSize} min={24} max={96} step={4} fmt={(v) => `${v} px`} onChange={(v) => lay("logoSize", v)} />
        <Toggle label="Programme en cours et suivant" checked={t.layout.showNowNext} onChange={(v) => lay("showNowNext", v)} />
        <Toggle label="Barre de progression" checked={t.layout.showProgress} onChange={(v) => lay("showProgress", v)} />
        <Toggle label="Catégories" checked={t.layout.showGroups} onChange={(v) => lay("showGroups", v)} />
        <Toggle label="Horloge" checked={t.layout.showClock} onChange={(v) => lay("showClock", v)} />
      </div>
      <footer className="actions">
        <button className="btn" onClick={onClose}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!t.name.trim()}>
          {custom.some((c) => c.id === t.id) ? "Enregistrer" : "Enregistrer mon écran"}
        </button>
      </footer>
    </div>
  );
}

function ThemeIO({ active, onClose }: { active: Theme; onClose(): void }) {
  const [text, setText] = useState(JSON.stringify(active, null, 2));
  const [error, setError] = useState<string | null>(null);
  const toast = useUi((s) => s.toast);
  const doImport = () => {
    try {
      const t = JSON.parse(text) as Theme;
      if (!t.colors || !t.layout) throw new Error();
      useSettings.getState().saveTheme({ ...t, id: uid(), builtin: false });
      toast("Thème importé.", "success");
      onClose();
    } catch {
      setError("Ce texte n'est pas un thème MyIPTV valide.");
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" data-modal role="dialog" aria-label="Importer ou exporter un thème">
        <header>
          <h2>Importer / exporter un thème</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <p className="dim">Copiez ce texte pour partager votre écran, ou collez celui d'un autre appareil.</p>
          <textarea className="mono" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <p className="error-text">{error}</p>}
          <div className="actions">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Copié."))}>
              <Icon name="download" /> Copier
            </button>
            <button className="btn btn-primary" onClick={doImport}>
              <Icon name="upload" /> Importer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Range({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt(v: number): string; onChange(v: number): void }) {
  return (
    <label className="field range">
      <span>
        {label} <output>{fmt(value)}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small className="dim">{hint}</small>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div className="field">
      {label}
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
