import { useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile } from "../store/settings";
import { programmeAccess } from "../lib/parental";
import { fmtTime, nowSec } from "../lib/util";
import type { Channel } from "../types";
import { Icon } from "./Icon";

/** Nombre de jours d'archive d'une chaîne (0 = pas de replay). */
export function catchupDays(ch: Channel): number {
  return ch.catchup ? Math.max(1, ch.catchup.days) : 0;
}

/** Badge « ⟲ 7 j » : repère d'un coup d'œil les chaînes avec replay. */
export function ReplayBadge({ channel, compact }: { channel: Channel; compact?: boolean }) {
  const days = catchupDays(channel);
  if (!days) return null;
  return (
    <span className="replay-badge" title={`Replay disponible sur ${days} jour${days > 1 ? "s" : ""}`}>
      <Icon name="replay" size={12} />
      {!compact && <>{days} j</>}
    </span>
  );
}

function dayStart(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return Math.floor(d.getTime() / 1000);
}

function dayLabel(offset: number) {
  if (offset === 0) return "Aujourd'hui";
  if (offset === 1) return "Hier";
  return new Date(dayStart(offset) * 1000).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
}

/**
 * Émissions passées d'une chaîne, jour par jour, dans la limite de son archive.
 * Un clic lance le programme depuis son début.
 */
export function CatchupBrowser({ channel }: { channel: Channel }) {
  const days = Math.min(catchupDays(channel), 14);
  const [offset, setOffset] = useState(0);
  const profile = useActiveProfile()!;
  const ensure = useLibrary((s) => s.ensureProgrammes);
  const progs = useLibrary((s) => s.programmes[channel.id]);
  const playing = usePlayer((s) => (s.channel?.id === channel.id ? s.catchup : null));
  const listRef = useRef<HTMLOListElement>(null);
  const now = nowSec();

  useEffect(() => setOffset(0), [channel.id]);
  useEffect(() => {
    if (days) ensure([channel], dayStart(offset), dayStart(offset) + 86400);
  }, [channel, offset, days, ensure]);

  const list = useMemo(() => {
    const from = Math.max(dayStart(offset), now - days * 86400);
    const to = Math.min(dayStart(offset) + 86400, now);
    return (progs ?? []).filter((p) => p.start >= from && p.start < to && p.stop <= now + 60).reverse();
  }, [progs, offset, days, now]);

  useEffect(() => listRef.current?.scrollTo({ top: 0 }), [offset, channel.id]);

  if (!days) return null;
  return (
    <section className="catchup">
      <h3>
        <Icon name="replay" /> Revoir ({days} jour{days > 1 ? "s" : ""})
      </h3>
      <div className="chips">
        {Array.from({ length: Math.min(days + 1, 15) }, (_, i) => (
          <button key={i} className={`chip ${offset === i ? "active" : ""}`} onClick={() => setOffset(i)}>
            {dayLabel(i)}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="dim small">{progs ? "Pas de programme connu pour ce jour (guide manquant)." : "Chargement du guide…"}</p>
      ) : (
        <ol className="catchup-list" ref={listRef}>
          {list.map((p) => {
            const ok = programmeAccess(profile, channel, p).ok;
            const current = playing?.start === p.start;
            const live = p.stop > now;
            return (
              <li key={p.start}>
                <button
                  className={`catchup-item ${current ? "current" : ""}`}
                  disabled={!ok}
                  onClick={() => usePlayer.getState().playCatchup(channel, p)}
                  title={live ? "Reprendre depuis le début" : "Revoir"}
                >
                  <span className="time">{fmtTime(p.start)}</span>
                  <span className="catchup-text">
                    <strong>{p.title}</strong>
                    {p.subtitle && <span className="dim"> · {p.subtitle}</span>}
                    {p.age ? <em className="age">-{p.age}</em> : null}
                  </span>
                  <span className="dim small">{Math.round((p.stop - p.start) / 60)} min</span>
                  <Icon name={current ? "pause" : live ? "restart" : "play"} size={16} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
