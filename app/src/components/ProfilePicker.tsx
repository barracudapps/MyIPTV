import { useState } from "react";
import { useSettings } from "../store/settings";
import { askPin, useUi } from "../store/ui";
import { usePlayer } from "../store/player";
import type { Profile } from "../lib/parental";
import { Icon } from "./Icon";
import { t } from "../lib/t";

/** Écran « Qui regarde ? ». À la première ouverture, crée le profil administrateur. */
export function ProfilePicker() {
  const profiles = useSettings((s) => s.profiles);
  const [name, setName] = useState("");

  if (profiles.length === 0) {
    return (
      <div className="profile-picker">
        <h1>{t("Bienvenue sur MyIPTV")}</h1>
        <p className="dim">{t("Créez votre profil. Il sera administrateur : il gère les sources, les autres profils et le contrôle parental.")}</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const p = useSettings.getState().addProfile(name.trim(), "admin");
            useSettings.getState().setActiveProfile(p.id);
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Votre prénom")} aria-label={t("Votre prénom")} />
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
            {t("Commencer")}
          </button>
        </form>
      </div>
    );
  }

  const choose = async (p: Profile) => {
    // Un administrateur protégé par code ne s'ouvre pas sans lui (sinon un enfant pourrait y accéder).
    if (p.kind === "admin" && !(await askPin(t("Profil de {name}", { name: p.name }), t("Ce profil est protégé par le code parental.")))) return;
    useUi.getState().resetUnlocks();
    useSettings.getState().setActiveProfile(p.id);
    useUi.getState().setView("live");
  };

  return (
    <div className="profile-picker">
      <h1>{t("Qui regarde ?")}</h1>
      <div className="profiles">
        {profiles.map((p) => (
          <button key={p.id} className="profile" onClick={() => choose(p)}>
            <span className="avatar large" style={{ background: p.color }}>
              {p.avatar}
            </span>
            <span>{p.name}</span>
            {p.kind === "child" && <small className="dim">{t("{n} ans", { n: p.child!.age })}</small>}
            {p.kind === "admin" && useSettings.getState().parental.pinHash && <Icon name="lock" size={14} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Quitter le profil courant (le code est exigé pour sortir d'un profil enfant). */
export async function switchProfile() {
  const s = useSettings.getState();
  const current = s.profiles.find((p) => p.id === s.activeProfileId);
  if (current?.kind === "child" && s.parental.lockChildProfiles && !(await askPin(t("Changer de profil"), t("Demandez à un parent de saisir le code.")))) return;
  await usePlayer.getState().stop();
  useUi.getState().resetUnlocks();
  s.setActiveProfile(null);
}
