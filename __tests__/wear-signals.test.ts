import { describe, expect, it } from "vitest";
import {
  hasUsableTiming,
  isContrastive,
  isPreferenceKind,
  isWearSource,
  PHOTO_CONFIDENCE_CEILING,
  PHOTO_CONFIDENCE_FLOOR,
  PREFERENCE_SIGNAL_WEIGHT,
  resolveWearConfidence,
  WEAR_SIGNAL_WEIGHT,
  WEAR_SOURCE_CONFIDENCE,
} from "@/lib/wear/signals";
import {
  NEUTRAL_OCCASION_PRIOR,
  occasionPriorFromStyleTags,
  parseOccasion,
  rankOccasionsForStyleTags,
} from "@/lib/wear/occasions";

describe("resolveWearConfidence", () => {
  it("falls back to the source default when no score is supplied", () => {
    expect(resolveWearConfidence("explicit")).toBe(1);
    expect(resolveWearConfidence("packing")).toBe(WEAR_SOURCE_CONFIDENCE.packing);
    expect(resolveWearConfidence("photo", null)).toBe(WEAR_SOURCE_CONFIDENCE.photo);
  });

  it("clamps photo matches into their band so inference can never claim certainty", () => {
    expect(resolveWearConfidence("photo", 0.99)).toBe(PHOTO_CONFIDENCE_CEILING);
    expect(resolveWearConfidence("photo", 0.01)).toBe(PHOTO_CONFIDENCE_FLOOR);
    expect(resolveWearConfidence("photo", 0.5)).toBe(0.5);
  });

  it("clamps other sources to [0, 1] and ignores garbage", () => {
    expect(resolveWearConfidence("explicit", 5)).toBe(1);
    expect(resolveWearConfidence("explicit", -2)).toBe(0);
    expect(resolveWearConfidence("explicit", Number.NaN)).toBe(1);
  });
});

describe("signal weighting", () => {
  it("treats a saved outfit as compatibility evidence, not five affinity votes", () => {
    const save = PREFERENCE_SIGNAL_WEIGHT.save;
    expect(save.compatibility).toBeGreaterThan(save.affinity * 4);
    expect(save.polarity).toBe(1);
  });

  it("treats a lock as the mirror image — affinity, not compatibility", () => {
    const lock = PREFERENCE_SIGNAL_WEIGHT.lock;
    expect(lock.affinity).toBeGreaterThan(0.5);
    expect(lock.compatibility).toBe(0);
  });

  it("marks rejections negative", () => {
    expect(PREFERENCE_SIGNAL_WEIGHT.reroll.polarity).toBe(-1);
    expect(PREFERENCE_SIGNAL_WEIGHT.dismiss.polarity).toBe(-1);
    expect(PREFERENCE_SIGNAL_WEIGHT.accept.polarity).toBe(1);
  });

  it("learns nothing about taste from a protect", () => {
    expect(PREFERENCE_SIGNAL_WEIGHT.protect.affinity).toBe(0);
    expect(PREFERENCE_SIGNAL_WEIGHT.protect.compatibility).toBe(0);
  });

  it("does not learn compatibility from packing, where the algorithm chose the set", () => {
    expect(WEAR_SIGNAL_WEIGHT.packing.compatibility).toBe(0);
    expect(WEAR_SIGNAL_WEIGHT.packing.affinity).toBeGreaterThan(0);
  });

  it("excludes backfilled rows from timing analysis but not from counts", () => {
    expect(hasUsableTiming("backfill")).toBe(false);
    expect(hasUsableTiming("explicit")).toBe(true);
    expect(hasUsableTiming("photo")).toBe(true);
    expect(WEAR_SIGNAL_WEIGHT.backfill.affinity).toBeGreaterThan(0);
  });

  it("identifies the kinds that carry a rejected set", () => {
    expect(isContrastive("reroll")).toBe(true);
    expect(isContrastive("dismiss")).toBe(true);
    expect(isContrastive("save")).toBe(false);
  });

  it("validates persisted enum strings", () => {
    expect(isWearSource("photo")).toBe(true);
    expect(isWearSource("telepathy")).toBe(false);
    expect(isPreferenceKind("reroll")).toBe(true);
    expect(isPreferenceKind("shrug")).toBe(false);
  });
});

describe("occasions", () => {
  it("normalizes spacing and hyphens when parsing", () => {
    expect(parseOccasion("going out")).toBe("going_out");
    expect(parseOccasion("Going-Out")).toBe("going_out");
    expect(parseOccasion("brunch")).toBeNull();
    expect(parseOccasion(null)).toBeNull();
  });

  it("bridges style tags to occasions before any wear data exists", () => {
    expect(occasionPriorFromStyleTags("work", ["workwear"])).toBeGreaterThan(0.8);
    expect(occasionPriorFromStyleTags("active", ["athletic"])).toBeGreaterThan(0.9);
    expect(occasionPriorFromStyleTags("home", ["cozy"])).toBeGreaterThan(0.8);
  });

  it("gives untagged items a neutral prior rather than zero", () => {
    // Absence of a tag is not evidence of unsuitability; scoring it as zero
    // would bury every item the user never got round to tagging.
    expect(occasionPriorFromStyleTags("work", [])).toBe(NEUTRAL_OCCASION_PRIOR);
    expect(occasionPriorFromStyleTags("work", ["cozy"])).toBe(NEUTRAL_OCCASION_PRIOR);
  });

  it("takes the strongest tag rather than summing", () => {
    const single = occasionPriorFromStyleTags("work", ["workwear"]);
    const many = occasionPriorFromStyleTags("work", ["workwear", "tailored", "classic"]);
    expect(many).toBe(single);
    expect(many).toBeLessThanOrEqual(1);
  });

  it("ranks the best-fitting occasion first", () => {
    expect(rankOccasionsForStyleTags(["athletic"])[0]).toBe("active");
    expect(rankOccasionsForStyleTags(["going-out"])[0]).toBe("going_out");
  });
});
