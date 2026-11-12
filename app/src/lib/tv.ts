/**
 * Télécommandes de téléviseurs : Samsung Tizen ne transmet les touches multimédia
 * qu'après les avoir déclarées ; LG webOS envoie Retour (461) déjà géré par la navigation.
 */
type TizenInput = { tvinputdevice?: { registerKey(name: string): void } };

const TIZEN_KEYS = ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop", "MediaFastForward", "MediaRewind", "ChannelUp", "ChannelDown", "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue", "Info"];

export function installTvRemote() {
  const tizen = (window as unknown as { tizen?: TizenInput }).tizen;
  if (tizen?.tvinputdevice) {
    for (const key of TIZEN_KEYS) {
      try {
        tizen.tvinputdevice.registerKey(key);
      } catch {
        // Touche absente de ce modèle.
      }
    }
  }
  // Codes Tizen des touches multimédia -> noms standard, pour réutiliser les raccourcis du lecteur.
  const map: Record<number, string> = { 10252: "MediaPlayPause", 415: "MediaPlay", 19: "MediaPause", 417: "MediaFastForward", 412: "MediaRewind", 413: "MediaStop", 427: "ChannelUp", 428: "ChannelDown", 33: "ChannelUp", 34: "ChannelDown" };
  window.addEventListener(
    "keydown",
    (e) => {
      const name = map[e.keyCode];
      if (name && e.key !== name && !e.key.startsWith("Page")) {
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
      }
    },
    true,
  );
}
