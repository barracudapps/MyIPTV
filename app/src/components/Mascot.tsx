import { useEffect, useMemo, useState } from "react";
import { useActiveProfile, useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { usePlayer } from "../store/player";
import { greeting, idleMood, randomTip, say, season, useFun, type MascotMood } from "../lib/fun";

/**
 * Zapi : petit téléviseur rétro à antennes, mascotte originale de MyIPTV.
 * Son écran affiche ses expressions ; il réagit à ce qui se passe dans l'application.
 */
export function MascotFigure({ mood, color, size = 72 }: { mood: MascotMood; color: string; size?: number }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 3800 + Math.random() * 2000);
    return () => clearInterval(t);
  }, []);
  const eyes = (() => {
    if (mood === "sleep") return <path d="M30 47 q5 4 10 0 M54 47 q5 4 10 0" stroke="#0b1020" strokeWidth="3" fill="none" strokeLinecap="round" />;
    if (mood === "happy" || mood === "dance") return <path d="M30 49 q5 -6 10 0 M54 49 q5 -6 10 0" stroke="#0b1020" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
    if (blink) return <path d="M30 47 h10 M54 47 h10" stroke="#0b1020" strokeWidth="3" strokeLinecap="round" />;
    const r = mood === "surprised" ? 6 : 4.5;
    const look = mood === "think" ? -2 : 0;
    return (
      <>
        <circle cx={35 + look} cy={46 + look} r={r} fill="#0b1020" />
        <circle cx={59 + look} cy={46 + look} r={r} fill="#0b1020" />
        <circle cx={36.5 + look} cy={44.5 + look} r={1.4} fill="#fff" />
        <circle cx={60.5 + look} cy={44.5 + look} r={1.4} fill="#fff" />
      </>
    );
  })();
  const mouth =
    mood === "surprised" ? <ellipse cx="47" cy="59" rx="4" ry="5" fill="#0b1020" /> :
    mood === "sleep" ? <path d="M43 59 h8" stroke="#0b1020" strokeWidth="2.5" strokeLinecap="round" /> :
    mood === "think" ? <path d="M42 60 q5 -3 10 0" stroke="#0b1020" strokeWidth="2.5" fill="none" strokeLinecap="round" /> :
    <path d="M40 57 q7 8 14 0" stroke="#0b1020" strokeWidth="3" fill={mood === "happy" || mood === "dance" ? "#ff8fa3" : "none"} strokeLinecap="round" />;

  return (
    <svg className={`mascot-svg mood-${mood}`} width={size} height={size} viewBox="0 0 94 100" aria-hidden="true">
      {/* Antennes */}
      <g className="antennas">
        <path d="M38 22 L26 6" stroke="#cfd6e6" strokeWidth="3" strokeLinecap="round" />
        <path d="M56 22 L70 4" stroke="#cfd6e6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="26" cy="6" r="4" fill="#ffd166" />
        <circle cx="70" cy="4" r="4" fill="#ff6b9a" />
      </g>
      {/* Corps */}
      <rect x="8" y="22" width="78" height="60" rx="16" fill={color} />
      <rect x="8" y="22" width="78" height="60" rx="16" fill="url(#zapi-shine)" />
      {/* Écran-visage */}
      <rect x="16" y="30" width="58" height="44" rx="11" fill="#bff3ff" />
      <rect x="16" y="30" width="58" height="44" rx="11" fill="url(#zapi-scan)" opacity=".35" />
      <circle cx="26" cy="58" r="4" fill="#ff9eb5" opacity=".7" />
      <circle cx="66" cy="58" r="4" fill="#ff9eb5" opacity=".7" />
      {eyes}
      {mouth}
      {/* Boutons */}
      <circle cx="80" cy="40" r="2.6" fill="#fff" opacity=".85" />
      <circle cx="80" cy="50" r="2.6" fill="#fff" opacity=".6" />
      {/* Pieds */}
      <g className="feet">
        <rect x="22" y="82" width="12" height="10" rx="4" fill={color} />
        <rect x="60" y="82" width="12" height="10" rx="4" fill={color} />
      </g>
      <defs>
        <linearGradient id="zapi-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <pattern id="zapi-scan" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.4" fill="#7fd8ef" />
        </pattern>
      </defs>
      {mood === "sleep" && (
        <text x="74" y="22" className="zzz" fontSize="14" fill="#cfd6e6">
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
        <MascotFigure mood={mood} color={f.mascotColor} />
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
