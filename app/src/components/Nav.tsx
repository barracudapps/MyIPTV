import { useActiveProfile, useSettings, themeFor } from "../store/settings";
import { unlockSettings, useUi, type View } from "../store/ui";
import { useNow } from "../lib/hooks";
import { fmtTime } from "../lib/util";
import { switchProfile } from "./ProfilePicker";
import { Icon } from "./Icon";

const ITEMS: [View, string, string][] = [
  ["live", "Direct", "live"],
  ["guide", "Guide", "guide"],
  ["favorites", "Favoris", "star"],
  ["search", "Recherche", "search"],
  ["sources", "Sources", "sources"],
  ["settings", "Réglages", "settings"],
];

export function Nav() {
  const view = useUi((s) => s.view);
  const profile = useActiveProfile()!;
  const custom = useSettings((s) => s.customThemes);
  const showClock = themeFor(profile, custom).layout.showClock;
  const now = useNow(15_000);

  const go = async (v: View) => {
    // Sources et réglages : protégés pour les enfants (et pour tous si l'option est active).
    if ((v === "sources" || v === "settings") && !(await unlockSettings())) return;
    if (v === "sources" && profile.kind !== "admin" && !useUi.getState().settingsUnlocked) {
      useUi.getState().toast("Les sources se gèrent depuis un profil administrateur.", "info");
      return;
    }
    useUi.getState().setView(v);
  };

  const items = profile.kind === "child" ? ITEMS.filter(([v]) => v !== "sources") : ITEMS;

  return (
    <nav className="nav" aria-label="Navigation principale">
      <div className="nav-brand" aria-hidden="true">
        <Icon name="live" size={22} />
        <span>MyIPTV</span>
      </div>
      <div className="nav-items">
        {items.map(([v, label, icon]) => (
          <button key={v} className={`nav-item ${view === v ? "active" : ""}`} onClick={() => go(v)} aria-current={view === v ? "page" : undefined} title={label}>
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="nav-foot">
        {showClock && <span className="clock">{fmtTime(now)}</span>}
        <button className="nav-item profile-btn" onClick={switchProfile} title="Changer de profil">
          <span className="avatar small" style={{ background: profile.color }}>
            {profile.avatar}
          </span>
          <span>{profile.name}</span>
        </button>
      </div>
    </nav>
  );
}
