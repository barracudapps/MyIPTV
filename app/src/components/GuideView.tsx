import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useActiveProfile } from "../store/settings";
import { useUi } from "../store/ui";
import { useNow, useVisibleChannels } from "../lib/hooks";
import { fmtDay, fmtTime, nowSec } from "../lib/util";
import { programmeAccess } from "../lib/parental";
import type { Channel, Programme } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";

const PX_PER_MIN = 4;
const ROW_H = 64;
const CH_COL = 190;
const HOURS = 24;

export function GuideView() {
  const all = useVisibleChannels();
  const epgStats = useLibrary((s) => s.epgStats);
  const epgLoading = useLibrary((s) => s.epgLoading);
  const ensure = useLibrary((s) => s.ensureProgrammes);
  const programmes = useLibrary((s) => s.programmes);
  const setView = useUi((s) => s.setView);
  const now = useNow(30_000);
  const [dayOffset, setDayOffset] = useState(0);
  const [onlyWithGuide, setOnlyWithGuide] = useState(true);
  const [selected, setSelected] = useState<{ ch: Channel; p: Programme } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000) + dayOffset * 86400;
  }, [dayOffset]);
  const dayEnd = dayStart + HOURS * 3600;

  // Sans guide, une chaîne n'apporte rien à la grille : masquée par défaut quand on la sait vide.
  const channels = useMemo(
    () => (onlyWithGuide ? all.filter((c) => !programmes[c.id] || programmes[c.id].length > 0) : all),
    [all, programmes, onlyWithGuide],
  );

  const v = useVirtualizer({ count: channels.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 6 });
  const items = v.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? 0;

  useEffect(() => {
    const slice = channels.slice(first, last + 1);
    const t = setTimeout(() => ensure(slice, dayStart, dayEnd), 100);
    return () => clearTimeout(t);
  }, [first, last, channels, dayStart, dayEnd, ensure]);

  // Centre la vue sur l'heure actuelle à l'ouverture.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && dayOffset === 0) el.scrollLeft = Math.max(0, ((nowSec() - dayStart) / 60) * PX_PER_MIN - 200);
    else if (el) el.scrollLeft = 18 * 60 * PX_PER_MIN - 200; // autre jour : début de soirée
  }, [dayStart, dayOffset]);

  if (!epgStats && !epgLoading) {
    return (
      <div className="empty-state">
        <Icon name="guide" size={56} />
        <h2>Aucun guide des programmes</h2>
        <p>Ajoutez une URL de guide XMLTV à l'une de vos sources (les comptes Xtream fournissent le leur automatiquement).</p>
        <button className="btn btn-primary" onClick={() => setView("sources")}>
          Gérer les sources
        </button>
      </div>
    );
  }

  const width = HOURS * 60 * PX_PER_MIN;
  const nowX = ((now - dayStart) / 60) * PX_PER_MIN;

  return (
    <div className="guide">
      <div className="toolbar">
        {[-3, -2, -1, 0, 1, 2].map((o) => (
          <button key={o} className={`chip ${dayOffset === o ? "active" : ""}`} onClick={() => setDayOffset(o)}>
            {o === 0 ? "Aujourd'hui" : o === -1 ? "Hier" : o === 1 ? "Demain" : fmtDay(nowSec() + o * 86400)}
          </button>
        ))}
        <div className="spacer" />
        <label className="check">
          <input type="checkbox" checked={onlyWithGuide} onChange={(e) => setOnlyWithGuide(e.target.checked)} /> Chaînes avec programmes
        </label>
        {epgLoading && <span className="dim">Mise à jour du guide…</span>}
      </div>
      <div className="guide-scroll" ref={scrollRef}>
        <div style={{ width: width + CH_COL, height: v.getTotalSize() + 36, position: "relative" }}>
          <div className="guide-hours" style={{ width, left: CH_COL }}>
            {Array.from({ length: HOURS * 2 }, (_, i) => (
              <span key={i} style={{ left: i * 30 * PX_PER_MIN }}>
                {fmtTime(dayStart + i * 1800)}
              </span>
            ))}
          </div>
          {nowX > 0 && nowX < width && <div className="guide-now" style={{ left: CH_COL + nowX, height: v.getTotalSize() + 36 }} />}
          {items.map((row) => {
            const ch = channels[row.index];
            const progs = (programmes[ch.id] ?? []).filter((p) => p.stop > dayStart && p.start < dayEnd);
            return (
              <div key={row.key} className="guide-row" style={{ transform: `translateY(${row.start + 36}px)`, height: ROW_H }}>
                <button className="guide-channel" style={{ width: CH_COL }} onClick={() => usePlayer.getState().play(ch, { zapList: channels })} title={`Regarder ${ch.name}`}>
                  <ChannelLogo channel={ch} size={36} />
                  <span>{ch.name}</span>
                </button>
                <div className="guide-progs" style={{ left: CH_COL, width }}>
                  {progs.map((p) => {
                    const left = Math.max(0, ((p.start - dayStart) / 60) * PX_PER_MIN);
                    const right = Math.min(width, ((p.stop - dayStart) / 60) * PX_PER_MIN);
                    const state = p.stop <= now ? "past" : p.start <= now ? "now" : "future";
                    return (
                      <button
                        key={p.start}
                        className={`guide-prog ${state}`}
                        style={{ left, width: Math.max(2, right - left - 2) }}
                        onClick={() => setSelected({ ch, p })}
                        title={`${fmtTime(p.start)} ${p.title}`}
                      >
                        <strong>{p.title}</strong>
                        <span>
                          {fmtTime(p.start)}
                          {state === "past" && ch.catchup ? " · replay" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {selected && <ProgrammeDialog {...selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ProgrammeDialog({ ch, p, onClose }: { ch: Channel; p: Programme; onClose(): void }) {
  const profile = useActiveProfile()!;
  const now = nowSec();
  const access = programmeAccess(profile, ch, p);
  const canReplay = p.stop <= now || p.start <= now ? !!ch.catchup : false;
  const days = ch.catchup?.days ?? 0;
  const inWindow = p.start >= now - days * 86400;
  return (
    <Modal title={p.title} onClose={onClose}>
      <div className="prog-dialog">
        <div className="row">
          <ChannelLogo channel={ch} size={40} />
          <div>
            <strong>{ch.name}</strong>
            <div className="dim">
              {fmtDay(p.start)} · {fmtTime(p.start)} – {fmtTime(p.stop)}
              {p.category ? ` · ${p.category}` : ""}
              {p.age ? ` · déconseillé aux moins de ${p.age} ans` : ""}
            </div>
          </div>
        </div>
        {p.subtitle && <p className="subtitle">{p.subtitle}</p>}
        {p.desc && <p>{p.desc}</p>}
        {!access.ok && access.reason === "blocked" && <p className="error-text">{access.message}</p>}
        <div className="actions">
          {p.start <= now && p.stop > now && (
            <button className="btn btn-primary" disabled={!access.ok} onClick={() => (usePlayer.getState().play(ch), onClose())}>
              <Icon name="play" /> Regarder en direct
            </button>
          )}
          {canReplay && inWindow && (
            <button className="btn" disabled={!access.ok} onClick={() => (usePlayer.getState().playCatchup(ch, p), onClose())}>
              <Icon name="replay" /> {p.stop <= now ? "Revoir" : "Depuis le début"}
            </button>
          )}
          {p.start > now && <span className="dim">Diffusion à venir.</span>}
          {p.stop <= now && !ch.catchup && <span className="dim">Cette chaîne ne propose pas de replay.</span>}
        </div>
      </div>
    </Modal>
  );
}
