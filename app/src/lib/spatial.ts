/**
 * Navigation spatiale pour télécommande / clavier : les flèches déplacent le
 * focus vers l'élément le plus proche dans la direction demandée.
 */

type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]';

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

function scope(): ParentNode {
  // Les boîtes de dialogue capturent la navigation.
  const dialogs = document.querySelectorAll<HTMLElement>("[data-modal]");
  if (dialogs.length) return dialogs[dialogs.length - 1];
  // Grand lecteur d'un film : le focus reste sur ses commandes, l'écran dessous est masqué.
  return document.querySelector<HTMLElement>("[data-player-scope]") ?? document;
}

export function moveFocus(dir: Dir): boolean {
  const from = document.activeElement as HTMLElement | null;
  const all = [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e !== from && visible(e));
  if (!all.length) return false;
  if (!from || from === document.body) {
    all[0].focus();
    return true;
  }
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    let main: number;
    let cross: number;
    switch (dir) {
      case "ArrowRight":
        if (b.left < a.right - 4) continue;
        main = dx;
        cross = Math.abs(dy);
        break;
      case "ArrowLeft":
        if (b.right > a.left + 4) continue;
        main = -dx;
        cross = Math.abs(dy);
        break;
      case "ArrowDown":
        if (b.top < a.bottom - 4) continue;
        main = dy;
        cross = Math.abs(dx);
        break;
      case "ArrowUp":
        if (b.bottom > a.top + 4) continue;
        main = -dy;
        cross = Math.abs(dx);
        break;
    }
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  return false;
}

/**
 * `onBack` renvoie `false` quand il n'y a plus rien à fermer. Le bouton Retour d'Android
 * n'arrive pas en touche clavier : l'activité appelle `window.__myiptvBack()`.
 */
export function installSpatialNavigation(onBack: () => boolean) {
  (window as unknown as { __myiptvBack?: () => boolean }).__myiptvBack = onBack;
  const handler = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
    if (e.key.startsWith("Arrow")) {
      // Dans un champ texte, gauche/droite déplacent le curseur.
      if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (t.closest("[data-own-arrows]")) return;
      if (moveFocus(e.key as Dir)) e.preventDefault();
    } else if (e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack" || (e.key === "Backspace" && !typing) || e.keyCode === 10009 /* Tizen */ || e.keyCode === 461 /* webOS */) {
      e.preventDefault();
      onBack();
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
