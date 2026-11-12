import { create } from "zustand";
import { getBackend, type CastDevice, type CastStatus } from "../platform";
import { usePlayer } from "./player";
import { useUi } from "./ui";
import { errorMessage } from "../lib/util";

interface CastState {
  /** Écran en cours d'utilisation (diffusion active). */
  device: CastDevice | null;
  status: CastStatus | null;
  starting: boolean;
  start(device: CastDevice): Promise<void>;
  control(action: "play" | "pause" | "seek", position?: number): void;
  stop(): void;
}

let poll: number | undefined;

function localVideo(): HTMLVideoElement | null {
  return document.querySelector(".player video");
}

export const useCast = create<CastState>()((set, get) => ({
  device: null,
  status: null,
  starting: false,

  async start(device) {
    const backend = await getBackend();
    const src = usePlayer.getState().source;
    if (!backend.cast || !src) return;
    const video = localVideo();
    set({ starting: true });
    try {
      await backend.cast.start(device, { ...src, start: src.live ? 0 : video?.currentTime ?? 0 });
      // L'écran prend le relais : la lecture locale s'interrompt.
      video?.pause();
      set({ device, status: { active: true, state: "BUFFERING", position: 0 } });
      window.clearInterval(poll);
      poll = window.setInterval(async () => {
        const status = await backend.cast!.status().catch(() => null);
        if (!status) return;
        set({ status });
        if (!status.active) {
          window.clearInterval(poll);
          if (status.error) useUi.getState().toast(`Diffusion arrêtée : ${status.error}`, "error");
          set({ device: null, status: null });
        }
      }, 1000);
    } catch (e) {
      useUi.getState().toast(`Diffusion impossible : ${errorMessage(e)}`, "error");
    } finally {
      set({ starting: false });
    }
  },

  control(action, position) {
    void getBackend().then((b) => b.cast?.control(action, position).catch((e) => useUi.getState().toast(errorMessage(e), "error")));
  },

  stop() {
    window.clearInterval(poll);
    const pos = get().status?.position ?? 0;
    set({ device: null, status: null });
    void getBackend().then((b) => b.cast?.stop());
    // Reprise sur cet appareil là où l'écran s'est arrêté (contenus à la demande).
    const video = localVideo();
    if (video && !usePlayer.getState().source?.live && pos > 5) video.currentTime = pos;
  },
}));
