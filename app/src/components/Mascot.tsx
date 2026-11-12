import { useEffect, useMemo, useState } from "react";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { usePlayer } from "../store/player";
import { greeting, idleMood, randomTip, say, season, useFun, type MascotMood } from "../lib/fun";

export type MascotKind = "zapi" | "ondine" | "pop" | "clap" | "mistigri" | "astro";

/** Mascottes originales de MyIPTV : chacune a un corps à elle, toutes partagent le même visage expressif. */
export const MASCOTS: { kind: MascotKind; name: string; desc: string }[] = [
  { kind: "zapi", name: "Zapi", desc: "Petit téléviseur rétro à antennes" },
  { kind: "ondine", name: "Ondine", desc: "Radio vintage, fan de podcasts" },
  { kind: "pop", name: "Pop", desc: "Pot de pop-corn gourmand" },
  { kind: "clap", name: "Clap", desc: "Clap de cinéma, toujours prêt à tourner" },
  { kind: "mistigri", name: "Mistigri", desc: "Chat mélomane à casque" },
  { kind: "astro", name: "Astro", desc: "Satellite qui capte les chaînes du monde" },
];

const INK = "#0b1020";

function Face({ mood, blink, panel }: { mood: MascotMood; blink: boolean; panel: boolean }) {
  const eyes = (() => {
    if (mood === "sleep") return <path d="M30 47 q5 4 10 0 M54 47 q5 4 10 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />;
    if (mood === "happy" || mood === "dance") return <path d="M30 49 q5 -6 10 0 M54 49 q5 -6 10 0" stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />;
    if (blink) return <path d="M30 47 h10 M54 47 h10" stroke={INK} strokeWidth="3" strokeLinecap="round" />;
    const r = mood === "surprised" ? 6 : 4.5;
    const look = mood === "think" ? -2 : 0;
    return (
      <>
        <circle cx={35 + look} cy={46 + look} r={r} fill={INK} />
        <circle cx={59 + look} cy={46 + look} r={r} fill={INK} />
        <circle cx={36.5 + look} cy={44.5 + look} r={1.4} fill="#fff" />
        <circle cx={60.5 + look} cy={44.5 + look} r={1.4} fill="#fff" />
      </>
    );
  })();
  const mouth =
    mood === "surprised" ? <ellipse cx="47" cy="59" rx="4" ry="5" fill={INK} /> :
    mood === "sleep" ? <path d="M43 59 h8" stroke={INK} strokeWidth="2.5" strokeLinecap="round" /> :
    mood === "think" ? <path d="M42 60 q5 -3 10 0" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" /> :
    <path d="M40 57 q7 8 14 0" stroke={INK} strokeWidth="3" fill={mood === "happy" || mood === "dance" ? "#ff8fa3" : "none"} strokeLinecap="round" />;
  return (
    <>
      {panel && (
        <>
          <circle cx="26" cy="58" r="4" fill="#ff9eb5" opacity=".7" />
          <circle cx="68" cy="58" r="4" fill="#ff9eb5" opacity=".7" />
        </>
      )}
      {eyes}
      {mouth}
    </>
  );
}

