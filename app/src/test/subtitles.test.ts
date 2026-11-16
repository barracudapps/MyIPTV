import { describe, expect, it } from "vitest";
import { parseSubtitles } from "../lib/subtitles";

describe("parseSubtitles", () => {
  it("lit un fichier SRT avec balises et fins de ligne Windows", () => {
    const srt = "1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color=\"#fff\">Bonjour</font>\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\nDeux\r\nlignes\r\n";
    expect(parseSubtitles(srt)).toEqual([
      { start: 1.5, end: 3, text: "Bonjour" },
      { start: 62, end: 64.25, text: "Deux\nlignes" },
    ]);
  });

  it("lit un fichier WebVTT avec réglages de position et heures", () => {
    const vtt = "WEBVTT\n\n01:00:00.000 --> 01:00:02.500 align:start\nSalut\n";
    expect(parseSubtitles(vtt)).toEqual([{ start: 3600, end: 3602.5, text: "Salut" }]);
  });

  it("ignore les blocs incohérents", () => {
    expect(parseSubtitles("1\n00:00:05,000 --> 00:00:04,000\nÀ l'envers\n\nnimporte quoi")).toEqual([]);
  });
});
