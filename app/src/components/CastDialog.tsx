import { useEffect, useState } from "react";
import { getBackend, type CastDevice } from "../platform";
import { useCast } from "../store/cast";
import { Modal } from "./Dialogs";
import { Icon } from "./Icon";

type PickerVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  remote?: { prompt(): Promise<void> };
};

/** Choix de l'écran : Chromecast et DLNA trouvés sur le réseau, AirPlay ou diffusion du navigateur. */
export function CastDialog({ video, onClose }: { video: HTMLVideoElement | null; onClose(): void }) {
  const [devices, setDevices] = useState<CastDevice[] | null>(null);
  const [native, setNative] = useState(true);
  const starting = useCast((s) => s.starting);
  const v = video as PickerVideo | null;
  const airplay = typeof v?.webkitShowPlaybackTargetPicker === "function";
  const remote = typeof v?.remote?.prompt === "function";

  const scan = async () => {
    setDevices(null);
    const b = await getBackend();
    if (!b.cast) {
      setNative(false);
      setDevices([]);
      return;
    }
    setDevices(await b.cast.discover().catch(() => []));
  };
  useEffect(() => void scan(), []);

  return (
    <Modal title="Diffuser sur un autre écran" onClose={onClose}>
      <div className="cast-list">
        {native && devices === null && (
          <p className="dim row">
            <span className="spinner tiny" /> Recherche des écrans sur le réseau…
          </p>
        )}
        {devices?.map((d) => (
          <button key={d.id} className="cast-device" disabled={starting} onClick={() => void useCast.getState().start(d).then(onClose)}>
            <Icon name={d.kind === "chromecast" ? "cast" : "tv"} />
            <span>
              <strong>{d.name}</strong>
              <span className="dim small">{[d.kind === "chromecast" ? "Chromecast / Google TV" : "Téléviseur DLNA", d.model].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        ))}
        {airplay && (
          <button className="cast-device" onClick={() => (v!.webkitShowPlaybackTargetPicker!(), onClose())}>
            <Icon name="tv" />
            <span>
              <strong>AirPlay</strong>
              <span className="dim small">Apple TV et téléviseurs compatibles</span>
            </span>
          </button>
        )}
        {remote && (
          <button className="cast-device" onClick={() => void v!.remote!.prompt().catch(() => undefined).then(onClose)}>
            <Icon name="cast" />
            <span>
              <strong>Écran proposé par le navigateur</strong>
              <span className="dim small">Chromecast et écrans compatibles</span>
            </span>
          </button>
        )}
        {devices && devices.length === 0 && (
          <p className="dim small">
            {native
              ? "Aucun écran trouvé. Vérifiez qu'il est allumé et connecté au même réseau Wi-Fi, puis relancez la recherche."
              : "Depuis le navigateur, seuls AirPlay et la diffusion intégrée au navigateur sont possibles ; l'application de bureau ou Android trouve aussi les Chromecast et téléviseurs DLNA."}
          </p>
        )}
        {native && devices !== null && (
          <button className="btn" onClick={() => void scan()}>
            <Icon name="refresh" /> Relancer la recherche
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Bandeau de contrôle pendant une diffusion, par-dessus le lecteur. */
export function CastBar() {
  const device = useCast((s) => s.device);
  const status = useCast((s) => s.status);
  if (!device || !status) return null;
  const playing = status.state === "PLAYING";
  const duration = status.duration ?? 0;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className="cast-overlay" role="region" aria-label="Diffusion en cours">
      <Icon name="cast" size={40} />
      <strong>Diffusion sur {device.name}</strong>
      <span className="dim">{status.state === "BUFFERING" ? "Chargement sur l'écran…" : playing ? "Lecture en cours" : status.state === "PAUSED" ? "En pause" : "Connexion…"}</span>
      {duration > 0 && (
        <div className="cast-seek">
          <span>{fmt(status.position)}</span>
          <input type="range" min={0} max={duration} step={1} value={status.position} onChange={(e) => useCast.getState().control("seek", +e.target.value)} aria-label="Position" />
          <span>{fmt(duration)}</span>
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" onClick={() => useCast.getState().control(playing ? "pause" : "play")}>
          <Icon name={playing ? "pause" : "play"} /> {playing ? "Pause" : "Lecture"}
        </button>
        <button className="btn" onClick={() => useCast.getState().stop()}>
          <Icon name="close" /> Arrêter la diffusion
        </button>
      </div>
    </div>
  );
}
