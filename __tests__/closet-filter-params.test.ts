import { describe, expect, it } from "vitest";
import { parseMultiFilterParam, serializeMultiFilterParam } from "@/lib/closet-filter-params";

describe("closet-filter-params", () => {
  it("parses comma-separated values", () => {
    expect(parseMultiFilterParam("shirt, bottom,shirt")).toEqual(["shirt", "bottom"]);
  });

  it("serializes unique trimmed values", () => {
    expect(serializeMultiFilterParam(["black", " red ", "black"])).toBe("black,red");
  });
});