/** Corps de chaque mascotte ; la partie animée (antennes, oreilles…) porte la classe `antennas`. */
function Body({ kind, color }: { kind: MascotKind; color: string }) {
  switch (kind) {
    case "ondine":
      return (
        <>
          <g className="antennas">
            <path d="M62 24 L78 2" stroke="#cfd6e6" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="78" cy="2" r="3.5" fill="#ffd166" />
          </g>
          <path d="M30 26 q17 -16 34 0" stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" />
          <rect x="4" y="24" width="86" height="60" rx="14" fill={color} />
          <rect x="4" y="24" width="86" height="60" rx="14" fill="url(#m-shine)" />
          <rect x="14" y="32" width="66" height="42" rx="18" fill="#fde9c9" />
          <g fill={color} opacity=".35">
            {[0, 1, 2, 3].map((i) => <rect key={i} x="22" y={66 + i * 2.4} width="50" height="1.4" rx=".7" />)}
          </g>
          <circle cx="84" cy="34" r="3" fill="#fff" opacity=".85" />
          <g className="feet">
            <rect x="18" y="84" width="14" height="7" rx="3" fill={color} />
            <rect x="62" y="84" width="14" height="7" rx="3" fill={color} />
          </g>
        </>
      );
    case "pop":
      return (
        <>
          <g className="antennas">
            {[[24, 22, 10], [38, 14, 11], [54, 13, 11], [69, 20, 10], [31, 26, 9], [62, 26, 9], [47, 22, 10]].map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? "#fff6d5" : "#fffaf0"} stroke="#f2d48a" strokeWidth="1.2" />
            ))}
          </g>
          <path d="M10 28 H84 L76 92 H18 Z" fill="#fff" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${14 + i * 19} 28 h10 l-2 64 h-8 Z`} fill={color} />
          ))}
          <rect x="18" y="34" width="58" height="38" rx="14" fill="#fffaf0" />
          <path d="M10 28 H84 L76 92 H18 Z" fill="url(#m-shine)" />
        </>
      );
    case "clap":
      return (
        <>
          <g className="antennas clapper">
            <rect x="8" y="10" width="78" height="13" rx="3" fill="#20242e" transform="rotate(-10 8 23)" />
            {[0, 1, 2, 3, 4].map((i) => (
              <path key={i} d={`M${14 + i * 15} 10 l8 0 l-6 13 l-8 0 Z`} fill="#f4f4f4" transform="rotate(-10 8 23)" />
            ))}
          </g>
          <rect x="8" y="24" width="78" height="62" rx="8" fill="#20242e" />
          <rect x="8" y="24" width="78" height="10" rx="3" fill={color} />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${14 + i * 15} 24 l8 0 l-6 10 l-8 0 Z`} fill="#f4f4f4" />
          ))}
          <rect x="15" y="36" width="64" height="42" rx="9" fill="#e8ecf4" />
          <path d="M20 80 h54" stroke={color} strokeWidth="2.4" strokeLinecap="round" opacity=".9" />
          <g className="feet">
            <rect x="22" y="86" width="12" height="7" rx="3" fill="#20242e" />
            <rect x="60" y="86" width="12" height="7" rx="3" fill="#20242e" />
          </g>
        </>
      );
    case "mistigri":
      return (
        <>
          <g className="antennas">
            <path d="M14 34 L18 6 L40 22 Z" fill={color} />
            <path d="M80 34 L76 6 L54 22 Z" fill={color} />
            <path d="M20 26 L21 14 L32 22 Z" fill="#ffb3c6" />
            <path d="M74 26 L73 14 L62 22 Z" fill="#ffb3c6" />
          </g>
          <ellipse cx="47" cy="52" rx="38" ry="34" fill={color} />
          <ellipse cx="47" cy="52" rx="38" ry="34" fill="url(#m-shine)" />
          <ellipse cx="47" cy="54" rx="28" ry="24" fill="#f6efe6" />
          <path d="M8 46 q39 -50 78 0" stroke="#2b2f3a" strokeWidth="5" fill="none" strokeLinecap="round" />
          <rect x="1" y="40" width="13" height="22" rx="6" fill="#2b2f3a" />
          <rect x="80" y="40" width="13" height="22" rx="6" fill="#2b2f3a" />
          <path d="M28 60 h-14 M28 63 l-13 4 M66 60 h14 M66 63 l13 4" stroke="#8a8f9c" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M45 53 h4 l-2 2.4 Z" fill="#ff8fa3" />
          <g className="feet">
            <ellipse cx="32" cy="88" rx="8" ry="5" fill={color} />
            <ellipse cx="62" cy="88" rx="8" ry="5" fill={color} />
          </g>
        </>
      );
    case "astro":
      return (
        <>
          <g className="antennas">
            <path d="M47 18 L47 4" stroke="#cfd6e6" strokeWidth="3" strokeLinecap="round" />
            <circle cx="47" cy="4" r="4" fill="#ffd166" />
            <path d="M38 10 q9 -8 18 0" stroke="#ffd166" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity=".8" />
          </g>
          <rect x="-6" y="40" width="20" height="26" rx="3" fill="#2f5fd0" />
          <rect x="80" y="40" width="20" height="26" rx="3" fill="#2f5fd0" />
          <path d="M-6 49 h20 M-6 57 h20 M4 40 v26 M80 49 h20 M80 57 h20 M90 40 v26" stroke="#9cc0ff" strokeWidth="1" />
          <circle cx="47" cy="52" r="36" fill={color} />
          <circle cx="47" cy="52" r="36" fill="url(#m-shine)" />
          <circle cx="47" cy="52" r="27" fill="#d9f2ff" />
          <circle cx="47" cy="52" r="27" fill="url(#m-scan)" opacity=".25" />
        </>
      );
    default:
      return (
        <>
          <g className="antennas">
            <path d="M38 22 L26 6" stroke="#cfd6e6" strokeWidth="3" strokeLinecap="round" />
            <path d="M56 22 L70 4" stroke="#cfd6e6" strokeWidth="3" strokeLinecap="round" />
            <circle cx="26" cy="6" r="4" fill="#ffd166" />
            <circle cx="70" cy="4" r="4" fill="#ff6b9a" />
          </g>
          <rect x="8" y="22" width="78" height="60" rx="16" fill={color} />
          <rect x="8" y="22" width="78" height="60" rx="16" fill="url(#m-shine)" />
          <rect x="16" y="30" width="58" height="44" rx="11" fill="#bff3ff" />
          <rect x="16" y="30" width="58" height="44" rx="11" fill="url(#m-scan)" opacity=".35" />
          <circle cx="80" cy="40" r="2.6" fill="#fff" opacity=".85" />
          <circle cx="80" cy="50" r="2.6" fill="#fff" opacity=".6" />
          <g className="feet">
            <rect x="22" y="82" width="12" height="10" rx="4" fill={color} />
            <rect x="60" y="82" width="12" height="10" rx="4" fill={color} />
          </g>
        </>
      );
  }
}

