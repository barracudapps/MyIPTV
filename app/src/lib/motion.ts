import { useCallback, useRef, useState } from "react";

/** Durée des animations de fermeture (doit suivre la feuille de style). */
export const EXIT_MS = 160;

function motionOff(): boolean {
  return document.documentElement.dataset.motion === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Laisse le temps à l'animation de fermeture avant de retirer l'élément.
 * `closing` passe à vrai, puis `onClose` est appelé ; immédiat si les animations sont coupées.
 */
export function useExit(onClose: (() => void) | undefined): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const pending = useRef(false);
  const requestClose = useCallback(() => {
    if (!onClose || pending.current) return;
    if (motionOff()) return onClose();
    pending.current = true;
    setClosing(true);
    window.setTimeout(() => {
      pending.current = false;
      setClosing(false);
      onClose();
    }, EXIT_MS);
  }, [onClose]);
  return [closing, requestClose];
}
