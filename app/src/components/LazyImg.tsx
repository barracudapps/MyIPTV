import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

/** Temps passé à l'écran avant de charger : les images survolées en défilement rapide sont ignorées. */
const DWELL_MS = 100;
/** Au-delà de cette distance de l'écran, une image chargée est libérée. */
const FAR_MARGIN = "200% 200%";

type Watcher = (visible: boolean) => void;

/** Deux observateurs partagés par toutes les images : visibilité réelle et éloignement. */
function makeObserver(rootMargin: string) {
  const watchers = new Map<Element, Watcher>();
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => entries.forEach((e) => watchers.get(e.target)?.(e.isIntersecting)), { rootMargin, threshold: 0 })
      : null;
  return {
    supported: io != null,
    watch(el: Element, fn: Watcher) {
      watchers.set(el, fn);
      io?.observe(el);
      return () => {
        watchers.delete(el);
        io?.unobserve(el);
      };
    },
  };
}

const onScreen = makeObserver("0px");
const nearScreen = makeObserver(FAR_MARGIN);

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  /** Classe de l'enveloppe, qui garde la place de l'image avant son chargement. */
  wrapClassName?: string;
  /** Libère l'image quand elle s'éloigne de l'écran (grandes grilles). */
  unload?: boolean;
};

/**
 * Image chargée seulement après DWELL_MS d'affichage effectif, puis libérée quand elle
 * s'éloigne de l'écran : moins de requêtes et de mémoire sur les longues listes.
 */
export function LazyImg({ src, wrapClassName, unload = true, onLoad, ...img }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(!onScreen.supported);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onScreen.supported) return;
    let timer: number | undefined;
    const stopVisible = onScreen.watch(el, (visible) => {
      window.clearTimeout(timer);
      if (visible) timer = window.setTimeout(() => setActive(true), DWELL_MS);
    });
    const stopNear = unload
      ? nearScreen.watch(el, (near) => {
          if (!near) {
            setActive(false);
            setReady(false);
          }
        })
      : undefined;
    return () => {
      window.clearTimeout(timer);
      stopVisible();
      stopNear?.();
    };
  }, [unload]);

  // Nouvelle adresse : on repart de zéro (le délai de visibilité s'applique de nouveau).
  useEffect(() => setReady(false), [src]);

  return (
    <span ref={ref} className={`lazy-img ${ready ? "ready" : ""} ${wrapClassName ?? ""}`}>
      {active && (
        <img
          {...img}
          src={src}
          decoding="async"
          onLoad={(e) => {
            setReady(true);
            onLoad?.(e);
          }}
        />
      )}
    </span>
  );
}
