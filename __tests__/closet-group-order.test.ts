import { describe, expect, it } from "vitest";
import { migrateClosetGroupOrderCategory } from "@/lib/closet-group-order";

describe("migrateClosetGroupOrderCategory", () => {
  it("rewrites group keys for the renamed category only", () => {
    const orders = {
      "shirt\0black": ["a", "b"],
      "bottom\0black": ["c"],
    };
    const out = migrateClosetGroupOrderCategory(orders, "shirt", "top");
    expect(out).toEqual({
      "top\0black": ["a", "b"],
      "bottom\0black": ["c"],
    });
  });

  it("returns undefined when orders are undefined", () => {
    expect(migrateClosetGroupOrderCategory(undefined, "shirt", "top")).toBeUndefined();
  });
});
