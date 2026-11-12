import { useState } from "react";
import type { Channel } from "../types";

function initials(name: string) {
  return name
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function ChannelLogo({ channel, size = 40 }: { channel: Channel; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, minWidth: size };
  if (channel.logo && !failed) {
    return (
      <span className="logo" style={box}>
        <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="logo logo-fallback" style={{ ...box, background: `hsl(${hue(channel.name)} 45% 32%)`, fontSize: size * 0.36 }}>
      {initials(channel.name) || "TV"}
    </span>
  );
}
