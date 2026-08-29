import { describe, expect, it } from "vitest";
import {
  buildSpaceLedger,
  formatRailInches,
  ledgerByMonth,
  railInchesForPiece,
  RAIL_INCHES_BY_KIND,
  type LedgerDeparture,
} from "@/lib/space/ledger";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** 2026-08-15T12:00:00Z, a fixed "now" so nothing here depends on a clock. */
const NOW = Date.UTC(2026, 7, 15, 12);

function departure(overrides: Partial<LedgerDeparture> = {}): LedgerDeparture {
  return {
    soldAtMs: NOW,
    grossCents: 0,
    category: "shirt",
    subcategory: null,
    name: null,
    ...overrides,
  };
}

describe("railInchesForPiece", () => {
  it("reads the garment kind, not the literal category name", () => {
    // The whole point of routing through classifyGarmentKind: none of these
    // three strings is a canonical category, and all three are outerwear.
    for (const category of ["Puffer", "trench coat", "Blazers"]) {
      expect(railInchesForPiece({ category })).toBe(RAIL_INCHES_BY_KIND.outerwear);
    }
  });

  it("falls back to the name when the category is uninformative", () => {
    // The add flow files everything as "None" until the user picks.
    expect(railInchesForPiece({ category: "None", name: "Wool Overcoat" })).toBe(
      RAIL_INCHES_BY_KIND.outerwear,
    );
  });

  it("honours the user's own shape answer over any inference", () => {
    expect(railInchesForPiece({ category: "workwear" }, { workwear: "outerwear" })).toBe(
      RAIL_INCHES_BY_KIND.outerwear,
    );
  });

  it("counts shoes and accessories as zero rail", () => {
    expect(railInchesForPiece({ category: "Sneakers" })).toBe(0);
    expect(railInchesForPiece({ category: "Tote bag" })).toBe(0);
  });

  it("gives an unclassifiable piece the default rather than zero", () => {
    expect(railInchesForPiece({ category: "misc" })).toBe(RAIL_INCHES_BY_KIND.other);
    expect(RAIL_INCHES_BY_KIND.other).toBeGreaterThan(0);
  });
});

describe("buildSpaceLedger", () => {
  const from = Date.UTC(2026, 7, 1);
  const to = Date.UTC(2026, 7, 31, 23, 59);

  it("counts arrivals and departures inside the window only", () => {
    const ledger = buildSpaceLedger({
      arrivals: [
        { createdAtMs: from },
        { createdAtMs: NOW },
        { createdAtMs: from - MS_PER_DAY },
        { createdAtMs: to + MS_PER_DAY },
      ],
      departures: [departure(), departure({ soldAtMs: from - MS_PER_DAY })],
      fromMs: from,
      toMs: to,
    });
    expect(ledger.in.count).toBe(2);
    expect(ledger.out.count).toBe(1);
  });

  it("treats both window bounds as inclusive", () => {
    const ledger = buildSpaceLedger({
      arrivals: [{ createdAtMs: from }, { createdAtMs: to }],
      departures: [],
      fromMs: from,
      toMs: to,
    });
    expect(ledger.in.count).toBe(2);
  });

  it("sums rail inches from the pieces that actually left", () => {
    const ledger = buildSpaceLedger({
      arrivals: [],
      departures: [
        departure({ category: "Parka" }), // outerwear 2.75
        departure({ category: "Jeans" }), // bottom 1.5
        departure({ category: "Sneakers" }), // 0
      ],
      fromMs: from,
      toMs: to,
    });
    expect(ledger.rail.inches).toBe(4.25);
    expect(ledger.rail.estimated).toBe(true);
  });

  it("rounds rail inches to the quarter and never claims more precision", () => {
    const ledger = buildSpaceLedger({
      arrivals: [],
      departures: [departure({ category: "shirt" }), departure({ category: "shirt" })],
      fromMs: from,
      toMs: to,
    });
    // 1.25 × 2 = 2.5 exactly; the assertion is that it stays a quarter value.
    expect(ledger.rail.inches * 4 % 1).toBe(0);
  });

  it("reports undated sales separately instead of dropping or dating them", () => {
    const ledger = buildSpaceLedger({
      arrivals: [],
      departures: [
        departure({ soldAtMs: null, grossCents: 4000 }),
        departure({ soldAtMs: NOW, grossCents: 1000 }),
      ],
      fromMs: from,
      toMs: to,
    });
    expect(ledger.out.count).toBe(1);
    expect(ledger.money.grossCents).toBe(1000);
    expect(ledger.undated).toEqual({ count: 1, grossCents: 4000 });
    // An undated sale must not silently inflate the rail figure either.
    expect(ledger.rail.inches).toBe(1.25);
  });

  it("reports a growing closet as a negative net rather than clamping at zero", () => {
    const ledger = buildSpaceLedger({
      arrivals: [{ createdAtMs: NOW }, { createdAtMs: NOW }, { createdAtMs: NOW }],
      departures: [departure()],
      fromMs: from,
      toMs: to,
    });
    expect(ledger.net).toBe(-2);
  });

  it("keeps the four readings independent — nothing sums them", () => {
    const ledger = buildSpaceLedger({
      arrivals: [{ createdAtMs: NOW }],
      departures: [departure({ grossCents: 2500, category: "Parka" })],
      fromMs: from,
      toMs: to,
    });
    // The shape of the return value is the guarantee: no score, no percentage,
    // no combined index anywhere on it.
    expect(Object.keys(ledger).sort()).toEqual(
      ["in", "money", "net", "out", "rail", "undated", "window"].sort(),
    );
  });
});

