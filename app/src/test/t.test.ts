import { describe, expect, it } from "vitest";
import { t } from "../lib/t";

describe("traduction de l'interface", () => {
  it("remplace les variables et garde le français sans traduction", () => {
    expect(t("Texte sans traduction {n}", { n: 3 })).toBe("Texte sans traduction 3");
    expect(t("Variable {absente}")).toBe("Variable {absente}");
  });
});
