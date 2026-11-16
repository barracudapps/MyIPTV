import { locale, setUiLanguage, t, UI_LANGUAGES, uiLanguage } from "../lib/t";

import { TraktCard } from "./TraktCard";
import { useActiveProfile, useSettings, type Chattiness } from "../store/settings";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import { LANGUAGES, langFlag, langName } from "../lib/languages";
import { ACHIEVEMENTS, playSound, say, celebrate } from "../lib/fun";
import { Range, Segmented, Toggle } from "./ThemeEditor";
import { MASCOTS, MascotFigure, type MascotKind } from "./Mascot";
import { NAV_ITEMS } from "./Nav";
import { Icon } from "./Icon";
import { Dropdown } from "./Dropdown";

export function ExtraSettings({ section }: { section: "languages" | "meta" | "fun" | "menu" }) {
  if (section === "languages") return <LanguageSettings />;
  if (section === "meta") return <MetaSettings />;
  if (section === "fun") return <FunSettings />;
  return <MenuSettings />;
}

/** Langues favorites ordonnées : elles trient chaînes, films, recherches et choisissent l'audio. */
function LanguageSettings() {
  const profile = useActiveProfile()!;
  const langs = profile.languages;
  const set = (l: string[]) => useSettings.getState().setLanguages(l);
  const move = (i: number, d: number) => {
    const next = [...langs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set(next);
  };
  return (
    <div className="settings-section">
      <h2>{t("Langue de l'interface")}</h2>
      <div className="segmented ui-language">
        {UI_LANGUAGES.map((l) => (
          <button key={l.code} className={uiLanguage() === l.code ? "active" : ""} onClick={() => l.code !== uiLanguage() && setUiLanguage(l.code)}>
            {l.label}
          </button>
        ))}
      </div>
      <h2>{t("Langues favorites de « {name} »", { name: profile.name })}</h2>
      <p className="dim">
        {t("Dans cet ordre, elles servent à trier les chaînes, les films, les séries, la musique et les résultats de recherche, à choisir automatiquement la piste audio et les sous-titres, et à sélectionner les guides des programmes à télécharger.")}
      </p>
      <ol className="lang-list">
        {langs.map((l, i) => (
          <li key={l} className="card row">
            <span className="lang-rank">{i + 1}</span>
            <span className="lang-flag">{langFlag(l)}</span>
            <strong className="grow">{langName(l)}</strong>
            <button className="icon-btn" title={t("Monter")} disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="up" />
            </button>
            <button className="icon-btn" title={t("Descendre")} disabled={i === langs.length - 1} onClick={() => move(i, 1)}>
              <Icon name="down" />
            </button>
            <button className="icon-btn" title={t("Retirer")} onClick={() => set(langs.filter((x) => x !== l))}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ol>
      {!langs.length && <p className="dim">{t("Aucune langue favorite : les contenus gardent l'ordre de leurs sources.")}</p>}
      <Dropdown<string>
        ariaLabel={t("Ajouter une langue")}
        placeholder={t("Ajouter une langue")}
        icon="plus"
        value=""
        onChange={(l) => set([...langs, l])}
        options={LANGUAGES.filter((l) => !langs.includes(l.code)).map((l) => ({ value: l.code, label: langName(l.code), prefix: l.flag }))}
      />
      <p className="dim small">{t("Les guides et sources intégrées (radios, podcasts, livres audio) suivent ces langues au prochain actualisation des sources.")}</p>
      <h3>{t("Lecture|settings")}</h3>
      <Toggle
        label={t("Choisir automatiquement l'audio et les sous-titres")}
        hint={t("Piste audio dans votre première langue disponible ; sous-titres si l'audio n'est dans aucune de vos langues.")}
        checked={profile.player.autoTracks}
        onChange={(v) => useSettings.getState().setPlayerPrefs({ autoTracks: v })}
      />
      <Toggle label={t("Toujours afficher les sous-titres")} checked={profile.player.subtitlesByDefault} onChange={(v) => useSettings.getState().setPlayerPrefs({ subtitlesByDefault: v })} />
    </div>
  );
}

function MetaSettings() {
  const meta = useSettings((s) => s.meta);
  const set = useSettings((s) => s.setMeta);
  return (
    <div className="settings-section">
      <h2>{t("Métadonnées (facultatif)")}</h2>
      <p className="dim">
        {t("Sans clé, MyIPTV affiche les informations fournies par vos sources. Avec ces clés gratuites, les fiches gagnent le casting avec photos, l'équipe, les bandes-annonces, les filmographies complètes et la note IMDb.")}
      </p>
      <label className="field">
        {t("Clé API TMDB (v3) ou jeton de lecture (v4)")}
        <input type="password" value={meta.tmdb} onChange={(e) => set({ tmdb: e.target.value.trim() })} placeholder="Coller la clé ici" autoComplete="off" />
      </label>
      <p className="dim small">{t("Gratuite : créez un compte sur themoviedb.org, puis Paramètres › API.")}</p>
      <label className="field">
        {t("Clé API OMDb (notes IMDb)")}
        <input type="password" value={meta.omdb} onChange={(e) => set({ omdb: e.target.value.trim() })} placeholder="Coller la clé ici" autoComplete="off" />
      </label>
      <p className="dim small">{t("Gratuite (1 000 requêtes par jour) sur omdbapi.com. Les réponses sont gardées en cache une semaine.")}</p>
      <TraktCard withApp />
    </div>
  );
}

function FunSettings() {
  const f = useSettings((s) => s.fun);
  const set = useSettings((s) => s.setFun);
  const profile = useActiveProfile()!;
  const unlocked = useSettings((s) => s.achievements[profile.id] ?? {});
  const stats = useSettings((s) => s.stats[profile.id]);
  const colors = ["#6d5dfc", "#22c3ee", "#f97316", "#22c55e", "#e11d48", "#eab308", "#64748b", "#ec4899", "#14b8a6", "#8b5a2b", "#1f2937", "#a3e635"];
  const kind = f.mascotKind ?? "zapi";
  const pickKind = (k: MascotKind) => {
    // Nom par défaut d'un personnage : on prend celui du nouveau ; un nom personnalisé est gardé.
    const isDefaultName = MASCOTS.some((m) => m.name === f.mascotName);
    set({ mascotKind: k, ...(isDefaultName ? { mascotName: MASCOTS.find((m) => m.kind === k)!.name } : {}) });
  };
  return (
    <div className="settings-section">
      <h2>{t("Fun")}</h2>
      <div className="card mascot-card">
        <MascotFigure mood="happy" color={f.mascotColor} kind={kind} size={96} />
        <div className="grow">
          <Toggle label={t("Mascotte")} hint={t("Un petit compagnon qui salue, donne des astuces et réagit à ce que vous regardez. Double-clic dessus pour le masquer jusqu'au prochain lancement.")} checked={f.mascot} onChange={(v) => set({ mascot: v })} />
          {f.mascot && (
            <>
              <div className="field">
                {t("Personnage")}
                <div className="mascot-picker" role="radiogroup" aria-label={t("Personnage")}>
                  {MASCOTS.map((m) => (
                    <button key={m.kind} role="radio" aria-checked={kind === m.kind} className={`mascot-option ${kind === m.kind ? "active" : ""}`} title={t(m.desc)} onClick={() => pickKind(m.kind)}>
                      <MascotFigure mood="idle" color={f.mascotColor} kind={m.kind} size={52} />
                      <span>{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                {t("Son nom")}
                <input value={f.mascotName} maxLength={20} onChange={(e) => set({ mascotName: e.target.value })} />
              </label>
              <div className="field">
                {t("Sa couleur")}
                <div className="avatar-picker">
                  {colors.map((c) => (
                    <button key={c} aria-label={c} className={c === f.mascotColor ? "active" : ""} style={{ background: c }} onClick={() => set({ mascotColor: c })} />
                  ))}
                </div>
              </div>
              <Segmented<Chattiness>
                label={t("Bavardage")}
                value={f.chattiness}
                options={[
                  ["quiet", t("Discret")],
                  ["normal", t("Normal")],
                  ["chatty", t("Bavard")],
                ]}
                onChange={(v) => set({ chattiness: v })}
              />
              <button className="btn" onClick={() => say(t("Salut, moi c'est {name} !", { name: f.mascotName }), "wave", 0)}>
                {t("Dire bonjour")}
              </button>
            </>
          )}
        </div>
      </div>
      <Toggle label={t("Sons d'interface")} hint={t("Petits sons synthétisés au clic, au zapping et pour les succès.")} checked={f.sounds} onChange={(v) => (set({ sounds: v }), v && setTimeout(() => playSound("success"), 50))} />
      {f.sounds && <Range label={t("Volume des sons")} value={f.soundVolume} min={0.1} max={1} step={0.1} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ soundVolume: v })} />}
      <Toggle label={t("Confettis")} hint={t("Pour les favoris et les succès.")} checked={f.confetti} onChange={(v) => (set({ confetti: v }), v && setTimeout(celebrate, 50))} />
      <Toggle label={t("Effet « neige » au zapping")} checked={f.zapEffect} onChange={(v) => set({ zapEffect: v })} />
      <Toggle label={t("Décorations de saison")} hint={t("Neige en hiver, citrouilles à Halloween…")} checked={f.seasonal} onChange={(v) => set({ seasonal: v })} />
      <Toggle label={t("Bouton « Surprends-moi »")} hint={t("Un contenu au hasard dans vos langues.")} checked={f.surprise} onChange={(v) => set({ surprise: v })} />
      <Toggle label={t("Secrets cachés")} hint={t("Il paraît qu'un vieux code de jeu vidéo fait quelque chose…")} checked={f.easterEggs} onChange={(v) => set({ easterEggs: v })} />
      <Toggle label={t("Succès")} checked={f.achievements} onChange={(v) => set({ achievements: v })} />

      {f.achievements && (
        <>
          <h3>
            <Icon name="trophy" /> {t("Succès de {name} ({n}/{total})", { name: profile.name, n: Object.keys(unlocked).length, total: ACHIEVEMENTS.length })}
          </h3>
          <div className="achievements">
            {ACHIEVEMENTS.map((a) => {
              const at = unlocked[a.id];
              return (
                <div key={a.id} className={`achievement ${at ? "on" : ""}`} title={at ? t("Débloqué le {date}", { date: new Date(at).toLocaleDateString(locale()) }) : t("À débloquer")}>
                  <span className="ach-icon">{at ? a.icon : "🔒"}</span>
                  <strong>{t(a.title)}</strong>
                  <span className="dim small">{a.id === "secret" && !at ? "???" : t(a.desc)}</span>
                </div>
              );
            })}
          </div>
          {stats && (
            <p className="dim small">
              {t("{plays} lectures · {zaps} zappings · {searches} recherches · radios de {countries} pays", { plays: stats.plays, zaps: stats.zaps, searches: stats.searches, countries: stats.radios.length })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function MenuSettings() {
  const hidden = useSettings((s) => s.hiddenSections);
  const counts = useLibrary((s) => s.vodCounts);
  const toggle = (v: string) => useSettings.getState().setHiddenSections(hidden.includes(v) ? hidden.filter((x) => x !== v) : [...hidden, v]);
  return (
    <div className="settings-section">
      <h2>{t("Menu")}</h2>
      <p className="dim">{t("Choisissez les sections affichées dans le menu. Les réglages restent toujours accessibles.")}</p>
      {NAV_ITEMS.filter(([v]) => v !== "settings").map(([v, label]) => (
        <Toggle
          key={v}
          label={t(label)}
          hint={v.startsWith("vod:") ? t("{n} contenus", { n: (counts[v.slice(4)] ?? 0).toLocaleString(locale()) }) : undefined}
          checked={!hidden.includes(v)}
          onChange={() => {
            toggle(v);
            if (useUi.getState().view === v) useUi.getState().setView("live");
          }}
        />
      ))}
    </div>
  );
}
