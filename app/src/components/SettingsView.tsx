import { BufferChoice } from "./BufferChoice";
import { useMemo, useState } from "react";
import { useActiveProfile, useSettings } from "../store/settings";
import { askPin, useUi } from "../store/ui";
import { useLibrary } from "../store/library";
import { getBackend } from "../platform";
import { hashPin, maxAge, type Profile, type ProfileKind } from "../lib/parental";
import { normalize } from "../lib/util";
import type { Channel, VodKind } from "../types";
import { AppearanceSettings, Range, Segmented, Toggle } from "./ThemeEditor";
import { ChannelLogo } from "./ChannelLogo";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";
import { ExtraSettings } from "./ExtraSettings";
import { ShareSettings } from "./ShareSettings";
import { RemoteSettings } from "./RemoteSettings";
import { UpdateCard } from "./Updates";
import { ConfirmButton } from "./VodView";
import { sectionOf } from "../lib/sections";
import { TraktCard } from "./TraktCard";
import { t, plural } from "../lib/t";

type Section = "appearance" | "languages" | "profiles" | "parental" | "playback" | "meta" | "fun" | "menu" | "share" | "remote" | "prevention" | "about";

export function SettingsView() {
  const profile = useActiveProfile()!;
  const isAdmin = profile.kind === "admin";
  const [section, setSection] = useState<Section>("appearance");
  const sections: [Section, string, string, boolean][] = [
    ["appearance", t("Apparence"), "palette", true],
    ["languages", t("Langues"), "globe", true],
    ["profiles", t("Profils"), "user", isAdmin],
    ["parental", t("Contrôle parental"), "shield", isAdmin],
    ["playback", t("Lecture|settings"), "play", true],
    ["meta", t("Métadonnées"), "info", isAdmin],
    ["fun", t("Fun & succès"), "trophy", true],
    ["menu", t("Menu"), "list", true],
    ["share", t("Partage et sauvegarde"), "upload", isAdmin],
    ["remote", t("Télécommande"), "phone", true],
    ["prevention", t("Reconnaître une offre illégale"), "alert", true],
    ["about", t("À propos"), "info", true],
  ];
  return (
    <div className="page settings">
      <nav className="settings-nav" aria-label={t("Sections des réglages")}>
        {sections
          .filter(([, , , shown]) => shown)
          .map(([id, label, icon]) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        {!isAdmin && <p className="dim small">{t("Les profils et le contrôle parental se gèrent depuis un profil administrateur.")}</p>}
      </nav>
      <div className="settings-content" key={section}>
        {section === "appearance" && <AppearanceSettings />}
        {section === "profiles" && isAdmin && <ProfilesSettings />}
        {section === "parental" && isAdmin && <ParentalSettings />}
        {section === "playback" && <PlaybackSettings />}
        {(section === "languages" || section === "meta" || section === "fun" || section === "menu") && <ExtraSettings section={section} />}
        {section === "share" && isAdmin && <ShareSettings />}
        {section === "remote" && <RemoteSettings />}
        {section === "prevention" && <Prevention />}
        {section === "about" && <About />}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<ProfileKind, string> = { admin: "Administrateur", standard: "Standard", child: "Enfant" };

function ProfilesSettings() {
  const profiles = useSettings((s) => s.profiles);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  return (
    <div className="settings-section">
      <h2>{t("Profils")}</h2>
      <p className="dim">{t("Chaque profil a ses favoris, son historique, son thème et ses écrans. Les profils enfants n'affichent que les contenus adaptés à leur âge.")}</p>
      <ul className="profile-list">
        {profiles.map((p) => (
          <li key={p.id} className="card row">
            <span className="avatar" style={{ background: p.color }}>
              {p.avatar}
            </span>
            <div className="grow">
              <strong>{p.name}</strong>
              <div className="dim small">
                {t(KIND_LABEL[p.kind])}
                {p.kind === "child" ? " · " + t("{age} ans · contenus jusqu'à -{max}", { age: p.child!.age, max: maxAge(p) }) : ""}
              </div>
            </div>
            <button className="btn" onClick={() => setEditing(p)}>
              {t("Modifier")}
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" onClick={() => setEditing("new")}>
        <Icon name="plus" /> {t("Nouveau profil")}
      </button>
      {editing && <ProfileDialog profile={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const AVATARS = ["🦊", "🐼", "🦁", "🐙", "🦄", "🐸", "🚀", "🎧", "🌵", "⚽", "🎮", "🌸", "🐶", "🐱", "🦖", "👾"];
const COLORS = ["#6d5dfc", "#22c3ee", "#f97316", "#22c55e", "#e11d48", "#eab308", "#0ea5e9", "#a855f7"];

function ProfileDialog({ profile, onClose }: { profile: Profile | null; onClose(): void }) {
  const profiles = useSettings((s) => s.profiles);
  const [name, setName] = useState(profile?.name ?? "");
  const [kind, setKind] = useState<ProfileKind>(profile?.kind ?? "standard");
  const [age, setAge] = useState(profile?.child?.age ?? 8);
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[profiles.length % AVATARS.length]);
  const [color, setColor] = useState(profile?.color ?? COLORS[profiles.length % COLORS.length]);
  const admins = profiles.filter((p) => p.kind === "admin");
  const lastAdmin = profile?.kind === "admin" && admins.length === 1;

  const save = () => {
    const s = useSettings.getState();
    if (profile) {
      s.updateProfile(profile.id, {
        name,
        kind,
        avatar,
        color,
        child: kind === "child" ? { ...(profile.child ?? { tolerance: 0, allowUnrated: true, whitelist: [], blacklist: [], blockedGroups: [], whitelistOnly: false }), age } : undefined,
      });
    } else {
      const p = s.addProfile(name, kind, age);
      s.updateProfile(p.id, { avatar, color });
    }
    onClose();
  };

  return (
    <Modal title={profile ? t("Modifier le profil") : t("Nouveau profil")} onClose={onClose}>
      <label className="field">
        {t("Prénom")}
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <Segmented<ProfileKind>
        label={t("Type")}
        value={kind}
        options={lastAdmin ? [["admin", t("Administrateur")]] : [["admin", t("Administrateur")], ["standard", t("Standard")], ["child", t("Enfant")]]}
        onChange={setKind}
      />
      {lastAdmin && <p className="dim small">{t("Il doit toujours rester au moins un administrateur.")}</p>}
      {kind === "child" && (
        <label className="field">
          {t("Âge")}
          <input type="number" min={1} max={17} value={age} onChange={(e) => setAge(Math.min(17, Math.max(1, +e.target.value)))} />
        </label>
      )}
      <div className="field">
        {t("Avatar")}
        <div className="avatar-picker">
          {AVATARS.map((a) => (
            <button key={a} className={a === avatar ? "active" : ""} onClick={() => setAvatar(a)}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        {t("Couleur")}
        <div className="avatar-picker">
          {COLORS.map((c) => (
            <button key={c} aria-label={c} className={c === color ? "active" : ""} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="actions">
        {profile && !lastAdmin && (
          <button
            className="btn btn-danger"
            onClick={() => {
              useSettings.getState().removeProfile(profile.id);
              onClose();
            }}
          >
            {t("Supprimer")}
          </button>
        )}
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          {t("Enregistrer")}
        </button>
      </div>
    </Modal>
  );
}

function ParentalSettings() {
  const parental = useSettings((s) => s.parental);
  const profiles = useSettings((s) => s.profiles);
  const set = useSettings((s) => s.setParental);
  const toast = useUi((s) => s.toast);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const children = profiles.filter((p) => p.kind === "child");

  const savePin = async () => {
    if (!/^\d{4,8}$/.test(pin)) return toast(t("Le code doit comporter 4 à 8 chiffres."), "error");
    if (pin !== pin2) return toast(t("Les deux codes ne correspondent pas."), "error");
    if (parental.pinHash && !(await askPin(t("Code actuel"), t("Saisissez le code parental actuel.")))) return;
    set({ pinHash: await hashPin(pin), pinIsDefault: false });
    setPin("");
    setPin2("");
    toast(t("Code parental enregistré."), "success");
  };

  return (
    <div className="settings-section">
      <h2>{t("Contrôle parental")}</h2>
      <div className="card">
        <h3>
          <Icon name="lock" /> {t("Code parental")} {parental.pinHash ? <span className="mini-badge ok">{t("actif")}</span> : <span className="mini-badge warn">{t("non défini")}</span>}
        </h3>
        <p className="dim small">{t("Il protège les contenus adultes, la sortie des profils enfants, les profils administrateurs et, si vous le souhaitez, les réglages.")}</p>
        {parental.pinHash && parental.pinIsDefault && (
          <p className="warn-text">
            <Icon name="alert" size={16} /> {t("Le code est encore celui par défaut :")} <strong>0000</strong>. {t("Changez-le pour protéger réellement vos réglages.")}
          </p>
        )}
        <div className="row">
          <input type="password" inputMode="numeric" placeholder={t("Nouveau code")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label={t("Nouveau code")} />
          <input type="password" inputMode="numeric" placeholder={t("Confirmer")} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} aria-label={t("Confirmer le code")} />
          <button className="btn btn-primary" onClick={savePin}>
            {parental.pinHash ? t("Changer") : t("Définir")}
          </button>
          {parental.pinHash && (
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!(await askPin(t("Supprimer le code"), t("Saisissez le code actuel pour le supprimer.")))) return;
                set({ pinHash: undefined, pinIsDefault: false });
                toast(t("Code parental supprimé : plus aucune protection par code."), "info");
              }}
            >
              {t("Supprimer le code")}
            </button>
          )}
        </div>
        <Toggle label={t("Protéger les réglages")} hint={t("Sources, profils et contrôle parental demandent le code.")} checked={parental.protectSettings} onChange={(v) => set({ protectSettings: v })} />
        <Toggle label={t("Verrouiller les profils enfants")} hint={t("Le code est demandé pour quitter un profil enfant.")} checked={parental.lockChildProfiles} onChange={(v) => set({ lockChildProfiles: v })} />
      </div>
      <div className="card">
        <h3>
          <Icon name="lock" /> {t("Contenus pour adultes")}
        </h3>
        <Toggle
          label={t("Autoriser les contenus pour adultes")}
          hint={t("Désactivé par défaut : ces chaînes et contenus sont alors totalement masqués. Activé, ils apparaissent verrouillés pour les profils adultes et le code est demandé une fois par session. Ils restent toujours invisibles pour les profils enfants. MyIPTV ne fournit aucun contenu de ce type : seules vos propres sources sont concernées.")}
          checked={parental.adultEnabled}
          onChange={async (v) => {
            if (v && !(await askPin(t("Autoriser les contenus pour adultes"), t("Confirmez avec le code parental.")))) return;
            set({ adultEnabled: v });
            useLibrary.getState().loadAll();
          }}
        />
        {parental.adultEnabled && !parental.pinHash && <p className="warn-text">{t("Aucun code n'est défini : les contenus pour adultes ne sont protégés par rien.")}</p>}
      </div>
      {children.length === 0 ? (
        <p className="dim">{t("Créez un profil enfant (section Profils) pour régler la tolérance par âge, les listes blanche et noire.")}</p>
      ) : (
        children.map((c) => <ChildRulesCard key={c.id} profile={c} />)
      )}
    </div>
  );
}

function ChildRulesCard({ profile }: { profile: Profile }) {
  const r = profile.child!;
  const update = (patch: Partial<typeof r>) => useSettings.getState().updateProfile(profile.id, { child: { ...r, ...patch } });
  const channels = useLibrary((s) => s.channels);
  const byId = useLibrary((s) => s.byId);
  const groups = useMemo(() => [...new Set(channels.flatMap((c) => (c.group ?? "").split(";").map((g) => g.trim())).filter(Boolean))].sort(), [channels]);
  const [picker, setPicker] = useState<"whitelist" | "blacklist" | null>(null);

  return (
    <div className="card">
      <h3>
        <span className="avatar small" style={{ background: profile.color }}>
          {profile.avatar}
        </span>
        {t("{name}, {age} ans", { name: profile.name, age: r.age })}
      </h3>
      <Range
        label={t("Tolérance d'âge")}
        value={r.tolerance}
        min={0}
        max={6}
        step={1}
        fmt={(v) => (v === 0 ? t("stricte (jusqu'à -{age})", { age: r.age }) : v > 1 ? t("+{n} ans (jusqu'à -{max})", { n: v, max: r.age + v }) : t("+{n} an (jusqu'à -{max})", { n: v, max: r.age + v }))}
        onChange={(v) => update({ tolerance: v })}
      />
      <p className="dim small">
        {t("Exemple : à {age} ans avec une tolérance de {tol}, un programme « -{blocked} » est bloqué, un programme « -{allowed} » est autorisé.", { age: r.age, tol: r.tolerance, blocked: r.age + r.tolerance + 1, allowed: r.age + r.tolerance })}
      </p>
      <Toggle
        label={t("Autoriser les programmes sans classification")}
        hint={t("Beaucoup de guides n'indiquent pas d'âge. Désactivé, seules les chaînes de la liste blanche restent regardables dans ce cas.")}
        checked={r.allowUnrated}
        onChange={(v) => update({ allowUnrated: v })}
      />
      <Toggle label={t("Uniquement la liste blanche")} hint={t("L'enfant ne voit que les chaînes que vous avez choisies.")} checked={r.whitelistOnly} onChange={(v) => update({ whitelistOnly: v })} />

      <ChannelListEditor title={t("Liste blanche (toujours autorisées)")} ids={r.whitelist} byId={byId} onRemove={(id) => update({ whitelist: r.whitelist.filter((x) => x !== id) })} onAdd={() => setPicker("whitelist")} />
      <ChannelListEditor title={t("Liste noire (toujours bloquées)")} ids={r.blacklist} byId={byId} onRemove={(id) => update({ blacklist: r.blacklist.filter((x) => x !== id) })} onAdd={() => setPicker("blacklist")} />

      {groups.length > 0 && (
        <div className="field">
          {t("Catégories bloquées")}
          <div className="chips wrap">
            {groups.slice(0, 80).map((g) => {
              const on = r.blockedGroups.includes(g);
              return (
                <button key={g} className={`chip ${on ? "active danger" : ""}`} onClick={() => update({ blockedGroups: on ? r.blockedGroups.filter((x) => x !== g) : [...r.blockedGroups, g] })}>
                  {on && <Icon name="lock" size={12} />} {g}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {picker && (
        <ChannelPicker
          title={picker === "whitelist" ? t("Ajouter à la liste blanche") : t("Ajouter à la liste noire")}
          exclude={new Set(r[picker])}
          onPick={(c) => update({ [picker]: [...r[picker], c.id] } as Partial<typeof r>)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function ChannelListEditor({ title, ids, byId, onRemove, onAdd }: { title: string; ids: string[]; byId: Map<string, Channel>; onRemove(id: string): void; onAdd(): void }) {
  return (
    <div className="field">
      {title}
      <div className="chips wrap">
        {ids.map((id) => {
          const c = byId.get(id);
          return (
            <span key={id} className="chip">
              {c ? <ChannelLogo channel={c} size={18} /> : null} {c?.name ?? t("Chaîne indisponible")}
              <button className="chip-x" title={t("Retirer")} onClick={() => onRemove(id)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          );
        })}
        <button className="chip" onClick={onAdd}>
          <Icon name="plus" size={14} /> {t("Ajouter")}
        </button>
      </div>
    </div>
  );
}

function ChannelPicker({ title, exclude, onPick, onClose }: { title: string; exclude: Set<string>; onPick(c: Channel): void; onClose(): void }) {
  const channels = useLibrary((s) => s.channels);
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const n = normalize(q);
    return channels.filter((c) => !exclude.has(c.id) && (!n || normalize(c.name).includes(n))).slice(0, 50);
  }, [channels, q, exclude]);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="search-field">
        <Icon name="search" size={18} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher une chaîne")} />
      </div>
      <ul className="hit-list compact">
        {results.map((c) => (
          <li key={c.id}>
            <button className="hit" onClick={() => onPick(c)}>
              <ChannelLogo channel={c} size={28} />
              <span className="hit-text">
                <strong>{c.name}</strong>
                <span className="dim">{c.group}</span>
              </span>
              <Icon name="plus" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PlaybackSettings() {
  const pb = useSettings((s) => s.playback);
  const testMode = useSettings((s) => s.testMode);
  const isAdmin = useActiveProfile()?.kind === "admin";
  const set = useSettings((s) => s.setPlayback);
  const [diskTs, setDiskTs] = useState<boolean | null>(null);
  getBackend().then((b) => setDiskTs(b.diskTimeshift));
  return (
    <div className="settings-section">
      <h2>{t("Lecture|settings")}</h2>
      <Toggle
        label={t("Pause du direct (timeshift)")}
        hint={diskTs === false ? t("Sur cet appareil, le retour arrière est limité à la mémoire du lecteur.") : t("Le direct est enregistré localement : pause, retour arrière et reprise au début du programme.")}
        checked={pb.timeshift}
        onChange={(v) => set({ timeshift: v })}
      />
      {pb.timeshift && (
        <div className="setting-block">
          <strong>{t("Durée de pause du direct")}</strong>
          <BufferChoice />
        </div>
      )}
      {isAdmin && (
        <Toggle
          label={t("Mode test")}
          hint={t("Ajoute un onglet « Test » dans Sources › Ajouter : une liste légale d'exemple et une liste suspecte simulée, pour vérifier l'analyse et la double confirmation.")}
          checked={testMode}
          onChange={(v) => useSettings.getState().setTestMode(v)}
        />
      )}
      <Toggle
        label={t("Chaînes non vérifiées des listes intégrées")}
        hint={t("Désactivé par défaut : les chaînes servies depuis une simple adresse IP sont le plus souvent des relais non officiels, sans garantie de légalité.")}
        checked={!!pb.includeUnverified}
        onChange={(v) => (set({ includeUnverified: v }), useLibrary.getState().loadAll())}
      />
      <Toggle
        label={t("Guide automatique")}
        hint={t("Ajoute les guides gratuits (epgshare01) des pays de vos langues, pour les chaînes dont la liste ne fournit pas de programme. Application et TV ; pas dans un simple navigateur.")}
        checked={pb.autoEpg !== false}
        onChange={(v) => (set({ autoEpg: v }), useLibrary.getState().loadAll())}
      />
      <Toggle
        label={t("Mode Hacker")}
        hint={t("Affiche par-dessus le lecteur les mesures techniques : images par seconde, images perdues, tampon, débit réel et estimé, codecs, processeur et mémoire. Raccourci : Ctrl+Maj+H.")}
        checked={!!pb.hacker}
        onChange={(v) => set({ hacker: v })}
      />
      <Toggle label={t("Reprendre la dernière chaîne au démarrage")} checked={pb.resumeLastChannel} onChange={(v) => set({ resumeLastChannel: v })} />
      <Toggle label={t("Mini-lecteur automatique")} hint={t("La vidéo continue en petit quand vous allez sur le guide, la recherche ou les réglages.")} checked={pb.autoMiniPlayer} onChange={(v) => set({ autoMiniPlayer: v })} />
      <HistorySettings />
      <TraktCard />
      <h3>{t("Raccourcis")}</h3>
      <ul className="shortcuts">
        <li><kbd>{t("Espace")}</kbd> {t("lecture / pause")}</li>
        <li><kbd>F</kbd> {t("plein écran")} · <kbd>M</kbd> {t("couper le son")}</li>
        <li><kbd>Page ↑</kbd> / <kbd>Page ↓</kbd> {t("ou CH+ / CH− : chaîne précédente / suivante")}</li>
        <li>{t("En plein écran :")} <kbd>←</kbd> <kbd>→</kbd> ±10 s, <kbd>↑</kbd> <kbd>↓</kbd> {t("zapper")}</li>
        <li><kbd>/</kbd> {t("rechercher")} · <kbd>{t("Échap")}</kbd> {t("ou Retour : revenir")}</li>
        <li><kbd>Ctrl</kbd> + <kbd>{t("Maj")}</kbd> + <kbd>H</kbd> {t("mode Hacker (mesures techniques)")}</li>
      </ul>
    </div>
  );
}

/** Historique du profil actif : effacement par section ou complet. */
function HistorySettings() {
  const profile = useActiveProfile()!;
  const set = useSettings.getState();
  const kinds = [...new Set(profile.history.map((h) => h.kind).filter(Boolean) as string[])];
  const label = (k: string) => sectionOf(k as VodKind).label;
  return (
    <div className="card">
      <h3>{t("Historique de {name}", { name: profile.name })}</h3>
      <p className="dim small">
        {profile.history.length
          ? t("{items}, {channels}. Les positions de reprise disparaissent avec l'historique.", { items: plural(profile.history.length, "{n} contenu vu ou commencé", "{n} contenus vus ou commencés"), channels: plural(profile.recent.length, "{n} chaîne récente", "{n} chaînes récentes") })
          : profile.recent.length
            ? plural(profile.recent.length, "{n} chaîne récente.", "{n} chaînes récentes.")
            : t("Aucun historique pour ce profil.")}
        {profile.trakt ? " " + t("L'historique enregistré sur Trakt n'est pas modifié.") : ""}
      </p>
      <div className="row wrap">
        {kinds.map((k) => (
          <ConfirmButton key={k} className="btn" label={t("Effacer : {section}", { section: t(label(k)) })} confirm={t("Confirmer ?")} onConfirm={() => set.clearHistory(k)} />
        ))}
        {profile.recent.length > 0 && <ConfirmButton className="btn" label={t("Effacer les chaînes récentes")} confirm={t("Confirmer ?")} onConfirm={() => set.clearRecent()} />}
        {(profile.history.length > 0 || profile.recent.length > 0) && (
          <ConfirmButton
            className="btn btn-danger"
            label={t("Tout effacer")}
            confirm={t("Confirmer l'effacement complet ?")}
            onConfirm={() => {
              set.clearHistory();
              set.clearRecent();
            }}
          />
        )}
      </div>
    </div>
  );
}

function Prevention() {
  return (
    <div className="settings-section prose">
      <h2>{t("Reconnaître une offre IPTV illégale")}</h2>
      <p>
        {t("MyIPTV est un lecteur : il ne vend ni ne fournit aucun contenu. Il lit les chaînes gratuites du catalogue intégré et les abonnements que vous souscrivez auprès de fournisseurs légaux (opérateurs, box, services officiels). Voici les signes qui doivent vous alerter avant de payer une offre.")}
      </p>
      <h3>{t("Signaux d'alerte")}</h3>
      <ul>
        <li><strong>{t("Prix anormalement bas")}</strong> {t(": « toutes les chaînes du monde », sport premium et cinéma pour quelques euros par mois ou par an.")}</li>
        <li><strong>{t("Catalogue impossible")}</strong> {t(": des milliers de chaînes payantes de plusieurs pays, les films encore au cinéma, les séries de toutes les plateformes réunies.")}</li>
        <li><strong>{t("Vente par revendeur")}</strong> {t(": réseaux sociaux, messageries, « codes » ou « lignes » à activer, essais de 24 h, panneaux « Xtream » anonymes.")}</li>
        <li><strong>{t("Paiement opaque")}</strong> {t(": cryptomonnaies, cartes cadeaux, virement à un particulier, absence de facture ou de société identifiable.")}</li>
        <li><strong>{t("Aucune mention légale")}</strong>{t(", pas de conditions générales, pas de service client joignable, nom de domaine qui change souvent.")}</li>
      </ul>
      <h3>{t("Les risques")}</h3>
      <ul>
        <li>{t("Amendes : regarder ou payer un service pirate peut être sanctionné selon les pays.")}</li>
        <li>{t("Perte d'argent : ces services sont régulièrement fermés par les autorités, sans remboursement.")}</li>
        <li>{t("Fraude et données personnelles : vol de carte bancaire, revente de vos données.")}</li>
        <li>{t("Logiciels malveillants : applications « préconfigurées » piégées.")}</li>
      </ul>
      <h3>{t("À savoir")}</h3>
      <ul>
        <li>{t("La redevance ou contribution audiovisuelle finance l'audiovisuel public de votre pays. Elle ne donne aucun droit sur les chaînes et plateformes payantes.")}</li>
        <li>{t("Beaucoup de chaînes sont réellement gratuites et légales : télévisions publiques, chaînes en clair, chaînes gratuites financées par la publicité. Le catalogue intégré les recense.")}</li>
        <li>{t("En cas de doute, demandez au fournisseur son nom légal, son adresse et la liste de ses accords de diffusion.")}</li>
      </ul>
      <p className="dim small">{t("Lors de l'ajout d'une source, MyIPTV analyse son contenu et vous avertit si elle présente ces signes.")}</p>
    </div>
  );
}

function About() {
  return (
    <div className="settings-section prose">
      <h2>MyIPTV</h2>
      <p>{t("Version {v}", { v: __APP_VERSION__ })}</p>
      <p>
        {t("Lecteur IPTV multiplateforme. Il lit les playlists M3U, les comptes Xtream Codes et les guides XMLTV que vous ajoutez, ainsi que le catalogue communautaire de chaînes gratuites iptv-org.")}
      </p>
      <p className="dim small">{t("MyIPTV ne fournit aucun contenu. Chaque utilisateur est responsable des sources qu'il ajoute.")}</p>
      <UpdateCard />
    </div>
  );
}
