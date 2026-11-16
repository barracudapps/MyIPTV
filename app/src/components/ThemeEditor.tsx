import { useEffect, useState } from "react";
import { allThemes, themeFor, useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { applyTheme, COLOR_LABELS, type Theme, type ThemeColors, type ThemeLayout } from "../lib/themes";
import { uid } from "../lib/util";
import { Icon } from "./Icon";
import { t } from "../lib/t";

/** Choix du thème du profil actif + éditeur complet (couleurs, typographie, disposition des écrans). */
export function AppearanceSettings() {
  const profile = useActiveProfile()!;
  const custom = useSettings((s) => s.customThemes);
  const themes = allThemes(custom);
  const active = themeFor(profile, custom);
  const [draft, setDraft] = useState<Theme | null>(null);
  const [io, setIo] = useState(false);
  const animations = useSettings((s) => s.fun.animations !== false);

  const pick = (th: Theme) => useSettings.getState().updateProfile(profile.id, { themeId: th.id });

  return (
    <div className="settings-section">
      <h2>{t("Thème de « {name} »", { name: profile.name })}</h2>
      <div className="theme-grid">
        {themes.map((th) => (
          <div key={th.id} className={`theme-card ${th.id === active.id ? "active" : ""}`}>
            <button className="theme-swatch" onClick={() => pick(th)} style={{ background: th.colors.bg, color: th.colors.text, borderRadius: th.radius }}>
              <span style={{ background: th.colors.surface, borderRadius: th.radius / 2 }} />
              <span style={{ background: th.colors.accent, borderRadius: th.radius / 2 }} />
              <strong>{t(th.name)}</strong>
              {th.id === active.id && <Icon name="check" />}
            </button>
            <div className="row">
              <button className="link" onClick={() => setDraft({ ...structuredClone(th), id: th.builtin ? uid() : th.id, name: th.builtin ? t("{name} (perso)", { name: t(th.name) }) : th.name, builtin: false })}>
                {th.builtin ? t("Personnaliser") : t("Modifier")}
              </button>
              {!th.builtin && (
                <button className="link danger" onClick={() => useSettings.getState().removeTheme(th.id)}>
                  {t("Supprimer")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setDraft({ ...structuredClone(active), id: uid(), name: t("Mon écran"), builtin: false })}>
          <Icon name="palette" /> {t("Créer mon écran")}
        </button>
        <button className="btn" onClick={() => setIo(true)}>
          <Icon name="upload" /> {t("Importer / exporter")}
        </button>
      </div>
      <Toggle
        label={t("Animations")}
        hint={t("Ouverture des menus, fenêtres et écrans. À couper sur une TV peu puissante ; le réglage « réduire les animations » du système est toujours respecté.")}
        checked={animations}
        onChange={(v) => useSettings.getState().setFun({ animations: v })}
      />
      {draft && <Editor initial={draft} onClose={() => setDraft(null)} />}
      {io && <ThemeIO active={active} onClose={() => setIo(false)} />}
    </div>
  );
}

function Editor({ initial, onClose }: { initial: Theme; onClose(): void }) {
  const profile = useActiveProfile()!;
  const custom = useSettings((s) => s.customThemes);
  const [th, setT] = useState(initial);
  const toast = useUi((s) => s.toast);

  // Aperçu en direct sur toute l'application ; restauré à la fermeture.
  useEffect(() => applyTheme(th), [th]);
  useEffect(() => () => applyTheme(themeFor(useSettings.getState().profiles.find((p) => p.id === profile.id), useSettings.getState().customThemes)), [profile.id]);

  const color = (k: keyof ThemeColors, v: string) => setT({ ...th, colors: { ...th.colors, [k]: v } });
  const lay = <K extends keyof ThemeLayout>(k: K, v: ThemeLayout[K]) => setT({ ...th, layout: { ...th.layout, [k]: v } });
  const save = () => {
    useSettings.getState().saveTheme(th);
    useSettings.getState().updateProfile(profile.id, { themeId: th.id });
    toast(t("Écran « {name} » enregistré.", { name: th.name }), "success");
    onClose();
  };

  return (
    <div className="editor-panel" data-modal role="dialog" aria-label={t("Éditeur d'écran")}>
      <header>
        <h2>{t("Personnaliser l'écran")}</h2>
        <button className="icon-btn" onClick={onClose} title={t("Annuler")}>
          <Icon name="close" />
        </button>
      </header>
      <div className="editor-body">
        <label className="field">
          {t("Nom")}
          <input value={th.name} onChange={(e) => setT({ ...th, name: e.target.value })} />
        </label>

        <h3>{t("Couleurs")}</h3>
        <div className="color-grid">
          {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((k) => (
            <label key={k} className="color-field">
              <input type="color" value={th.colors[k]} onChange={(e) => color(k, e.target.value)} />
              {t(COLOR_LABELS[k])}
            </label>
          ))}
        </div>

        <h3>{t("Texte et formes")}</h3>
        <Segmented<Theme["font"]>
          label={t("Police")}
          value={th.font}
          options={[
            ["system", t("Système")],
            ["rounded", t("Arrondie")],
            ["serif", t("Classique")],
            ["mono", t("Machine")],
          ]}
          onChange={(v) => setT({ ...th, font: v })}
        />
        <Range label={t("Taille du texte")} value={th.fontScale} min={0.85} max={1.6} step={0.05} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => setT({ ...th, fontScale: v })} />
        <Range label={t("Arrondi des angles")} value={th.radius} min={0} max={28} step={1} fmt={(v) => `${v} px`} onChange={(v) => setT({ ...th, radius: v })} />

        <h3>{t("Disposition")}</h3>
        <Segmented
          label={t("Écran Direct")}
          value={th.layout.experience ?? "classic"}
          options={[["classic", t("Classique")], ["immersive", t("Salon")], ["guide", t("Programme TV")], ["magazine", t("Magazine")]]}
          onChange={(v) => lay("experience", v)}
        />
        <Segmented label={t("Vitrine des films")} value={th.layout.showcase ? "on" : "off"} options={[["off", t("Grille")], ["on", t("Bannière et rangées")]]} onChange={(v) => lay("showcase", v === "on")} />
        <Segmented label={t("Menu")} value={th.layout.nav} options={[["left", t("À gauche")], ["rail", t("Icônes")], ["top", t("En haut")], ["bottom", t("En bas")]]} onChange={(v) => lay("nav", v)} />
        <Segmented label={t("Lecteur")} value={th.layout.playerPosition} options={[["right", t("À droite")], ["left", t("À gauche")], ["top", t("En haut")]]} onChange={(v) => lay("playerPosition", v)} />
        <Range label={t("Taille du lecteur")} value={th.layout.playerSize} min={25} max={75} step={1} fmt={(v) => `${v} %`} onChange={(v) => lay("playerSize", v)} />
        <Segmented label={t("Chaînes")} value={th.layout.channelView} options={[["list", t("Liste")], ["grid", t("Mosaïque")]]} onChange={(v) => lay("channelView", v)} />
        <Segmented label={t("Densité")} value={th.layout.density} options={[["compact", t("Compacte")], ["comfortable", t("Confort")], ["tv", t("TV (grand)")]]} onChange={(v) => lay("density", v)} />
        <Range label={t("Taille des logos")} value={th.layout.logoSize} min={24} max={96} step={4} fmt={(v) => `${v} px`} onChange={(v) => lay("logoSize", v)} />
        <Toggle label={t("Programme en cours et suivant")} checked={th.layout.showNowNext} onChange={(v) => lay("showNowNext", v)} />
        <Toggle label={t("Barre de progression")} checked={th.layout.showProgress} onChange={(v) => lay("showProgress", v)} />
        <Toggle label={t("Catégories")} checked={th.layout.showGroups} onChange={(v) => lay("showGroups", v)} />
        <Toggle label={t("Horloge")} checked={th.layout.showClock} onChange={(v) => lay("showClock", v)} />
      </div>
      <footer className="actions">
        <button className="btn" onClick={onClose}>
          {t("Annuler")}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!th.name.trim()}>
          {custom.some((c) => c.id === th.id) ? t("Enregistrer") : t("Enregistrer mon écran")}
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
      const th = JSON.parse(text) as Theme;
      if (!th.colors || !th.layout) throw new Error();
      useSettings.getState().saveTheme({ ...th, id: uid(), builtin: false });
      toast(t("Thème importé."), "success");
      onClose();
    } catch {
      setError(t("Ce texte n'est pas un thème MyIPTV valide."));
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" data-modal role="dialog" aria-label={t("Importer ou exporter un thème")}>
        <header>
          <h2>{t("Importer / exporter un thème")}</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <p className="dim">{t("Copiez ce texte pour partager votre écran, ou collez celui d'un autre appareil.")}</p>
          <textarea className="mono" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          {error && <p className="error-text">{error}</p>}
          <div className="actions">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(text).then(() => toast(t("Copié.")))}>
              <Icon name="download" /> {t("Copier")}
            </button>
            <button className="btn btn-primary" onClick={doImport}>
              <Icon name="upload" /> {t("Importer")}
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
