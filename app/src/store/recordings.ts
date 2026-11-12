import { create } from "zustand";
import { getBackend } from "../platform";
import type { Channel, Programme, RecInfo, Recording } from "../types";
import { errorMessage, nowSec } from "../lib/util";
import { useSettings } from "./settings";
import { useUi } from "./ui";

interface RecState {
  list: Recording[];
  info: RecInfo | null;
  refresh(): Promise<void>;
  /** Enregistre un programme (ou, sans guide, l'heure qui vient). */
  record(ch: Channel, prog?: Programme): Promise<void>;
  cancel(id: string, deleteFile: boolean): Promise<void>;
  /** Programme déjà programmé ou en cours d'enregistrement ? */
  find(channelId: string, start: number): Recording | undefined;
}

export const useRecordings = create<RecState>()((set, get) => ({
  list: [],
  info: null,
  async refresh() {
    const b = await getBackend();
    const [list, info] = await Promise.all([b.recList(), get().info ? Promise.resolve(get().info) : b.recInfo()]);
    set({ list, info });
  },
  async record(ch, prog) {
    const now = nowSec();
    const start = prog ? Math.max(prog.start, now - 60) : now;
    const stop = prog ? prog.stop : now + 3600;
    try {
      const r = await (await getBackend()).recSchedule({
        channel: ch,
        title: prog?.title ?? `${ch.name} (direct)`,
        subtitle: prog?.subtitle,
        start: prog?.start ?? start,
        stop,
        profileId: useSettings.getState().activeProfileId ?? undefined,
      });
      useUi.getState().toast(r.status === "recording" ? `⏺ Enregistrement de « ${r.title} » en cours.` : `Enregistrement de « ${r.title} » programmé.`, "success");
      await get().refresh();
    } catch (e) {
      useUi.getState().toast(errorMessage(e), "error");
    }
  },
  async cancel(id, deleteFile) {
    await (await getBackend()).recCancel(id, deleteFile);
    await get().refresh();
  },
  find(channelId, start) {
    return get().list.find((r) => r.channel.id === channelId && r.start === start && (r.status === "scheduled" || r.status === "recording" || r.status === "done"));
  },
}));
