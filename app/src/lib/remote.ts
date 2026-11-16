import { getBackend, isTauri } from "../platform";
import { usePlayer } from "../store/player";
import { useUi, type View } from "../store/ui";
import { displayName } from "./variants";

interface RemoteCommand {
  type: "key" | "text" | "view" | "action";
  value: string;
}

/** Actions de la télécommande -> touches déjà comprises par le lecteur. */
const ACTION_KEYS: Record<string, string> = {
  playpause: "MediaPlayPause",
  stop: "MediaStop",
  chup: "ChannelUp",
  chdown: "ChannelDown",
  back30: "MediaRewind",
  fwd30: "MediaFastForward",
  fullscreen: "f",
  mute: "AudioVolumeMute",
  volup: "AudioVolumeUp",
  voldown: "AudioVolumeDown",
  live: "l",
};

const VIEWS = new Set(["live", "guide", "favorites", "search", "multiview", "vod:movie", "vod:series", "vod:show", "vod:music", "vod:radio", "vod:podcast", "vod:audiobook"]);

function press(key: string) {
  // Même chemin qu'une vraie touche : navigation au focus et raccourcis du lecteur.
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  if (key === "Enter" && target !== document.body && typeof target.click === "function" && target.tagName !== "INPUT") target.click();
}

function handle(cmd: RemoteCommand) {
  switch (cmd.type) {
    case "key":
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(cmd.value)) press(cmd.value);
      break;
    case "action":
      if (ACTION_KEYS[cmd.value]) press(ACTION_KEYS[cmd.value]);
      break;
    case "view":
      if (VIEWS.has(cmd.value)) useUi.setState({ view: cmd.value as View, detailId: null });
      break;
    case "text":
      useUi.setState({ view: "search", searchQuery: cmd.value.slice(0, 200), detailId: null });
      break;
  }
}

/** Écoute les commandes du téléphone et lui publie ce qui est en lecture. */
export function installRemote(): () => void {
  if (!isTauri) return () => undefined;
  let unlisten: (() => void) | undefined;
  let closed = false;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<RemoteCommand>("remote-command", (e) => handle(e.payload)).then((u) => (closed ? u() : (unlisten = u))),
  );
  const publish = () => {
    const { channel, media } = usePlayer.getState();
    const state = media
      ? { title: media.item.title, subtitle: media.episode?.title, logo: media.item.poster }
      : channel
        ? { title: displayName(channel), subtitle: "En direct", logo: channel.logo }
        : {};
    void getBackend().then((b) => b.remote?.publish(state).catch(() => undefined));
  };
  publish();
  const unsub = usePlayer.subscribe((s, prev) => (s.channel !== prev.channel || s.media !== prev.media) && publish());
  return () => {
    closed = true;
    unlisten?.();
    unsub();
  };
}
