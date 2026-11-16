import { useEffect, useMemo } from "react";
import { useReminders, useHasReminder, type Reminder } from "../store/reminders";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { fmtTime } from "../lib/util";
import type { Channel, Programme } from "../types";
import { Icon } from "./Icon";
import { t, locale } from "../lib/t";

/** Bouton « Me rappeler » d'un programme à venir. */
export function ReminderButton({ ch, p, compact = false }: { ch: Channel; p: Programme; compact?: boolean }) {
  const on = useHasReminder(ch.id, p.start);
  const label = on ? t("Rappel programmé") : t("Me rappeler");
  return (
    <button className={compact ? `icon-btn ${on ? "active" : ""}` : `btn ${on ? "active" : ""}`} title={on ? t("Annuler le rappel") : t("Être prévenu 2 minutes avant")} onClick={() => useReminders.getState().toggle(ch, p)}>
      <Icon name="bell" filled={on} />
      {!compact && ` ${label}`}
    </button>
  );
}

function watch(r: Reminder) {
  const ch = useLibrary.getState().byId.get(r.channelId);
  if (ch) usePlayer.getState().play(ch);
  useReminders.getState().dismiss(r.id);
}

/** Vérifie les rappels et affiche ceux qui arrivent à échéance. */
export function ReminderAlerts() {
  const due = useReminders((s) => s.due);
  const profileId = useSettings((s) => s.activeProfileId);
  useEffect(() => {
    useReminders.getState().tick();
    const t = setInterval(() => useReminders.getState().tick(), 15_000);
    return () => clearInterval(t);
  }, [profileId]);
  const mine = due.filter((r) => r.profileId === profileId);
  if (!mine.length) return null;
  return (
    <div className="reminder-alerts">
      {mine.map((r) => (
        <div key={r.id} className="reminder-alert" role="alert">
          <Icon name="bell" filled />
          <span>
            <strong>{r.title}</strong>
            <small className="dim">
              {fmtTime(r.start)} · {r.channelName}
            </small>
          </span>
          <button className="btn btn-primary" onClick={() => watch(r)}>
            <Icon name="play" /> {t("Regarder")}
          </button>
          <button className="icon-btn" title={t("Fermer")} onClick={() => useReminders.getState().dismiss(r.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Liste des rappels du profil (vue Enregistrements). */
export function ReminderList() {
  const profileId = useSettings((s) => s.activeProfileId);
  const all = useReminders((s) => s.list);
  const list = useMemo(() => all.filter((r) => r.profileId === profileId), [all, profileId]);
  if (!list.length) return null;
  return (
    <section className="rec-section">
      <h3>
        <Icon name="bell" /> {t("Rappels")}
      </h3>
      <ul className="reminder-list">
        {list.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.title}</strong>
              <small className="dim">
                {new Date(r.start * 1000).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })} {fmtTime(r.start)} · {r.channelName}
              </small>
            </span>
            <button className="icon-btn" title={t("Supprimer le rappel")} onClick={() => useReminders.getState().remove(r.id)}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
