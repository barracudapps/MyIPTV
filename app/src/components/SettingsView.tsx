import { BufferChoice } from "./BufferChoice";
import { useMemo, useState } from "react";
import { useActiveProfile, useSettings } from "../store/settings";
import { askPin, useUi } from "../store/ui";
import { useLibrary } from "../store/library";
import { getBackend } from "../platform";
import { hashPin, maxAge, type Profile, type ProfileKind } from "../lib/parental";
import { normalize } from "../lib/util";
import type { Channel } from "../types";
import { AppearanceSettings, Range, Segmented, Toggle } from "./ThemeEditor";
import { ChannelLogo } from "./ChannelLogo";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";
import { ExtraSettings } from "./ExtraSettings";
import { ShareSettings } from "./ShareSettings";

type Section = "appearance" | "languages" | "profiles" | "parental" | "playback" | "meta" | "fun" | "menu" | "share" | "prevention" | "about";

export function SettingsView() {
  const profile = useActiveProfile()!;
  const isAdmin = profile.kind === "admin";
  const [section, setSection] = useState<Section>("appearance");
  const sections: [Section, string, string, boolean][] = [
    ["appearance", "Apparence", "palette", true],
    ["languages", "Langues", "globe", true],
    ["profiles", "Profils", "user", isAdmin],
    ["parental", "Contrôle parental", "shield", isAdmin],
    ["playback", "Lecture", "play", true],
    ["meta", "Métadonnées", "info", isAdmin],
    ["fun", "Fun & succès", "trophy", true],
    ["menu", "Menu", "list", true],
    ["share", "Partage en réseau", "upload", isAdmin],
    ["prevention", "Reconnaître une offre illégale", "alert", true],
    ["about", "À propos", "info", true],
  ];
  return (
    <div className="page settings">
      <nav className="settings-nav" aria-label="Sections des réglages">
        {sections
          .filter(([, , , shown]) => shown)
          .map(([id, label, icon]) => (
            <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>
              <Icon name={icon} /> {label}
            </button>
          ))}
        {!isAdmin && <p className="dim small">Les profils et le contrôle parental se gèrent depuis un profil administrateur.</p>}
      </nav>
      <div className="settings-content" key={section}>
        {section === "appearance" && <AppearanceSettings />}
        {section === "profiles" && isAdmin && <ProfilesSettings />}
        {section === "parental" && isAdmin && <ParentalSettings />}
        {section === "playback" && <PlaybackSettings />}
        {(section === "languages" || section === "meta" || section === "fun" || section === "menu") && <ExtraSettings section={section} />}
        {section === "share" && isAdmin && <ShareSettings />}
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
      <h2>Profils</h2>
      <p className="dim">Chaque profil a ses favoris, son historique, son thème et ses écrans. Les profils enfants n'affichent que les contenus adaptés à leur âge.</p>
      <ul className="profile-list">
        {profiles.map((p) => (
          <li key={p.id} className="card row">
            <span className="avatar" style={{ background: p.color }}>
              {p.avatar}
            </span>
            <div className="grow">
              <strong>{p.name}</strong>
              <div className="dim small">
                {KIND_LABEL[p.kind]}
                {p.kind === "child" ? ` · ${p.child!.age} ans · contenus jusqu'à -${maxAge(p)}` : ""}
              </div>
            </div>
            <button className="btn" onClick={() => setEditing(p)}>
              Modifier
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" onClick={() => setEditing("new")}>
        <Icon name="plus" /> Nouveau profil
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
    <Modal title={profile ? "Modifier le profil" : "Nouveau profil"} onClose={onClose}>
      <label className="field">
        Prénom
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <Segmented<ProfileKind>
        label="Type"
        value={kind}
        options={lastAdmin ? [["admin", "Administrateur"]] : [["admin", "Administrateur"], ["standard", "Standard"], ["child", "Enfant"]]}
        onChange={setKind}
      />
      {lastAdmin && <p className="dim small">Il doit toujours rester au moins un administrateur.</p>}
      {kind === "child" && (
        <label className="field">
          Âge
          <input type="number" min={1} max={17} value={age} onChange={(e) => setAge(Math.min(17, Math.max(1, +e.target.value)))} />
        </label>
      )}
      <div className="field">
        Avatar
        <div className="avatar-picker">
          {AVATARS.map((a) => (
            <button key={a} className={a === avatar ? "active" : ""} onClick={() => setAvatar(a)}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        Couleur
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
            Supprimer
          </button>
        )}
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>
          Enregistrer
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
    if (!/^\d{4,8}$/.test(pin)) return toast("Le code doit comporter 4 à 8 chiffres.", "error");
    if (pin !== pin2) return toast("Les deux codes ne correspondent pas.", "error");
    if (parental.pinHash && !(await askPin("Code actuel", "Saisissez le code parental actuel."))) return;
    set({ pinHash: await hashPin(pin), pinIsDefault: false });
    setPin("");
    setPin2("");
    toast("Code parental enregistré.", "success");
  };

  return (
    <div className="settings-section">
      <h2>Contrôle parental</h2>
      <div className="card">
        <h3>
          <Icon name="lock" /> Code parental {parental.pinHash ? <span className="mini-badge ok">actif</span> : <span className="mini-badge warn">non défini</span>}
        </h3>
        <p className="dim small">Il protège les contenus adultes, la sortie des profils enfants, les profils administrateurs et, si vous le souhaitez, les réglages.</p>
        {parental.pinHash && parental.pinIsDefault && (
          <p className="warn-text">
            <Icon name="alert" size={16} /> Le code est encore celui par défaut : <strong>0000</strong>. Changez-le pour protéger réellement vos réglages.
          </p>
        )}
        <div className="row">
          <input type="password" inputMode="numeric" placeholder="Nouveau code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="Nouveau code" />
          <input type="password" inputMode="numeric" placeholder="Confirmer" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} aria-label="Confirmer le code" />
          <button className="btn btn-primary" onClick={savePin}>
            {parental.pinHash ? "Changer" : "Définir"}
          </button>
          {parental.pinHash && (
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!(await askPin("Supprimer le code", "Saisissez le code actuel pour le supprimer."))) return;
                set({ pinHash: undefined, pinIsDefault: false });
                toast("Code parental supprimé : plus aucune protection par code.", "info");
              }}
            >
              Supprimer le code
            </button>
          )}
        </div>
        <Toggle label="Protéger les réglages" hint="Sources, profils et contrôle parental demandent le code." checked={parental.protectSettings} onChange={(v) => set({ protectSettings: v })} />
        <Toggle label="Verrouiller les profils enfants" hint="Le code est demandé pour quitter un profil enfant." checked={parental.lockChildProfiles} onChange={(v) => set({ lockChildProfiles: v })} />
      </div>
      <div className="card">
        <h3>
          <Icon name="lock" /> Contenus pour adultes
        </h3>
        <Toggle
          label="Autoriser les contenus pour adultes"
          hint="Désactivé par défaut : ces chaînes et contenus sont alors totalement masqués. Activé, ils apparaissent verrouillés pour les profils adultes et le code est demandé une fois par session. Ils restent toujours invisibles pour les profils enfants. MyIPTV ne fournit aucun contenu de ce type : seules vos propres sources sont concernées."
          checked={parental.adultEnabled}
          onChange={async (v) => {
            if (v && !(await askPin("Autoriser les contenus pour adultes", "Confirmez avec le code parental."))) return;
            set({ adultEnabled: v });
            useLibrary.getState().loadAll();
          }}
        />
        {parental.adultEnabled && !parental.pinHash && <p className="warn-text">Aucun code n'est défini : les contenus pour adultes ne sont protégés par rien.</p>}
      </div>
      {children.length === 0 ? (
        <p className="dim">Créez un profil enfant (section Profils) pour régler la tolérance par âge, les listes blanche et noire.</p>
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
        {profile.name}, {r.age} ans
      </h3>
      <Range
        label="Tolérance d'âge"
        value={r.tolerance}
        min={0}
        max={6}
        step={1}
        fmt={(v) => (v === 0 ? `stricte (jusqu'à -${r.age})` : `+${v} an${v > 1 ? "s" : ""} (jusqu'à -${r.age + v})`)}
        onChange={(v) => update({ tolerance: v })}
      />
      <p className="dim small">
        Exemple : à {r.age} ans avec une tolérance de {r.tolerance}, un programme « -{r.age + r.tolerance + 1} » est bloqué, un programme « -{r.age + r.tolerance} »
        est autorisé.
      </p>
      <Toggle
        label="Autoriser les programmes sans classification"
        hint="Beaucoup de guides n'indiquent pas d'âge. Désactivé, seules les chaînes de la liste blanche restent regardables dans ce cas."
        checked={r.allowUnrated}
        onChange={(v) => update({ allowUnrated: v })}
      />
      <Toggle label="Uniquement la liste blanche" hint="L'enfant ne voit que les chaînes que vous avez choisies." checked={r.whitelistOnly} onChange={(v) => update({ whitelistOnly: v })} />

      <ChannelListEditor title="Liste blanche (toujours autorisées)" ids={r.whitelist} byId={byId} onRemove={(id) => update({ whitelist: r.whitelist.filter((x) => x !== id) })} onAdd={() => setPicker("whitelist")} />
      <ChannelListEditor title="Liste noire (toujours bloquées)" ids={r.blacklist} byId={byId} onRemove={(id) => update({ blacklist: r.blacklist.filter((x) => x !== id) })} onAdd={() => setPicker("blacklist")} />

      {groups.length > 0 && (
        <div className="field">
          Catégories bloquées
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
          title={picker === "whitelist" ? "Ajouter à la liste blanche" : "Ajouter à la liste noire"}
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
              {c ? <ChannelLogo channel={c} size={18} /> : null} {c?.name ?? "Chaîne indisponible"}
              <button className="chip-x" title="Retirer" onClick={() => onRemove(id)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          );
        })}
        <button className="chip" onClick={onAdd}>
          <Icon name="plus" size={14} /> Ajouter
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
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une chaîne" />
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
      <h2>Lecture</h2>
      <Toggle
        label="Pause du direct (timeshift)"
        hint={diskTs === false ? "Sur cet appareil, le retour arrière est limité à la mémoire du lecteur." : "Le direct est enregistré localement : pause, retour arrière et reprise au début du programme."}
        checked={pb.timeshift}
        onChange={(v) => set({ timeshift: v })}
      />
      {pb.timeshift && (
        <div className="setting-block">
          <strong>Durée de pause du direct</strong>
          <BufferChoice />
        </div>
      )}
      {isAdmin && (
        <Toggle
          label="Mode test"
          hint="Ajoute un onglet « Test » dans Sources › Ajouter : une liste légale d'exemple et une liste suspecte simulée, pour vérifier l'analyse et la double confirmation."
          checked={testMode}
          onChange={(v) => useSettings.getState().setTestMode(v)}
        />
      )}
      <Toggle
        label="Chaînes non vérifiées des listes intégrées"
        hint="Désactivé par défaut : les chaînes servies depuis une simple adresse IP sont le plus souvent des relais non officiels, sans garantie de légalité."
        checked={!!pb.includeUnverified}
        onChange={(v) => (set({ includeUnverified: v }), useLibrary.getState().loadAll())}
      />
      <Toggle label="Reprendre la dernière chaîne au démarrage" checked={pb.resumeLastChannel} onChange={(v) => set({ resumeLastChannel: v })} />
      <Toggle label="Mini-lecteur automatique" hint="La vidéo continue en petit quand vous allez sur le guide, la recherche ou les réglages." checked={pb.autoMiniPlayer} onChange={(v) => set({ autoMiniPlayer: v })} />
      <h3>Raccourcis</h3>
      <ul className="shortcuts">
        <li><kbd>Espace</kbd> lecture / pause</li>
        <li><kbd>F</kbd> plein écran · <kbd>M</kbd> couper le son</li>
        <li><kbd>Page ↑</kbd> / <kbd>Page ↓</kbd> ou CH+ / CH− : chaîne précédente / suivante</li>
        <li>En plein écran : <kbd>←</kbd> <kbd>→</kbd> ±10 s, <kbd>↑</kbd> <kbd>↓</kbd> zapper</li>
        <li><kbd>/</kbd> rechercher · <kbd>Échap</kbd> ou Retour : revenir</li>
      </ul>
    </div>
  );
}

function Prevention() {
  return (
    <div className="settings-section prose">
      <h2>Reconnaître une offre IPTV illégale</h2>
      <p>
        MyIPTV est un lecteur : il ne vend ni ne fournit aucun contenu. Il lit les chaînes gratuites du catalogue intégré et les abonnements que vous souscrivez
        auprès de fournisseurs légaux (opérateurs, box, services officiels). Voici les signes qui doivent vous alerter avant de payer une offre.
      </p>
      <h3>Signaux d'alerte</h3>
      <ul>
        <li><strong>Prix anormalement bas</strong> : « toutes les chaînes du monde », sport premium et cinéma pour quelques euros par mois ou par an.</li>
        <li><strong>Catalogue impossible</strong> : des milliers de chaînes payantes de plusieurs pays, les films encore au cinéma, les séries de toutes les plateformes réunies.</li>
        <li><strong>Vente par revendeur</strong> : réseaux sociaux, messageries, « codes » ou « lignes » à activer, essais de 24 h, panneaux « Xtream » anonymes.</li>
        <li><strong>Paiement opaque</strong> : cryptomonnaies, cartes cadeaux, virement à un particulier, absence de facture ou de société identifiable.</li>
        <li><strong>Aucune mention légale</strong>, pas de conditions générales, pas de service client joignable, nom de domaine qui change souvent.</li>
      </ul>
      <h3>Les risques</h3>
      <ul>
        <li>Amendes : regarder ou payer un service pirate peut être sanctionné selon les pays.</li>
        <li>Perte d'argent : ces services sont régulièrement fermés par les autorités, sans remboursement.</li>
        <li>Fraude et données personnelles : vol de carte bancaire, revente de vos données.</li>
        <li>Logiciels malveillants : applications « préconfigurées » piégées.</li>
      </ul>
      <h3>À savoir</h3>
      <ul>
        <li>La redevance ou contribution audiovisuelle finance l'audiovisuel public de votre pays. Elle ne donne aucun droit sur les chaînes et plateformes payantes.</li>
        <li>Beaucoup de chaînes sont réellement gratuites et légales : télévisions publiques, chaînes en clair, chaînes gratuites financées par la publicité. Le catalogue intégré les recense.</li>
        <li>En cas de doute, demandez au fournisseur son nom légal, son adresse et la liste de ses accords de diffusion.</li>
      </ul>
      <p className="dim small">Lors de l'ajout d'une source, MyIPTV analyse son contenu et vous avertit si elle présente ces signes.</p>
    </div>
  );
}

function About() {
  return (
    <div className="settings-section prose">
      <h2>MyIPTV</h2>
      <p>Version {__APP_VERSION__}</p>
      <p>
        Lecteur IPTV multiplateforme. Il lit les playlists M3U, les comptes Xtream Codes et les guides XMLTV que vous ajoutez, ainsi que le catalogue
        communautaire de chaînes gratuites iptv-org.
      </p>
      <p className="dim small">MyIPTV ne fournit aucun contenu. Chaque utilisateur est responsable des sources qu'il ajoute.</p>
    </div>
  );
}
