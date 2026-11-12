import { create } from "zustand";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import type { VodItem } from "../types";

export type MascotMood = "idle" | "happy" | "surprised" | "sleep" | "dance" | "think" | "wave";

interface FunState {
  bubble: { id: number; text: string } | null;
  mood: MascotMood;
  /** Compteurs de déclenchement des effets (un changement = une animation). */
  confetti: number;
  staticFx: number;
  disco: boolean;
}

export const useFun = create<FunState>()(() => ({ bubble: null, mood: "wave", confetti: 0, staticFx: 0, disco: false }));

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  desc: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_play", icon: "🎬", title: "Premier rendez-vous", desc: "Lancer une première lecture." },
  { id: "zap_50", icon: "🔀", title: "Zappeur confirmé", desc: "Changer 50 fois de chaîne." },
  { id: "zap_500", icon: "🔥", title: "Télécommande en feu", desc: "Changer 500 fois de chaîne." },
  { id: "first_fav", icon: "💜", title: "Coup de cœur", desc: "Ajouter un premier favori." },
  { id: "fav_20", icon: "🗂️", title: "Collectionneur", desc: "Avoir 20 favoris." },
  { id: "night_owl", icon: "🦉", title: "Oiseau de nuit", desc: "Regarder quelque chose entre 1 h et 5 h du matin." },
  { id: "globe_trotter", icon: "🌍", title: "Globe-trotteur", desc: "Écouter des radios de 5 pays différents." },
  { id: "bookworm", icon: "📚", title: "Rat de bibliothèque", desc: "Écouter un livre audio." },
  { id: "cinephile", icon: "🍿", title: "Cinéphile", desc: "Lancer 10 films." },
  { id: "sleuth", icon: "🔎", title: "Fin limier", desc: "Faire 20 recherches." },
  { id: "secret", icon: "🕹️", title: "Petit malin", desc: "Trouver le code secret." },
];

const TIPS = [
  "Appuie sur / pour chercher n'importe quoi, n'importe quand.",
  "Espace met le direct en pause. Je garde la suite au chaud !",
  "Clique sur un acteur pour voir tous ses films disponibles.",
  "Range tes langues préférées dans Réglages › Langues : je trierai tout pour toi.",
  "Le bouton « mini » transforme la vidéo en petite fenêtre au-dessus de tes autres applis.",
  "Dans le guide, un programme passé avec « replay » se revoit d'un clic.",
  "Tu peux créer ton propre écran : couleurs, disposition, taille du texte…",
  "Page ↑ / Page ↓ pour zapper, comme une vraie télécommande.",
  "Note tes films avec les étoiles, je m'en souviendrai.",
  "Tu peux me renommer ou me faire taire dans Réglages › Fun.",
];

function settings() {
  return useSettings.getState();
}

// ------------------------------------------------------------------ Sons

let ctx: AudioContext | null = null;

/** Petits sons synthétisés : aucun fichier audio n'est embarqué. */
export function playSound(kind: "click" | "zap" | "success" | "fav" | "error") {
  const f = settings().fun;
  if (!f.sounds) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const notes: Record<typeof kind, [number, number][]> = {
      click: [[880, 0.04]],
      zap: [[220, 0.05], [660, 0.06]],
      success: [[523, 0.09], [659, 0.09], [784, 0.16]],
      fav: [[660, 0.07], [990, 0.12]],
      error: [[200, 0.15]],
    };
    let at = t;
    for (const [freq, dur] of notes[kind]) {
      const o = ctx.createOscillator();
      o.type = kind === "zap" ? "sawtooth" : "sine";
      o.frequency.setValueAtTime(freq, at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25 * f.soundVolume, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(gain);
      o.start(at);
      o.stop(at + dur + 0.02);
      at += dur * 0.9;
    }
  } catch {
    // Audio indisponible (politique d'autoplay) : on ignore.
  }
}

// ------------------------------------------------------------------ Mascotte

let bubbleTimer: number | undefined;

/** La mascotte parle. `level` : 0 = important (toujours), 1 = normal, 2 = bavardage. */
export function say(text: string, mood: MascotMood = "happy", level: 0 | 1 | 2 = 1) {
  const f = settings().fun;
  if (!f.mascot) return;
  const max = f.chattiness === "quiet" ? 0 : f.chattiness === "normal" ? 1 : 2;
  if (level > max) return;
  clearTimeout(bubbleTimer);
  useFun.setState({ bubble: { id: Date.now(), text }, mood });
  bubbleTimer = window.setTimeout(() => useFun.setState({ bubble: null, mood: idleMood() }), Math.min(9000, 2500 + text.length * 45));
}

