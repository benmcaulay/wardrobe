import { describe, expect, it } from "vitest";
import {
  hexToLCh,
  hueDistance,
  hueRelation,
  isPerceptuallyNeutral,
  itemColorHarmony,
  outfitColorHarmony,
  pairHarmony,
  UNKNOWN_PAIR_SCORE,
} from "@/lib/outfit/color-harmony";

const BLACK = "#000000";
const WHITE = "#ffffff";
const GREY = "#888888";
const NAVY = "#1a2a4a";
const RED = "#c81e1e";
const ORANGE = "#d97a1e";
const GREEN = "#1e9c4a";
const CYAN = "#1ec8c8";
const CHARTREUSE = "#9cd91e";

describe("colour space conversion", () => {
  it("puts greys at near-zero chroma", () => {
    for (const hex of [BLACK, WHITE, GREY]) {
      const lch = hexToLCh(hex)!;
      expect(lch.c).toBeLessThan(2);
      expect(isPerceptuallyNeutral(lch)).toBe(true);
    }
  });

  it("orders greys by lightness", () => {
    expect(hexToLCh(BLACK)!.l).toBeLessThan(hexToLCh(GREY)!.l);
    expect(hexToLCh(GREY)!.l).toBeLessThan(hexToLCh(WHITE)!.l);
  });

  it("gives saturated colours real chroma", () => {
    expect(hexToLCh(RED)!.c).toBeGreaterThan(40);
    expect(isPerceptuallyNeutral(hexToLCh(RED)!)).toBe(false);
  });

  it("treats navy as a near-neutral, which is how it behaves in a wardrobe", () => {
    expect(hexToLCh(NAVY)!.c).toBeLessThan(30);
  });

  it("returns null for unusable hex", () => {
    expect(hexToLCh("not-a-colour")).toBeNull();
    expect(hexToLCh("#fff")).toBeNull();
  });
});

describe("hueDistance", () => {
  it("takes the shorter way round the wheel", () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
  });
});

describe("hueRelation", () => {
  it("names the classic relations", () => {
    expect(hueRelation(20, 25)).toBe("monochrome");
    expect(hueRelation(20, 55)).toBe("analogous");
    expect(hueRelation(20, 200)).toBe("complementary");
    expect(hueRelation(20, 140)).toBe("triadic");
  });

  it("calls the awkward intervals discordant", () => {
    expect(hueRelation(20, 90)).toBe("discordant");
  });
});

describe("pairHarmony", () => {
  it("scores a neutral with anything as the safest pairing", () => {
    expect(pairHarmony(BLACK, RED)).toBeGreaterThan(0.9);
    expect(pairHarmony(WHITE, GREEN)).toBeGreaterThan(0.9);
  });

  it("scores a discordant pair well below a harmonious one", () => {
    const discordant = pairHarmony(RED, CHARTREUSE);
    const complementary = pairHarmony(RED, GREEN);
    const analogous = pairHarmony(RED, ORANGE);
    expect(complementary).toBeGreaterThan(discordant);
    expect(analogous).toBeGreaterThan(discordant);
  });

  it("penalises same-hue pairs that sit at the same lightness as muddy", () => {
    // Two mid-tone browns: same family, no value separation.
    const muddy = pairHarmony("#8a6a45", "#8a7045");
    const separated = pairHarmony("#3a2a15", "#d8c0a0");
    expect(separated).toBeGreaterThan(muddy);
  });

  it("returns the neutral score when a hex is unusable", () => {
    expect(pairHarmony("garbage", RED)).toBe(UNKNOWN_PAIR_SCORE);
  });
});

describe("itemColorHarmony", () => {
  const item = (hex: string, name: string) => [{ hex, name }];

  it("judges on the dominant colour", () => {
    expect(itemColorHarmony(item(BLACK, "black"), item(RED, "red"))).toBeGreaterThan(0.9);
  });

  it("does not let a busy item drag every score to the mean", () => {
    const busy = [
      { hex: BLACK, name: "black" },
      { hex: RED, name: "red" },
      { hex: GREEN, name: "green" },
      { hex: CYAN, name: "cyan" },
    ];
    // Dominant is black, so this still pairs cleanly despite the other colours.
    expect(itemColorHarmony(busy, item(RED, "red"))).toBeGreaterThan(0.9);
  });

  it("stays neutral when one side has no colours at all", () => {
    expect(itemColorHarmony([], item(RED, "red"))).toBe(UNKNOWN_PAIR_SCORE);
    expect(itemColorHarmony(null, null)).toBe(UNKNOWN_PAIR_SCORE);
  });
});

describe("outfitColorHarmony", () => {
  const withColor = (hex: string, name: string) => ({ colors: [{ hex, name }] });

  it("rates an all-neutral look highly", () => {
    const score = outfitColorHarmony([
      withColor(BLACK, "black"),
      withColor(WHITE, "white"),
      withColor(GREY, "grey"),
    ]);
    expect(score).toBeGreaterThan(0.85);
  });

  it("lets one clashing pair pull the whole look down", () => {
    // Three good pieces plus one fighting colour. A plain mean would hide it;
    // the worst-pair term is what surfaces it.
    const clashing = outfitColorHarmony([
      withColor(RED, "red"),
      withColor(CHARTREUSE, "chartreuse"),
      withColor(BLACK, "black"),
    ]);
    const clean = outfitColorHarmony([
      withColor(RED, "red"),
      withColor(BLACK, "black"),
      withColor(WHITE, "white"),
    ]);
    expect(clashing).toBeLessThan(clean);
  });

  it("needs two colourful items to have an opinion", () => {
    expect(outfitColorHarmony([withColor(RED, "red")])).toBe(UNKNOWN_PAIR_SCORE);
    expect(outfitColorHarmony([])).toBe(UNKNOWN_PAIR_SCORE);
  });
});
