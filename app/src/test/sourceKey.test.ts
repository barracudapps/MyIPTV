import { describe, expect, it } from "vitest";
import { findDuplicate, normalizeUrl, uniqueName } from "../lib/sourceKey";
import type { Source } from "../types";

const src = (over: Partial<Source>): Source => ({ id: Math.random().toString(36), name: "Liste", kind: "m3uUrl", epgUrls: [], enabled: true, addedAt: 0, ...over }) as Source;

describe("identité des sources", () => {
  it("reconnaît une même adresse écrite différemment", () => {
    expect(normalizeUrl("HTTPS://Example.com:443/list.m3u/")).toBe(normalizeUrl("https://example.com/list.m3u"));
  });

  it("refuse une source déjà présente", () => {
    const existing = [src({ url: "https://example.com/a.m3u" })];
    expect(findDuplicate(src({ url: "https://EXAMPLE.com/a.m3u" }), existing)).toBe(existing[0]);
    expect(findDuplicate(src({ url: "https://example.com/b.m3u" }), existing)).toBeUndefined();
  });

  it("numérote les noms déjà pris", () => {
    const list = [src({ name: "Ma liste" })];
    expect(uniqueName("Ma liste", list)).not.toBe("Ma liste");
    expect(uniqueName("Autre", list)).toBe("Autre");
  });
});
