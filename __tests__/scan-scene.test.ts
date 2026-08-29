import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCAN_SCENE,
  parseObservedScene,
  parseScanSceneType,
  shouldSkipScene,
  SCENE_COPY,
  SCAN_SCENE_TYPES,
} from "../lib/scan-scene";
import { classifierPrompt, normalizeScanDetection } from "../lib/services/garmentClassifier";
import { sanitizeOwnerIds } from "../lib/owners";

describe("scan scene declaration", () => {
  it("coerces untrusted scene values to the default", () => {
    expect(parseScanSceneType("flatlay")).toBe("flatlay");
    expect(parseScanSceneType("worn")).toBe("worn");
    expect(parseScanSceneType("nonsense")).toBe(DEFAULT_SCAN_SCENE);
    expect(parseScanSceneType(undefined)).toBe(DEFAULT_SCAN_SCENE);
    expect(parseScanSceneType(42)).toBe(DEFAULT_SCAN_SCENE);
  });

  it("treats an unreadable observed scene as worn, never as a skip", () => {
    // A missing enum must not delete the photo — that was the old failure mode,
    // just reached by a different route.
    expect(parseObservedScene(undefined)).toBe("worn");
    expect(parseObservedScene("")).toBe("worn");
    expect(parseObservedScene("garbage")).toBe("worn");
    expect(parseObservedScene("OTHER")).toBe("other");
  });

  it("skips only genuine non-garment scenes", () => {
    expect(shouldSkipScene("other", 3)).toBe(true);
    expect(shouldSkipScene("worn", 0)).toBe(true);
    expect(shouldSkipScene("worn", 2)).toBe(false);
    // A flat-lay inside a batch declared "worn" is still a garment the user
    // chose to upload.
    expect(shouldSkipScene("flatlay", 1)).toBe(false);
  });

  it("has copy for every declarable scene", () => {
    for (const scene of SCAN_SCENE_TYPES) {
      expect(SCENE_COPY[scene].label.length).toBeGreaterThan(0);
      expect(SCENE_COPY[scene].instruction.length).toBeGreaterThan(0);
    }
  });
});

describe("classifier prompt", () => {
  it("no longer tells the model to skip photos of people", () => {
    // The regression this guards: the worn prompt used to say "Skip selfies
    // where a person is the subject", which discarded the only photos that
    // carry ownership.
    for (const scene of SCAN_SCENE_TYPES) {
      expect(classifierPrompt(scene).toLowerCase()).not.toContain("skip selfies");
    }
  });

  it("anchors the worn prompt positionally, not by identity", () => {
    const prompt = classifierPrompt("worn");
    expect(prompt).toContain("MAIN SUBJECT");
    expect(prompt.toLowerCase()).toContain("never describe or identify any person");
  });

  it("asks for a positive scene enum in both variants", () => {
    for (const scene of SCAN_SCENE_TYPES) {
      expect(classifierPrompt(scene)).toContain('"scene"');
    }
  });
});

describe("normalizeScanDetection with scenes", () => {
  const garment = { category: "top", name: "Navy sweater", confidence: 0.9 };

  it("keeps a worn photo that reports garments", () => {
    const out = normalizeScanDetection({ scene: "worn", garments: [garment] });
    expect(out.isGarment).toBe(true);
    expect(out.scene).toBe("worn");
    expect(out.garments).toHaveLength(1);
  });

  it("drops a photo the model reports as other", () => {
    const out = normalizeScanDetection({
      scene: "other",
      garments: [],
      reason: "Plate of food",
    });
    expect(out.isGarment).toBe(false);
    expect(out.scene).toBe("other");
    expect(out.skipReason).toBe("Plate of food");
  });

  it("drops an other scene even when the model still listed garments", () => {
    const out = normalizeScanDetection({ scene: "other", garments: [garment] });
    expect(out.isGarment).toBe(false);
  });

  it("still honours the legacy isGarment boolean when scene is absent", () => {
    // Results stored by scans that ran before the scene enum must stay parseable.
    expect(normalizeScanDetection({ isGarment: false, garments: [] }).isGarment).toBe(false);
    expect(normalizeScanDetection({ isGarment: true, garments: [garment] }).isGarment).toBe(true);
  });
});

describe("sanitizeOwnerIds", () => {
  const roster = ["me", "her"];

  it("keeps roster ids in roster order", () => {
    expect(sanitizeOwnerIds(["her", "me"], roster, ["me"])).toEqual(["me", "her"]);
  });

  it("drops ids that are no longer on the roster", () => {
    // A stale tab can carry an owner deleted in Settings since the page loaded.
    expect(sanitizeOwnerIds(["me", "ghost"], roster, ["me"])).toEqual(["me"]);
  });

  it("falls back rather than returning an unowned item", () => {
    // An item with no owner is invisible to every owner filter.
    expect(sanitizeOwnerIds([], roster, ["me"])).toEqual(["me"]);
    expect(sanitizeOwnerIds(["ghost"], roster, ["me"])).toEqual(["me"]);
  });

  it("deduplicates and trims", () => {
    expect(sanitizeOwnerIds([" me ", "me"], roster, ["me"])).toEqual(["me"]);
    expect(sanitizeOwnerIds([], roster, ["me", "me"])).toEqual(["me"]);
  });
});
