import { useEffect, useMemo } from "react";
import { useRecordings } from "../store/recordings";
import { usePlayer } from "../store/player";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { channelVisible } from "../lib/parental";
import { fmtDay, fmtTime } from "../lib/util";
import type { Recording, RecStatus } from "../types";
import { ChannelLogo } from "./ChannelLogo";
import { Icon } from "./Icon";
import { fmtRuntime } from "./VodView";

const STATUS: Record<RecStatus, { label: string; tone: string }> = {
  scheduled: { label: "Programmé", tone: "" },
  recording: { label: "● En cours", tone: "live" },
  done: { label: "Terminé", tone: "ok" },
  failed: { label: "Échec", tone: "warn" },
  cancelled: { label: "Annulé", tone: "" },
};

function fmtSize(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} Go`;
  if (b > 1e6) return `${Math.round(b / 1e6)} Mo`;
  return b ? `${Math.round(b / 1e3)} ko` : "";
}

export function RecordingsView() {
  const { list, info, refresh, cancel } = useRecordings();
  const profile = useActiveProfile()!;
  const adultEnabled = useSettings((s) => s.parental.adultEnabled);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Contrôle parental : un enfant ne voit que les enregistrements de chaînes qui lui sont permises.
  const visible = useMemo(() => list.filter((r) => channelVisible(profile, r.channel, adultEnabled)), [list, profile, adultEnabled]);
  const upcoming = visible.filter((r) => r.status === "scheduled" || r.status === "recording").sort((a, b) => a.start - b.start);
  const done = visible.filter((r) => r.status === "done" || r.status === "failed");

  const play = (r: Recording) => {
    if (!info || !r.file) return;
    usePlayer.getState().playMedia({
      id: `rec:${r.id}`,
      sourceId: "recordings",
      kind: "show",
      title: r.title,
      rawName: r.title,
      url: `${info.base}/${encodeURIComponent(r.file)}`,
      poster: r.channel.logo,
      category: r.channel.name,
      adult: r.channel.adult,
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            <Icon name="rec" size={26} /> Enregistrements
          </h1>
          {info && (
            <p className="dim small">
              Dossier : <code>{info.dir}</code>
              {!info.ffmpeg && " · ffmpeg non installé : seules les chaînes MPEG-TS peuvent être enregistrées."}
            </p>
          )}
        </div>
        <button className="btn" onClick={() => useUi.getState().setView("guide")}>
          <Icon name="guide" /> Programmer depuis le guide
        </button>
      </header>

      {!info && <div className="card notice">L'enregistrement n'est disponible que sur l'application de bureau ou Android.</div>}

      <h3>À venir et en cours ({upcoming.length})</h3>
      {upcoming.length === 0 ? (
        <p className="dim">Aucun enregistrement programmé. Dans le guide, choisissez un programme puis « Enregistrer », ou utilisez le bouton ⏺ du lecteur.</p>
      ) : (
        <ul className="rec-list">
          {upcoming.map((r) => (
            <RecRow key={r.id} r={r} onCancel={() => cancel(r.id, false)} />
          ))}
        </ul>
      )}

      <h3>Mes enregistrements ({done.length})</h3>
      {done.length === 0 ? (
        <p className="dim">Rien d'enregistré pour l'instant.</p>
      ) : (
        <ul className="rec-list">
          {done.map((r) => (
            <RecRow key={r.id} r={r} onPlay={r.status === "done" ? () => play(r) : undefined} onDelete={() => cancel(r.id, true)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecRow({ r, onPlay, onCancel, onDelete }: { r: Recording; onPlay?(): void; onCancel?(): void; onDelete?(): void }) {
  const s = STATUS[r.status];
  return (
    <li className="card rec-row">
      <ChannelLogo channel={r.channel} size={44} />
      <div className="grow">
        <strong>{r.title}</strong>
        {r.subtitle && <span className="dim"> · {r.subtitle}</span>}
        <div className="dim small">
          {r.channel.name} · {fmtDay(r.start)} {fmtTime(r.start)}–{fmtTime(r.stop)} · {fmtRuntime(r.stop - r.start)}
          {r.size > 0 && ` · ${fmtSize(r.size)}`}
        </div>
        {r.error && <div className="error-text small">{r.error}</div>}
      </div>
      <span className={`mini-badge ${s.tone}`}>{s.label}</span>
      {onPlay && (
        <button className="btn btn-primary" onClick={onPlay}>
          <Icon name="play" /> Regarder
        </button>
      )}
      {onCancel && (
        <button className="btn" onClick={onCancel}>
          {r.status === "recording" ? "Arrêter" : "Annuler"}
        </button>
      )}
      {onDelete && (
        <button className="icon-btn" title="Supprimer le fichier" onClick={onDelete}>
          <Icon name="trash" />
        </button>
      )}
    </li>
  );
}
