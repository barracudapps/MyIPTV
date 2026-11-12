import { useEffect, useRef } from "react";
import { useActiveProfile, useSettings, themeFor } from "./store/settings";
import { useLibrary } from "./store/library";
import { usePlayer } from "./store/player";
import { useUi } from "./store/ui";
import { applyTheme, BUILTIN_THEMES } from "./lib/themes";
import { installSpatialNavigation } from "./lib/spatial";
import { channelAccess } from "./lib/parental";
import { Nav } from "./components/Nav";
import { LiveView } from "./components/LiveView";
import { GuideView } from "./components/GuideView";
import { SearchView } from "./components/SearchView";
import { SourcesView } from "./components/SourcesView";
import { SettingsView } from "./components/SettingsView";
import { ProfilePicker } from "./components/ProfilePicker";
import { Player } from "./components/Player";
import { PinDialog, Toasts } from "./components/Dialogs";
import { VodView } from "./components/VodView";
import { DetailView, PersonDialog } from "./components/DetailView";
import { FunLayer, Mascot } from "./components/Mascot";
import { installEasterEggs } from "./lib/fun";
import type { VodKind } from "./types";

export default function App() {
  const profile = useActiveProfile();
  const custom = useSettings((s) => s.customThemes);
  const view = useUi((s) => s.view);
  const sourcesKey = useSettings((s) => s.sources.map((x) => x.id + x.enabled).join());

  useEffect(() => applyTheme(profile ? themeFor(profile, custom) : BUILTIN_THEMES[0]), [profile, custom]);

  // (Re)chargement des chaînes au démarrage et quand les sources changent.
  useEffect(() => {
    useLibrary.getState().loadAll();
  }, [sourcesKey]);

  // Reprise de la dernière chaîne du profil.
  const resumed = useRef<string | null>(null);
  const channelsLoaded = useLibrary((s) => s.channels.length > 0);
  useEffect(() => {
    if (!profile || !channelsLoaded || resumed.current === profile.id) return;
    resumed.current = profile.id;
    const { playback, lastChannelId } = useSettings.getState();
    const ch = useLibrary.getState().byId.get(lastChannelId[profile.id] ?? "");
    const adult = { enabled: useSettings.getState().parental.adultEnabled, unlocked: false };
    if (playback.resumeLastChannel && ch && channelAccess(profile, ch, adult).ok) usePlayer.getState().play(ch);
  }, [profile, channelsLoaded]);

  // Télécommande / clavier : flèches, retour, recherche rapide.
  useEffect(
    () =>
      installSpatialNavigation(() => {
        const ui = useUi.getState();
        if (ui.pin) return;
        if (ui.person) useUi.setState({ person: null });
        else if (ui.detailId) useUi.setState({ detailId: null });
        else if (document.fullscreenElement) document.exitFullscreen();
        else if (document.querySelector("[data-modal]")) (document.querySelector("[data-modal] header .icon-btn") as HTMLElement | null)?.click();
        else if (usePlayer.getState().mode === "mini" && ui.view === "live") usePlayer.getState().setMode("docked");
        else if (ui.view !== "live") ui.setView("live");
      }),
    [],
  );
  useEffect(() => installEasterEggs(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") {
        e.preventDefault();
        useUi.getState().setView("search");
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (!profile) {
    return (
      <>
        <ProfilePicker />
        <PinDialog />
        <Toasts />
        <FunLayer />
      </>
    );
  }

  return (
    <div className="app">
      <Nav />
      <main className="main">
        {view === "live" && <LiveView scope="all" />}
        {view === "favorites" && <LiveView scope="favorites" />}
        {view === "guide" && <GuideView />}
        {view === "search" && <SearchView />}
        {view === "sources" && <SourcesView />}
        {view === "settings" && <SettingsView />}
        {view.startsWith("vod:") && <VodView kind={view.slice(4) as VodKind} />}
      </main>
      <Player />
      <DetailView />
      <PersonDialog />
      <Mascot />
      <FunLayer />
      <PinDialog />
      <Toasts />
    </div>
  );
}
