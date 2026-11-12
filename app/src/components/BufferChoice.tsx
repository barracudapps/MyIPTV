import { useEffect, useState } from "react";
import { getBackend } from "../platform";
import { useSettings } from "../store/settings";

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
  const f = (g: number) => (g < 1 ? `${Math.round(g * 1000)} Mo` : `${g.toFixed(g < 10 ? 1 : 0).replace(".", ",")} Go`);
  return `${f(lo)} à ${f(hi)}`;
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
      <div className="chips" role="radiogroup" aria-label="Durée de pause du direct">
        {presets.map((m) => (
          <button key={m} role="radio" aria-checked={effective === m} className={`chip ${effective === m ? "active" : ""}`} onClick={() => set({ windowMinutes: m })}>
            {fmtMinutes(m)}
          </button>
        ))}
      </div>
      <p className="dim small">
        {disk
          ? `Retour arrière possible jusqu'à ${fmtMinutes(effective)} sur la chaîne regardée. Espace disque utilisé au maximum : ${estimate(effective)}, libéré en changeant de chaîne.`
          : `Retour arrière possible jusqu'à ${fmtMinutes(effective)}, gardé en mémoire du lecteur (limité sur navigateur et TV).`}
        {!compact && " S'applique au prochain lancement d'une chaîne."}
      </p>
    </div>
  );
}
