import { useEffect, useState } from "react";
import { getBackend } from "../platform";
import { useSettings } from "../store/settings";
import { t, locale } from "../lib/t";

/** Durées proposées : sur disque (bureau, Android) ou en mémoire du lecteur (navigateur, TV). */
const DISK = [15, 30, 60, 120, 240, 360, 720];
const MEMORY = [2, 5, 10, 15, 30];
/** Au-delà, la mémoire d'un navigateur ou d'un téléviseur ne suit plus. */
export const MEMORY_MAX_MINUTES = 30;

export function fmtMinutes(v: number) {
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  return v % 60 ? `${h} h ${v % 60}` : `${h} h`;
}

/** Espace occupé par le tampon : de 1 à 3 Go par heure selon la qualité (HD courante). */
function estimate(minutes: number) {
  const lo = (minutes / 60) * 1;
  const hi = (minutes / 60) * 3;
  const f = (g: number) => (g < 1 ? t("{n} Mo", { n: Math.round(g * 1000) }) : t("{n} Go", { n: g.toLocaleString(locale(), { minimumFractionDigits: g < 10 ? 1 : 0, maximumFractionDigits: g < 10 ? 1 : 0 }) }));
  return t("{lo} à {hi}", { lo: f(lo), hi: f(hi) });
}

/** Choix de la durée de pause du direct (tampon). */
export function BufferChoice({ compact = false }: { compact?: boolean }) {
  const value = useSettings((s) => s.playback.windowMinutes);
  const set = useSettings((s) => s.setPlayback);
  const [disk, setDisk] = useState<boolean | null>(null);
  useEffect(() => {
    getBackend().then((b) => setDisk(b.diskTimeshift));
  }, []);
  if (disk == null) return null;
  const presets = disk ? DISK : MEMORY;
  const effective = disk ? value : Math.min(value, MEMORY_MAX_MINUTES);
  return (
    <div className="buffer-choice">
      <div className="chips" role="radiogroup" aria-label={t("Durée de pause du direct")}>
        {presets.map((m) => (
          <button key={m} role="radio" aria-checked={effective === m} className={`chip ${effective === m ? "active" : ""}`} onClick={() => set({ windowMinutes: m })}>
            {fmtMinutes(m)}
          </button>
        ))}
      </div>
      <p className="dim small">
        {disk
          ? t("Retour arrière possible jusqu'à {duration} sur la chaîne regardée. Espace disque utilisé au maximum : {size}, libéré en changeant de chaîne.", { duration: fmtMinutes(effective), size: estimate(effective) })
          : t("Retour arrière possible jusqu'à {duration}, gardé en mémoire du lecteur (limité sur navigateur et TV).", { duration: fmtMinutes(effective) })}
        {!compact && ` ${t("S'applique au prochain lancement d'une chaîne.")}`}
      </p>
    </div>
  );
}
