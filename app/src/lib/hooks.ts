import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "../store/library";
import { useActiveProfile, useSettings } from "../store/settings";
import { channelVisible } from "./parental";
import type { Channel } from "../types";
import { nowSec } from "./util";
import { sortByLanguage } from "./languages";

/** Chaînes visibles pour le profil actif (contrôle parental appliqué). */
export function useVisibleChannels(): Channel[] {
  const channels = useLibrary((s) => s.channels);
  const profile = useActiveProfile();
  const adultEnabled = useSettings((s) => s.parental.adultEnabled);
  return useMemo(() => {
    if (!profile) return [];
    return sortByLanguage(
      channels.filter((c) => channelVisible(profile, c, adultEnabled)),
      profile.languages,
    );
  }, [channels, profile, adultEnabled]);
}

/** Horloge partagée, rafraîchie toutes les `ms`. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(nowSec);
  useEffect(() => {
    const t = setInterval(() => setNow(nowSec()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [q]);
  return m;
}
