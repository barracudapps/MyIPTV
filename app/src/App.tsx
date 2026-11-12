import { lazy, Suspense, useEffect, useRef } from "react";
import { useActiveProfile, useSettings, themeFor } from "./store/settings";
import { useLibrary } from "./store/library";
import { usePlayer } from "./store/player";
import { useUi } from "./store/ui";
import { applyTheme, BUILTIN_THEMES } from "./lib/themes";
import { installSpatialNavigation } from "./lib/spatial";
import { channelAccess } from "./lib/parental";
import { Nav } from "./components/Nav";
import { LiveView } from "./components/LiveView";
import { ProfilePicker } from "./components/ProfilePicker";
import { Player } from "./components/Player";
import { PinDialog, Toasts } from "./components/Dialogs";
import { VodView } from "./components/VodView";
import { useRecordings } from "./store/recordings";
import { DetailView, PersonDialog } from "./components/DetailView";
import { FunLayer, Mascot } from "./components/Mascot";
import { installEasterEggs } from "./lib/fun";
import { preloadEngines } from "./lib/engines";
import type { VodKind } from "./types";

// Écrans secondaires chargés à la première ouverture : démarrage plus rapide sur TV.
const GuideView = lazy(() => import("./components/GuideView").then((m) => ({ default: m.GuideView })));
const SearchView = lazy(() => import("./components/SearchView").then((m) => ({ default: m.SearchView })));
const SourcesView = lazy(() => import("./components/SourcesView").then((m) => ({ default: m.SourcesView })));
const SettingsView = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
const RecordingsView = lazy(() => import("./components/RecordingsView").then((m) => ({ default: m.RecordingsView })));

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

  useEffect(preloadEngines, []);

  useEffect(() => {
    let warned = false;
    const onFull = () => {
      if (warned) return;
      warned = true;
      useUi.getState().toast("Stockage plein : vos derniers réglages n'ont pas pu être enregistrés.", "error");
    };
    window.addEventListener("myiptv-storage-full", onFull);
    return () => window.removeEventListener("myiptv-storage-full", onFull);
  }, []);

  const animations = useSettings((s) => s.fun.animations !== false);
  useEffect(() => void (document.documentElement.dataset.motion = animations ? "on" : "off"), [animations]);

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
      installSpatialNavigation((): boolean => {
        const ui = useUi.getState();
        if (ui.pin) return true;
        const player = usePlayer.getState();
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.querySelector("[data-modal]")) (document.querySelector("[data-modal] header .icon-btn") as HTMLElement | null)?.click();
        else if (document.querySelector("[data-player-scope]")) player.setMode("mini");
        else if (ui.person) useUi.setState({ person: null });
        else if (ui.detailId) useUi.setState({ detailId: null });
        else if (player.mode === "mini" && player.channel && ui.view === "live") player.setMode("docked");
        else if (ui.view !== "live") ui.setView("live");
        // Écran d'accueil : Retour rend la main au système (sortie de l'application sur Android).
        else return false;
        return true;
      }),
    [],
  );
  useEffect(() => installEasterEggs(), []);
  useEffect(() => {
    useRecordings.getState().refresh();
  }, []);
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
        <Suspense fallback={null}>
        {view === "guide" && <GuideView />}
        {view === "search" && <SearchView />}
        {view === "sources" && <SourcesView />}
        {view === "settings" && <SettingsView />}
        {view.startsWith("vod:") && <VodView kind={view.slice(4) as VodKind} />}
        {view === "recordings" && <RecordingsView />}
        </Suspense>
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
