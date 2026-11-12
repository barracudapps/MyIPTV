import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useActivity, type Task } from "../store/activity";
import { useRecordings } from "../store/recordings";
import { useUi } from "../store/ui";
import { useNow } from "../lib/hooks";
import { Icon } from "./Icon";

function elapsed(since: number, now: number): string {
  const s = Math.max(0, Math.round(now - since / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

function TaskRow({ task, now }: { task: Task; now: number }) {
  const pct = task.total ? Math.round(((task.done ?? 0) / task.total) * 100) : null;
  return (
    <li className="activity-task">
      <div className="activity-task-head">
        <span className="spinner tiny" aria-hidden="true" />
        <strong>{task.label}</strong>
        <span className="dim small">{task.total ? `${task.done ?? 0}/${task.total}` : elapsed(task.startedAt, now)}</span>
      </div>
      {task.detail && <span className="dim small activity-detail">{task.detail}</span>}
      <div className={`activity-progress ${pct == null ? "indeterminate" : ""}`} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <span style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
    </li>
  );
}

/** Barre fine en haut de l'écran tant qu'un traitement tourne. */
export function ActivityBar() {
  const busy = useActivity((s) => s.tasks.length > 0);
  return busy ? <div className="activity-bar" aria-hidden="true" /> : null;
}

/** Bouton du menu : nombre de traitements en cours et détail au clic. */
export function ActivityButton() {
  const tasks = useActivity((s) => s.tasks);
  const recording = useRecordings((s) => s.list.filter((r) => r.status === "recording"));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const now = useNow(open ? 1000 : 60_000);
  const count = tasks.length + recording.length;
  // Les enregistrements avancent côté natif : on rafraîchit tant qu'il y en a d'actifs ou prévus.
  const pendingRecs = useRecordings((s) => s.list.some((r) => r.status === "recording" || r.status === "scheduled"));
  useEffect(() => {
    if (!pendingRecs) return;
    const t = setInterval(() => void useRecordings.getState().refresh().catch(() => undefined), 30_000);
    return () => clearInterval(t);
  }, [pendingRecs]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const side = r.right < window.innerWidth / 3;
    setPos(
      side
        ? { left: r.right + 10, bottom: Math.max(12, window.innerHeight - r.bottom) }
        : r.top < window.innerHeight / 2
          ? { top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right) }
          : { bottom: window.innerHeight - r.top + 10, right: Math.max(12, window.innerWidth - r.right) },
    );
  }, [open, count]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const label = count ? `${count} traitement${count > 1 ? "s" : ""} en cours` : "Aucun traitement en cours";
  return (
    <>
      <button ref={btn} className={`nav-item activity-btn ${count ? "busy" : ""}`} onClick={() => setOpen((o) => !o)} title={label} aria-expanded={open} aria-haspopup="dialog">
        {count ? <span className="spinner tiny" aria-hidden="true" /> : <Icon name="check" />}
        <span>{count ? `${count} en cours` : "Activité"}</span>
        {count > 0 && <small className="activity-count">{count}</small>}
      </button>
      <span className="sr-only" aria-live="polite">{label}</span>
      {open && (
        <div ref={pop} className="activity-popover" style={pos} role="dialog" aria-label="Traitements en cours">
          <header>
            <strong>Activité</strong>
            <span className="dim small">{label}</span>
          </header>
          {count === 0 ? (
            <p className="dim small activity-empty">Tout est à jour. Les chargements, vérifications, partages et enregistrements apparaîtront ici.</p>
          ) : (
            <ul>
              {tasks.map((t) => <TaskRow key={t.id} task={t} now={now} />)}
              {recording.map((r) => (
                <li key={r.id} className="activity-task">
                  <button className="activity-rec" onClick={() => (useUi.setState({ view: "recordings" }), setOpen(false))}>
                    <span className="rec-dot" aria-hidden="true" />
                    <strong>Enregistrement</strong>
                    <span className="dim small">{r.size ? `${(r.size / 1e6).toFixed(0)} Mo` : ""}</span>
                  </button>
                  <span className="dim small activity-detail">{r.title} · {r.channel.name}</span>
                  <div className="activity-progress" role="progressbar">
                    <span style={{ width: `${Math.min(100, Math.max(0, ((now - r.start) / Math.max(1, r.stop - r.start)) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
