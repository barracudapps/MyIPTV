import { useEffect, useState } from "react";
import { getBackend } from "../platform";
import { useLibrary } from "../store/library";
import type { Profile } from "./parental";
import type { VodItem, VodKind } from "../types";

export interface Suggestion {
  title: string;
  items: VodItem[];
}

const SEEDS = 12;
const ROW = 24;

/**
 * Suggestions calculées sur l'appareil à partir de l'historique et de « Ma liste » du
 * profil : genres les plus vus, puis le dernier contenu regardé. Rien ne quitte l'appareil.
 */
export function useRecommendations(kind: VodKind, profile: Profile, includeAdult: boolean): Suggestion[] {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const version = useLibrary((s) => s.libraryVersion);
  const seedIds = [...profile.history.filter((h) => h.kind === kind).map((h) => h.itemId), ...profile.vodFavorites].filter((id, i, all) => all.indexOf(id) === i).slice(0, SEEDS);
  const key = `${kind}|${seedIds.join(",")}|${profile.languages.join()}|${includeAdult}|${version}`;

  useEffect(() => {
    if (!seedIds.length) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const b = await getBackend();
      const seeds = (await b.vodQuery({ ids: seedIds, kind, preferLanguages: [], includeAdult, limit: SEEDS })).items;
      const order = new Map(seedIds.map((id, i) => [id, i]));
      seeds.sort((a, c) => (order.get(a.id) ?? 99) - (order.get(c.id) ?? 99));
      const known = new Set([...seedIds, ...profile.history.map((h) => h.itemId)]);
      // Genres pondérés : les contenus les plus récents comptent davantage.
      const weight = new Map<string, number>();
      seeds.forEach((it, i) => (it.genres ?? []).forEach((g) => weight.set(g, (weight.get(g) ?? 0) + (SEEDS - i))));
      const genres = [...weight.entries()].sort((a, c) => c[1] - a[1]).map(([g]) => g);
      // Genres très précis (« French New Wave ») : on complète avec les suivants.
      const pick = async (list: string[], exclude: Set<string>) => {
        const found: VodItem[] = [];
        for (const genre of list.slice(0, 5)) {
          const page = await b.vodQuery({ kind, genre, sort: "rating", preferLanguages: profile.languages, includeAdult, limit: ROW * 2 });
          for (const it of page.items) if (!known.has(it.id) && !exclude.has(it.id) && !found.some((f) => f.id === it.id)) found.push(it);
          if (found.length >= ROW) break;
        }
        return found.slice(0, ROW);
      };
      const out: Suggestion[] = [];
      const shown = new Set<string>();
      const forYou = await pick(genres, shown);
      forYou.forEach((it) => shown.add(it.id));
      if (forYou.length >= 4) out.push({ title: "Recommandé pour vous", items: forYou });
      // Dernier contenu regardé : ses propres genres, pour une rangée distincte.
      const last = seeds[0];
      if (last?.genres?.length && seeds.length > 1) {
        const items = await pick(last.genres, shown);
        const watched = profile.history.some((h) => h.itemId === last.id);
        if (items.length >= 4) out.push({ title: watched ? `Parce que vous avez regardé « ${last.title} »` : `Parce que « ${last.title} » est dans votre liste`, items });
      }
      if (!cancelled) setRows(out);
    })().catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return rows;
}
