import { useState } from "react";
import { useActiveProfile, useSettings, type Chattiness } from "../store/settings";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import { LANGUAGES, langFlag, langName } from "../lib/languages";
import { ACHIEVEMENTS, playSound, say, celebrate } from "../lib/fun";
import { Range, Segmented, Toggle } from "./ThemeEditor";
import { MascotFigure } from "./Mascot";
import { NAV_ITEMS } from "./Nav";
import { Icon } from "./Icon";

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
  const [adding, setAdding] = useState("");
  const move = (i: number, d: number) => {
    const next = [...langs];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    set(next);
  };
  return (
    <div className="settings-section">
      <h2>Langues favorites de « {profile.name} »</h2>
      <p className="dim">
        Dans cet ordre, elles servent à trier les chaînes, les films, les séries, la musique et les résultats de recherche, à choisir automatiquement la
        piste audio et les sous-titres, et à sélectionner les guides des programmes à télécharger.
      </p>
      <ol className="lang-list">
        {langs.map((l, i) => (
          <li key={l} className="card row">
            <span className="lang-rank">{i + 1}</span>
            <span className="lang-flag">{langFlag(l)}</span>
            <strong className="grow">{langName(l)}</strong>
            <button className="icon-btn" title="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
              <Icon name="up" />
            </button>
            <button className="icon-btn" title="Descendre" disabled={i === langs.length - 1} onClick={() => move(i, 1)}>
              <Icon name="down" />
            </button>
            <button className="icon-btn" title="Retirer" onClick={() => set(langs.filter((x) => x !== l))}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ol>
      {!langs.length && <p className="dim">Aucune langue favorite : les contenus gardent l'ordre de leurs sources.</p>}
      <div className="row">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Langue à ajouter">
          <option value="">Ajouter une langue…</option>
          {LANGUAGES.filter((l) => !langs.includes(l.code)).map((l) => (
            <option key={l.code} value={l.code}>
              {l.flag} {l.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          disabled={!adding}
          onClick={() => {
            set([...langs, adding]);
            setAdding("");
          }}
        >
          <Icon name="plus" /> Ajouter
        </button>
      </div>
      <p className="dim small">Les guides et sources intégrées (radios, podcasts, livres audio) suivent ces langues au prochain actualisation des sources.</p>
      <h3>Lecture</h3>
      <Toggle
        label="Choisir automatiquement l'audio et les sous-titres"
        hint="Piste audio dans votre première langue disponible ; sous-titres si l'audio n'est dans aucune de vos langues."
        checked={profile.player.autoTracks}
        onChange={(v) => useSettings.getState().setPlayerPrefs({ autoTracks: v })}
      />
      <Toggle label="Toujours afficher les sous-titres" checked={profile.player.subtitlesByDefault} onChange={(v) => useSettings.getState().setPlayerPrefs({ subtitlesByDefault: v })} />
    </div>
  );
}

function MetaSettings() {
  const meta = useSettings((s) => s.meta);
  const set = useSettings((s) => s.setMeta);
  return (
    <div className="settings-section">
      <h2>Métadonnées (facultatif)</h2>
      <p className="dim">
        Sans clé, MyIPTV affiche les informations fournies par vos sources. Avec ces clés gratuites, les fiches gagnent le casting avec photos, l'équipe,
        les bandes-annonces, les filmographies complètes et la note IMDb.
      </p>
      <label className="field">
        Clé API TMDB (v3) ou jeton de lecture (v4)
        <input type="password" value={meta.tmdb} onChange={(e) => set({ tmdb: e.target.value.trim() })} placeholder="Coller la clé ici" autoComplete="off" />
      </label>
      <p className="dim small">Gratuite : créez un compte sur themoviedb.org, puis Paramètres › API.</p>
      <label className="field">
        Clé API OMDb (notes IMDb)
        <input type="password" value={meta.omdb} onChange={(e) => set({ omdb: e.target.value.trim() })} placeholder="Coller la clé ici" autoComplete="off" />
      </label>
      <p className="dim small">Gratuite (1 000 requêtes par jour) sur omdbapi.com. Les réponses sont gardées en cache une semaine.</p>
    </div>
  );
}

function FunSettings() {
  const f = useSettings((s) => s.fun);
  const set = useSettings((s) => s.setFun);
  const profile = useActiveProfile()!;
  const unlocked = useSettings((s) => s.achievements[profile.id] ?? {});
  const stats = useSettings((s) => s.stats[profile.id]);
  const colors = ["#6d5dfc", "#22c3ee", "#f97316", "#22c55e", "#e11d48", "#eab308", "#64748b"];
  return (
    <div className="settings-section">
      <h2>Fun</h2>
      <div className="card mascot-card">
        <MascotFigure mood="happy" color={f.mascotColor} size={96} />
        <div className="grow">
          <Toggle label="Mascotte" hint="Un petit compagnon qui salue, donne des astuces et réagit à ce que vous regardez. Double-clic dessus pour le masquer jusqu'au prochain lancement." checked={f.mascot} onChange={(v) => set({ mascot: v })} />
          {f.mascot && (
            <>
              <label className="field">
                Son nom
                <input value={f.mascotName} maxLength={20} onChange={(e) => set({ mascotName: e.target.value })} />
              </label>
              <div className="field">
                Sa couleur
                <div className="avatar-picker">
                  {colors.map((c) => (
                    <button key={c} aria-label={c} className={c === f.mascotColor ? "active" : ""} style={{ background: c }} onClick={() => set({ mascotColor: c })} />
                  ))}
                </div>
              </div>
              <Segmented<Chattiness>
                label="Bavardage"
                value={f.chattiness}
                options={[
                  ["quiet", "Discret"],
                  ["normal", "Normal"],
                  ["chatty", "Bavard"],
                ]}
                onChange={(v) => set({ chattiness: v })}
              />
              <button className="btn" onClick={() => say(`Salut, moi c'est ${f.mascotName} !`, "wave", 0)}>
                Dire bonjour
              </button>
            </>
          )}
        </div>
      </div>
      <Toggle label="Sons d'interface" hint="Petits sons synthétisés au clic, au zapping et pour les succès." checked={f.sounds} onChange={(v) => (set({ sounds: v }), v && setTimeout(() => playSound("success"), 50))} />
      {f.sounds && <Range label="Volume des sons" value={f.soundVolume} min={0.1} max={1} step={0.1} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => set({ soundVolume: v })} />}
      <Toggle label="Confettis" hint="Pour les favoris et les succès." checked={f.confetti} onChange={(v) => (set({ confetti: v }), v && setTimeout(celebrate, 50))} />
      <Toggle label="Effet « neige » au zapping" checked={f.zapEffect} onChange={(v) => set({ zapEffect: v })} />
      <Toggle label="Décorations de saison" hint="Neige en hiver, citrouilles à Halloween…" checked={f.seasonal} onChange={(v) => set({ seasonal: v })} />
      <Toggle label="Bouton « Surprends-moi »" hint="Un contenu au hasard dans vos langues." checked={f.surprise} onChange={(v) => set({ surprise: v })} />
      <Toggle label="Secrets cachés" hint="Il paraît qu'un vieux code de jeu vidéo fait quelque chose…" checked={f.easterEggs} onChange={(v) => set({ easterEggs: v })} />
      <Toggle label="Succès" checked={f.achievements} onChange={(v) => set({ achievements: v })} />

      {f.achievements && (
        <>
          <h3>
            <Icon name="trophy" /> Succès de {profile.name} ({Object.keys(unlocked).length}/{ACHIEVEMENTS.length})
          </h3>
          <div className="achievements">
            {ACHIEVEMENTS.map((a) => {
              const at = unlocked[a.id];
              return (
                <div key={a.id} className={`achievement ${at ? "on" : ""}`} title={at ? `Débloqué le ${new Date(at).toLocaleDateString("fr-FR")}` : "À débloquer"}>
                  <span className="ach-icon">{at ? a.icon : "🔒"}</span>
                  <strong>{a.title}</strong>
                  <span className="dim small">{a.id === "secret" && !at ? "???" : a.desc}</span>
                </div>
              );
            })}
          </div>
          {stats && (
            <p className="dim small">
              {stats.plays} lectures · {stats.zaps} zappings · {stats.searches} recherches · radios de {stats.radios.length} pays
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
      <h2>Menu</h2>
      <p className="dim">Choisissez les sections affichées dans le menu. Les réglages restent toujours accessibles.</p>
      {NAV_ITEMS.filter(([v]) => v !== "settings").map(([v, label]) => (
        <Toggle
          key={v}
          label={`${label}`}
          hint={v.startsWith("vod:") ? `${(counts[v.slice(4)] ?? 0).toLocaleString("fr-FR")} contenus` : undefined}
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
