import { describe, expect, it } from "vitest";
import { channelIds, groupChannels, qualityOf } from "../lib/variants";
import type { Channel } from "../types";

const ch = (id: string, name: string, over: Partial<Channel> = {}): Channel => ({ id, sourceId: "s", name, url: `https://x/${id}`, ...over });

describe("regroupement des copies d'une chaîne", () => {
  it("lit la qualité dans le nom", () => {
    expect(qualityOf("Arte HD")).toBe(720);
    expect(qualityOf("Arte 1080p")).toBe(1080);
  });

  it("regroupe les copies et garde les autres chaînes à part", () => {
    const grouped = groupChannels([ch("a", "Arte HD"), ch("b", "Arte SD"), ch("c", "France 24")]);
    expect(grouped).toHaveLength(2);
    const arte = grouped.find((c) => c.name.startsWith("Arte"))!;
    expect(channelIds(arte).sort()).toEqual(["a", "b"]);
  });
});
