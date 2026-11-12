import { useActiveProfile, useSettings, themeFor } from "../store/settings";
import { useLibrary } from "../store/library";
import { SECTIONS } from "../lib/sections";
import { playSound } from "../lib/fun";
import { unlockSettings, useUi, type View } from "../store/ui";
import { useNow } from "../lib/hooks";
import { fmtTime } from "../lib/util";
import { switchProfile } from "./ProfilePicker";
import { Icon } from "./Icon";

export const NAV_ITEMS: [View, string, string][] = [
  ["search", "Recherche", "search"],
  ["live", "Direct", "live"],
  ["guide", "Guide", "guide"],
  ...SECTIONS.map((s) => [`vod:${s.kind}`, s.label, s.icon] as [View, string, string]),
  ["favorites", "Favoris", "star"],
  ["recordings", "Enregistrements", "rec"],
  ["sources", "Sources", "sources"],
  ["settings", "Réglages", "settings"],
];

export function Nav() {
  const view = useUi((s) => s.view);
  const profile = useActiveProfile()!;
  const custom = useSettings((s) => s.customThemes);
  const showClock = themeFor(profile, custom).layout.showClock;
  const now = useNow(15_000);
  const hidden = useSettings((s) => s.hiddenSections);
  const counts = useLibrary((s) => s.vodCounts);

  const go = async (v: View) => {
    // Sources et réglages : protégés pour les enfants (et pour tous si l'option est active).
    if ((v === "sources" || v === "settings") && !(await unlockSettings())) return;
    if (v === "sources" && profile.kind !== "admin" && !useUi.getState().settingsUnlocked) {
      useUi.getState().toast("Les sources se gèrent depuis un profil administrateur.", "info");
      return;
    }
    playSound("click");
    useUi.setState({ view: v, detailId: null });
  };

  const items = NAV_ITEMS.filter(([v]) => !hidden.includes(v) && !(profile.kind === "child" && v === "sources"));

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
            {v.startsWith("vod:") && counts[v.slice(4)] ? <small className="nav-count">{counts[v.slice(4)] > 999 ? `${Math.floor(counts[v.slice(4)] / 1000)}k` : counts[v.slice(4)]}</small> : null}
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
