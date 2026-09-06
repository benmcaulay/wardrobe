import { describe, it, expect } from "vitest";
import {
  mergeSavedDrafts,
  parseSavedDraft,
  toSavedDraft,
} from "../lib/scan-review-drafts";

const row = (reviewId: string, over: Record<string, unknown> = {}): Record<string, unknown> & { reviewId: string } => ({
  reviewId,
  name: "Detected name",
  brand: "",
  category: "shirt",
  include: true,
  ownerIds: ["me"],
  originalImagePath: `p/${reviewId}.jpg`,
  ...over,
});

describe("parseSavedDraft", () => {
  it("returns null for absent or unparseable values", () => {
    for (const raw of [null, undefined, "", "{", "null", '"a string"', "[]"]) {
      expect(parseSavedDraft(raw as string)).toBeNull();
    }
  });

  it("drops entries with no reviewId rather than rejecting the whole payload", () => {
    const got = parseSavedDraft(JSON.stringify({ drafts: [{ name: "orphan" }, { reviewId: "a" }] }));
    expect(got?.drafts.map((d) => d.reviewId)).toEqual(["a"]);
  });

  it("round-trips split groups", () => {
    const got = parseSavedDraft(JSON.stringify({ drafts: [], splitGroups: ["g1", "g2"] }));
    expect(got?.splitGroups).toEqual(["g1", "g2"]);
  });
});

describe("mergeSavedDrafts", () => {
  it("returns the scan untouched when nothing was saved", () => {
    const fresh = [row("a")];
    expect(mergeSavedDrafts(fresh, null)).toEqual(fresh);
    expect(mergeSavedDrafts(fresh, { drafts: [] })).toEqual(fresh);
  });

  it("applies typed values over the classifier's", () => {
    const got = mergeSavedDrafts(
      [row("a")],
      { drafts: [{ reviewId: "a", name: "My jacket", brand: "Arc'teryx", include: false }] },
    );
    expect(got[0]!.name).toBe("My jacket");
    expect(got[0]!.brand).toBe("Arc'teryx");
    expect(got[0]!.include).toBe(false);
    // Untouched fields keep the scan's values.
    expect(got[0]!.category).toBe("shirt");
    expect(got[0]!.originalImagePath).toBe("p/a.jpg");
  });

  it("keeps an intentionally blank field blank", () => {
    // Clearing a wrong brand must survive; "" is a real edit, not absence.
    const got = mergeSavedDrafts([row("a", { brand: "Nkie" })], {
      drafts: [{ reviewId: "a", brand: "" }],
    });
    expect(got[0]!.brand).toBe("");
  });

  it("preserves false and empty arrays rather than treating them as missing", () => {
    const got = mergeSavedDrafts([row("a")], {
      drafts: [{ reviewId: "a", include: false, ownerIds: [], ungrouped: false }],
    });
    expect(got[0]!.include).toBe(false);
    expect(got[0]!.ownerIds).toEqual([]);
    expect(got[0]!.ungrouped).toBe(false);
  });

  it("ignores saved rows the scan no longer contains", () => {
    // A re-run worker can drop a detection; a stale edit must not resurrect it.
    const got = mergeSavedDrafts([row("a")], {
      drafts: [{ reviewId: "gone", name: "Deleted piece" }, { reviewId: "a", name: "Kept" }],
    });
    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe("Kept");
  });

  it("leaves newly detected rows at their classifier values", () => {
    const got = mergeSavedDrafts([row("a"), row("b")], {
      drafts: [{ reviewId: "a", name: "Edited" }],
    });
    expect(got.map((d) => d.name)).toEqual(["Edited", "Detected name"]);
  });

  it("preserves the scan's ordering, not the saved order", () => {
    const got = mergeSavedDrafts([row("a"), row("b")], {
      drafts: [{ reviewId: "b" }, { reviewId: "a" }],
    });
    expect(got.map((d) => d.reviewId)).toEqual(["a", "b"]);
  });
});

describe("toSavedDraft", () => {
  it("stores only editable fields, not image paths", () => {
    const saved = toSavedDraft([row("a") as never], ["g1"]);
    expect(Object.keys(saved.drafts[0]!).sort()).toEqual(
      ["brand", "category", "include", "name", "ownerIds", "reviewId", "ungrouped"].sort(),
    );
    expect(JSON.stringify(saved)).not.toContain("p/a.jpg");
    expect(saved.splitGroups).toEqual(["g1"]);
  });

  it("survives a round trip through storage", () => {
    const saved = toSavedDraft([row("a", { name: "Edited" }) as never], []);
    const back = parseSavedDraft(JSON.stringify(saved));
    expect(mergeSavedDrafts([row("a")], back)[0]!.name).toBe("Edited");
  });
});
