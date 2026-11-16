import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isTauri } from "../platform";
import type { Channel, Programme } from "../types";
import { nowSec } from "../lib/util";
import { displayName } from "../lib/variants";
import { safeLocalStorage, useSettings } from "./settings";
import { t } from "../lib/t";

/** Rappel d'un programme à venir, propre à un profil. */
export interface Reminder {
  id: string;
  profileId: string;
  channelId: string;
  channelName: string;
  title: string;
  start: number;
  stop: number;
  /** Notification déjà envoyée. */
  fired?: boolean;
}

/** Délai d'avance du rappel, en secondes. */
export const REMINDER_LEAD = 120;

interface ReminderState {
  list: Reminder[];
  /** Rappels déclenchés, affichés dans l'application jusqu'à leur fermeture. */
  due: Reminder[];
  toggle(ch: Channel, p: Programme): void;
  remove(id: string): void;
  dismiss(id: string): void;
  tick(): void;
}

const idOf = (profileId: string, channelId: string, start: number) => `${profileId}|${channelId}|${start}`;

export const useReminders = create<ReminderState>()(
  persist(
    (set, get) => ({
      list: [],
      due: [],
      toggle(ch, p) {
        const profileId = useSettings.getState().activeProfileId ?? "";
        const id = idOf(profileId, ch.id, p.start);
        if (get().list.some((r) => r.id === id)) return get().remove(id);
        void askPermission();
        set((s) => ({
          list: [...s.list, { id, profileId, channelId: ch.id, channelName: displayName(ch), title: p.title, start: p.start, stop: p.stop }].sort((a, b) => a.start - b.start),
        }));
      },
      remove: (id) => set((s) => ({ list: s.list.filter((r) => r.id !== id), due: s.due.filter((r) => r.id !== id) })),
      dismiss: (id) => set((s) => ({ due: s.due.filter((r) => r.id !== id) })),
      tick() {
        const now = nowSec();
        const profileId = useSettings.getState().activeProfileId;
        const fire: Reminder[] = [];
        const list = get()
          // Programmes terminés : le rappel n'a plus d'objet.
          .list.filter((r) => r.stop > now)
          .map((r) => {
            if (r.fired || r.profileId !== profileId || r.start - REMINDER_LEAD > now) return r;
            fire.push(r);
            return { ...r, fired: true };
          });
        if (list.length === get().list.length && !fire.length) return;
        set((s) => ({ list, due: [...s.due, ...fire] }));
        for (const r of fire) void notify(r);
      },
    }),
    {
      name: "myiptv-reminders",
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ list: s.list }),
    },
  ),
);

/** Le programme a-t-il un rappel pour le profil actif ? */
export function useHasReminder(channelId: string, start: number): boolean {
  const profileId = useSettings((s) => s.activeProfileId ?? "");
  return useReminders((s) => s.list.some((r) => r.id === idOf(profileId, channelId, start)));
}

async function askPermission() {
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      if (!(await n.isPermissionGranted())) await n.requestPermission();
    } else if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
  } catch {
    /* le rappel s'affiche de toute façon dans l'application */
  }
}

async function notify(r: Reminder) {
  const minutes = Math.max(0, Math.round((r.start - nowSec()) / 60));
  const title = r.title;
  const body = minutes > 0 ? t("Dans {n} min sur {channel}", { n: minutes, channel: r.channelName }) : t("Commence sur {channel}", { channel: r.channelName });
  try {
    if (isTauri) {
      const n = await import("@tauri-apps/plugin-notification");
      if (await n.isPermissionGranted()) n.sendNotification({ title, body });
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    /* notification système facultative */
  }
}