/** Mascotte dessinée : corps selon `kind`, visage selon l'humeur, clignement des yeux. */
export function MascotFigure({ mood, color, kind = "zapi", size = 72 }: { mood: MascotMood; color: string; kind?: MascotKind; size?: number }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 3800 + Math.random() * 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <svg className={`mascot-svg mood-${mood} mascot-${kind}`} width={size} height={size} viewBox="-6 0 106 100" aria-hidden="true">
      <defs>
        <linearGradient id="m-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <pattern id="m-scan" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.4" fill="#7fd8ef" />
        </pattern>
      </defs>
      <Body kind={kind} color={color} />
      <Face mood={mood} blink={blink} panel={kind !== "mistigri"} />
      {mood === "sleep" && (
        <text x="78" y="22" className="zzz" fontSize="14" fill="#cfd6e6">
          z
        </text>
      )}
    </svg>
  );
}

/** Mascotte flottante avec bulle de dialogue. */
export function Mascot() {
  const f = useSettings((s) => s.fun);
  const profile = useActiveProfile();
  const { bubble, mood } = useFun();
  const view = useUi((s) => s.view);
  const playing = usePlayer((s) => s.channel != null || s.media != null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (profile) say(greeting(profile.name), "wave", 1);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une astuce de temps en temps (mode bavard seulement), jamais pendant la lecture plein écran.
  useEffect(() => {
    if (f.chattiness !== "chatty") return;
    const t = setInterval(() => !document.fullscreenElement && say(randomTip(), "think", 2), 4 * 60_000);
    return () => clearInterval(t);
  }, [f.chattiness]);

  useEffect(() => {
    if (!playing) useFun.setState({ mood: idleMood() });
  }, [playing]);

  if (!f.mascot || hidden) return null;
  return (
    <div className={`mascot ${view === "live" && playing ? "mascot-dim" : ""}`}>
      {bubble && (
        <div className="mascot-bubble" key={bubble.id} role="status">
          {bubble.text}
        </div>
      )}
      <button
        className="mascot-btn"
        title={`${f.mascotName} — clic : une astuce · double-clic : masquer`}
        onClick={() => say(randomTip(), "think", 0)}
        onDoubleClick={() => setHidden(true)}
      >
        <MascotFigure mood={mood} color={f.mascotColor} kind={f.mascotKind ?? "zapi"} />
      </button>
    </div>
  );
}

/** Confettis, neige du zapping, décorations de saison et mode disco. */
export function FunLayer() {
  const f = useSettings((s) => s.fun);
  const { confetti, staticFx, disco } = useFun();
  const [bursts, setBursts] = useState<number[]>([]);
  const [noise, setNoise] = useState(false);

  useEffect(() => {
    if (!confetti) return;
    setBursts((b) => [...b, confetti]);
    const t = setTimeout(() => setBursts((b) => b.filter((x) => x !== confetti)), 2200);
    return () => clearTimeout(t);
  }, [confetti]);

  useEffect(() => {
    if (!staticFx) return;
    setNoise(true);
    const t = setTimeout(() => setNoise(false), 380);
    return () => clearTimeout(t);
  }, [staticFx]);

  useEffect(() => {
    document.documentElement.classList.toggle("disco", disco);
  }, [disco]);

  const deco = useMemo(() => (f.seasonal ? season() : null), [f.seasonal]);

  return (
    <div className="fun-layer" aria-hidden="true">
      {bursts.map((b) => (
        <div key={b} className="confetti">
          {Array.from({ length: 36 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 37) % 100}%`, background: `hsl(${(i * 47) % 360} 90% 60%)`, animationDelay: `${(i % 6) * 0.04}s`, ["--dx" as string]: `${((i * 53) % 120) - 60}px` }} />
          ))}
        </div>
      ))}
      {noise && <div className="tv-static" />}
      {deco && (
        <div className="season">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 61) % 100}%`, animationDuration: `${9 + (i % 7)}s`, animationDelay: `${-i * 1.3}s` }}>
              {deco.emoji[i % deco.emoji.length]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
