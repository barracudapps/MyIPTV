/** Codes de langue des pistes (ISO 639-2/3, « fr-FR », noms) ramenés à ISO 639-1. */
const MAP: Record<string, string> = {
  fra: "fr", fre: "fr", french: "fr", francais: "fr", "français": "fr",
  eng: "en", english: "en", anglais: "en",
  spa: "es", spanish: "es", esp: "es",
  deu: "de", ger: "de", german: "de",
  ita: "it", italian: "it",
  por: "pt", portuguese: "pt",
  nld: "nl", dut: "nl", dutch: "nl",
  ara: "ar", arabic: "ar",
  tur: "tr", turkish: "tr",
  rus: "ru", russian: "ru",
  pol: "pl", polish: "pl",
  jpn: "ja", japanese: "ja",
  kor: "ko", korean: "ko",
  zho: "zh", chi: "zh", chinese: "zh",
  hin: "hi", hindi: "hi",
};

export function code639_1(lang?: string): string | undefined {
  if (!lang) return undefined;
  const l = lang.trim().toLowerCase();
  if (!l || l === "und") return undefined;
  const base = l.split(/[-_]/)[0];
  if (base.length === 2) return base;
  return MAP[base] ?? MAP[l];
}