describe("ledgerByMonth", () => {
  it("returns the trailing months oldest first, including the current one", () => {
    const months = ledgerByMonth({ arrivals: [], departures: [], nowMs: NOW, months: 3 });
    expect(months).toHaveLength(3);
    expect(new Date(months[0].startMs).getMonth()).toBe(5); // June
    expect(new Date(months[2].startMs).getMonth()).toBe(7); // August
    expect(months[0].startMs).toBeLessThan(months[1].startMs);
  });

  it("buckets by calendar month", () => {
    const months = ledgerByMonth({
      arrivals: [
        { createdAtMs: Date.UTC(2026, 6, 3, 12) },
        { createdAtMs: Date.UTC(2026, 6, 28, 12) },
        { createdAtMs: Date.UTC(2026, 7, 2, 12) },
      ],
      departures: [{ soldAtMs: Date.UTC(2026, 7, 4, 12), grossCents: 0, category: "shirt" }],
      nowMs: NOW,
      months: 3,
    });
    expect(months.map((m) => m.in)).toEqual([0, 2, 1]);
    expect(months.map((m) => m.out)).toEqual([0, 0, 1]);
  });

  it("ignores anything outside the window, in either direction", () => {
    const months = ledgerByMonth({
      arrivals: [
        { createdAtMs: Date.UTC(2025, 0, 1) }, // long before
        { createdAtMs: NOW + 30 * MS_PER_DAY }, // the future
      ],
      departures: [],
      nowMs: NOW,
      months: 2,
    });
    expect(months.every((m) => m.in === 0)).toBe(true);
  });

  it("skips undated departures, which cannot be placed in a month", () => {
    const months = ledgerByMonth({
      arrivals: [],
      departures: [{ soldAtMs: null, grossCents: 900, category: "shirt" }],
      nowMs: NOW,
      months: 2,
    });
    expect(months.every((m) => m.out === 0)).toBe(true);
  });

  it("returns nothing for a non-positive month count", () => {
    expect(ledgerByMonth({ arrivals: [], departures: [], nowMs: NOW, months: 0 })).toEqual([]);
  });
});

describe("formatRailInches", () => {
  it("says nothing has happened rather than 'about 0 in'", () => {
    expect(formatRailInches(0)).toBe("none yet");
  });

  it("hedges, because the figure is an estimate", () => {
    expect(formatRailInches(6)).toBe("about 6 in");
    expect(formatRailInches(1.25)).toBe("about 1.25 in");
    expect(formatRailInches(2.5)).toBe("about 2.5 in");
  });

  it("switches to feet past a foot, the unit a rail is measured in", () => {
    expect(formatRailInches(12)).toBe("about 1 ft");
    expect(formatRailInches(38)).toBe("about 3 ft 2 in");
    expect(formatRailInches(13.5)).toBe("about 1 ft 1.5 in");
  });
});

describe("countUndated", () => {
  it("folds undated sales in when the window is all of time", () => {
    const args = {
      arrivals: [],
      departures: [
        { soldAtMs: null, grossCents: 4000, category: "Parka" },
        { soldAtMs: NOW, grossCents: 1000, category: "shirt" },
      ],
      fromMs: 0,
      toMs: NOW,
    } as const;

    const bounded = buildSpaceLedger(args);
    expect(bounded.out.count).toBe(1);

    const unbounded = buildSpaceLedger({ ...args, countUndated: true });
    expect(unbounded.out.count).toBe(2);
    expect(unbounded.money.grossCents).toBe(5000);
    expect(unbounded.rail.inches).toBe(4);
    // Still reported separately, so a caller can always show the split.
    expect(unbounded.undated).toEqual({ count: 1, grossCents: 4000 });
  });
});
