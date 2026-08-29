import { describe, expect, it } from "vitest";
import {
  promoteOnOriginalDelete,
  type GhostViewRow,
} from "@/lib/ghost-view-promote";

const view = (label: string, imagePath: string, extra: Partial<GhostViewRow> = {}): GhostViewRow => ({
  label,
  imagePath,
  ...extra,
});

const ORIGINAL = "u1/original.jpg";

describe("promoteOnOriginalDelete", () => {
  it("refuses when there is nothing to promote", () => {
    // Deleting the only photo would leave a garment with no image at all.
    expect(
      promoteOnOriginalDelete({ originalImagePath: ORIGINAL, ghostImagePath: null, views: [] }),
    ).toEqual({ ok: false, reason: "no-views" });
  });

  it("promotes the thumbnail, not the first view", () => {
    // The thumbnail is already what the grid shows and what a render starts
    // from, so promoting it is the choice that changes nothing downstream.
    const views = [view("Front", "u1/a.jpg"), view("Back", "u1/b.jpg")];
    const res = promoteOnOriginalDelete({
      originalImagePath: ORIGINAL,
      ghostImagePath: "u1/b.jpg",
      views,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.promoted.imagePath).toBe("u1/b.jpg");
    expect(res.remaining.map((v) => v.imagePath)).toEqual(["u1/a.jpg"]);
  });

  it("falls back to the first view when the original is the thumbnail", () => {
    const res = promoteOnOriginalDelete({
      originalImagePath: ORIGINAL,
      ghostImagePath: null,
      views: [view("Front", "u1/a.jpg"), view("Back", "u1/b.jpg")],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.promoted.imagePath).toBe("u1/a.jpg");
  });

  it("falls back when the thumbnail pointer is stale", () => {
    // Points at a view that no longer exists; the delete must still work rather
    // than throwing on an undefined row.
    const res = promoteOnOriginalDelete({
      originalImagePath: ORIGINAL,
      ghostImagePath: "u1/gone.jpg",
      views: [view("Front", "u1/a.jpg")],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.promoted.imagePath).toBe("u1/a.jpg");
  });

  it("pulls the promoted row out so it cannot render twice", () => {
    const res = promoteOnOriginalDelete({
      originalImagePath: ORIGINAL,
      ghostImagePath: "u1/a.jpg",
      views: [view("Front", "u1/a.jpg")],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.remaining).toEqual([]);
  });

  it("removes every row sharing the promoted file", () => {
    // A cache hit can leave two labels on one file. Leaving the duplicate
    // behind would keep a view pointing at what is now the original.
    const res = promoteOnOriginalDelete({
      originalImagePath: ORIGINAL,
      ghostImagePath: "u1/a.jpg",
      views: [view("Front", "u1/a.jpg"), view("Also front", "u1/a.jpg"), view("Back", "u1/b.jpg")],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.remaining.map((v) => v.imagePath)).toEqual(["u1/b.jpg"]);
  });

  it("refuses when the promoted view points at the original's own file", () => {
    // Deleting that file would take the promoted image with it.
    expect(
      promoteOnOriginalDelete({
        originalImagePath: ORIGINAL,
        ghostImagePath: ORIGINAL,
        views: [view("Same", ORIGINAL)],
      }),
    ).toEqual({ ok: false, reason: "already-original" });

    expect(
      promoteOnOriginalDelete({
        originalImagePath: ORIGINAL,
        ghostImagePath: null,
        views: [view("Same", ORIGINAL)],
      }),
    ).toEqual({ ok: false, reason: "already-original" });
  });

  it("carries the promoted view's framing, not the deleted original's", () => {
    const res = promoteOnOriginalDelete({
      originalImagePath: ORIGINAL,
      ghostImagePath: "u1/a.jpg",
      views: [view("Front", "u1/a.jpg", { mirror: true, thumbZoom: 1.4 })],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.promoted.mirror).toBe(true);
    expect(res.promoted.thumbZoom).toBe(1.4);
  });

  it("does not mutate the views it was given", () => {
    const views = [view("Front", "u1/a.jpg"), view("Back", "u1/b.jpg")];
    const snapshot = JSON.stringify(views);
    promoteOnOriginalDelete({ originalImagePath: ORIGINAL, ghostImagePath: "u1/b.jpg", views });
    expect(JSON.stringify(views)).toBe(snapshot);
  });
});