export function idleMood(): MascotMood {
  const h = new Date().getHours();
  return h >= 23 || h < 6 ? "sleep" : "idle";
}

export function greeting(name: string) {
  const h = new Date().getHours();
  const hello = h < 5 ? "Encore debout" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  return `${hello} ${name} ! Qu'est-ce qu'on regarde ?`;
}

export function randomTip() {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

// ------------------------------------------------------------------ Succès

export function achieve(id: string) {
  if (!settings().unlockAchievement(id)) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  celebrate();
  playSound("success");
  useUi.getState().toast(`${a.icon} Succès débloqué : ${a.title}`, "success");
  say(`Bravo ! Succès « ${a.title} » débloqué ${a.icon}`, "happy", 0);
}

export function celebrate() {
  if (settings().fun.confetti) useFun.setState((s) => ({ confetti: s.confetti + 1 }));
}

function stat(id: string) {
  const s = settings();
  return s.stats[s.activeProfileId ?? ""]?.[id as "zaps"] ?? 0;
}

export const fun = {
  onPlay(kind: "live" | "zap" | "radio" | "media", item?: VodItem) {
    const s = settings();
    s.bumpStat("plays");
    achieve("first_play");
    const h = new Date().getHours();
    if (h >= 1 && h < 5) achieve("night_owl");
    if (kind === "zap") {
      s.bumpStat("zaps");
      if (s.fun.zapEffect) useFun.setState((st) => ({ staticFx: st.staticFx + 1 }));
      playSound("zap");
      if (stat("zaps") >= 50) achieve("zap_50");
      if (stat("zaps") >= 500) achieve("zap_500");
    }
    if (kind === "radio") {
      useFun.setState({ mood: "dance" });
      if (item?.category) s.addRadioCountry(item.category);
      const countries = s.stats[s.activeProfileId ?? ""]?.radios.length ?? 0;
      if (countries >= 5) achieve("globe_trotter");
    }
    if (item?.kind === "audiobook") achieve("bookworm");
    if (item?.kind === "movie") {
      s.bumpStat("favorites", 0);
      const films = (s.profiles.find((p) => p.id === s.activeProfileId)?.history ?? []).filter((x) => x.kind === "movie").length;
      if (films >= 10) achieve("cinephile");
    }
    if (kind === "media" && item?.kind && ["music", "podcast", "audiobook"].includes(item.kind)) useFun.setState({ mood: "dance" });
  },
  onFavorite(added: boolean, total: number) {
    if (!added) return;
    playSound("fav");
    celebrate();
    achieve("first_fav");
    if (total >= 20) achieve("fav_20");
    say(["Bon choix !", "Ajouté à tes favoris ✨", "Je note, je note…"][Math.floor(Math.random() * 3)], "happy", 2);
  },
  onSearch() {
    settings().bumpStat("searches");
    if (stat("searches") >= 20) achieve("sleuth");
  },
  onStop() {
    useFun.setState({ mood: idleMood() });
  },
};

// ------------------------------------------------------------------ Code secret

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** ↑↑↓↓←→←→BA : 30 secondes de mode disco. */
export function installEasterEggs() {
  let pos = 0;
  const onKey = (e: KeyboardEvent) => {
    if (!settings().fun.easterEggs) return;
    pos = e.key.toLowerCase() === KONAMI[pos].toLowerCase() ? pos + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (pos === KONAMI.length) {
      pos = 0;
      useFun.setState({ disco: true });
      say("Mode disco activé ! 🪩", "dance", 0);
      achieve("secret");
      setTimeout(() => useFun.setState({ disco: false }), 30_000);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** Décoration de saison (ou null). */
export function season(): { emoji: string[]; label: string } | null {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m === 12 || (m === 1 && day <= 6)) return { emoji: ["❄", "❅", "❆"], label: "neige" };
  if (m === 10 && day >= 20) return { emoji: ["🎃", "🦇", "🍂"], label: "Halloween" };
  if (m === 2 && day >= 10 && day <= 15) return { emoji: ["💗", "💜"], label: "Saint-Valentin" };
  if (m === 7 || m === 8) return { emoji: ["☀️", "🌴"], label: "été" };
  return null;
}
