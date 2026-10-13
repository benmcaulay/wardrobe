import { describe, it, expect } from "vitest";
import { moveTrip, sortTrips } from "../lib/packing/trip-order";

const t = (id: string, startDate: string) => ({ id, startDate });
const seoul = t("seoul", "2026-08-27");
const iceland = t("iceland", "2026-09-10");
const lisbon = t("lisbon", "2026-07-01");
const all = [seoul, iceland, lisbon];

describe("sortTrips", () => {
  it("falls back to newest departure first when nothing is saved", () => {
    expect(sortTrips(all, []).map((x) => x.id)).toEqual(["iceland", "seoul", "lisbon"]);
  });

  it("honours a saved order", () => {
    expect(sortTrips(all, ["lisbon", "seoul", "iceland"]).map((x) => x.id)).toEqual([
      "lisbon",
      "seoul",
      "iceland",
    ]);
  });

  it("puts a trip created since the last drag at the top, not buried", () => {
    const fresh = t("tokyo", "2026-06-01");
    const order = ["lisbon", "seoul", "iceland"];
    expect(sortTrips([...all, fresh], order).map((x) => x.id)).toEqual([
      "tokyo",
      "lisbon",
      "seoul",
      "iceland",
    ]);
  });

  it("ignores ids for trips that no longer exist", () => {
    const order = ["deleted", "lisbon", "seoul", "iceland"];
    expect(sortTrips(all, order).map((x) => x.id)).toEqual(["lisbon", "seoul", "iceland"]);
  });

  it("does not mutate what it was given", () => {
    const input = [...all];
    sortTrips(input, ["lisbon"]);
    expect(input).toEqual(all);
  });
});

describe("moveTrip", () => {
  it("moves one trip and returns the whole order", () => {
    // The full list, so a single drag pins every position rather than
    // leaving the others floating on departure date.
    expect(moveTrip(all, 2, 0)).toEqual(["lisbon", "seoul", "iceland"]);
  });

  it("moves downward too", () => {
    expect(moveTrip(all, 0, 2)).toEqual(["iceland", "lisbon", "seoul"]);
  });

  it("is a no-op for a move to the same place or out of range", () => {
    const ids = ["seoul", "iceland", "lisbon"];
    expect(moveTrip(all, 1, 1)).toEqual(ids);
    expect(moveTrip(all, -1, 0)).toEqual(ids);
    expect(moveTrip(all, 0, 9)).toEqual(ids);
  });

  it("does not mutate what it was given", () => {
    const input = [...all];
    moveTrip(input, 0, 2);
    expect(input).toEqual(all);
  });
});
