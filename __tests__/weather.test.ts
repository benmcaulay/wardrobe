import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bandForHigh,
  getClimateSummary,
  hasKnownClimate,
  manualClimateSummary,
} from "@/lib/services/weather";

/** Fixed "today" so the forecast horizon is deterministic. */
const TODAY = new Date("2026-08-08T12:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

type Call = { url: URL; params: URLSearchParams };

/**
 * Stand-in for Open-Meteo. Each endpoint returns a flat series so the averages
 * are obvious, and every request is recorded so tests can assert which windows
 * we actually asked for.
 */
function mockOpenMeteo(opts: {
  geocode?: unknown;
  forecastHigh?: number | null;
  archiveHigh?: number | null;
}) {
  const calls: Call[] = [];
  const spanDays = (p: URLSearchParams) => {
    const start = day(p.get("start_date")!).getTime();
    const end = day(p.get("end_date")!).getTime();
    return Math.round((end - start) / 86_400_000) + 1;
  };
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
  const fail = () => ({ ok: false, json: async () => ({}) }) as unknown as Response;

  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    const p = url.searchParams;
    calls.push({ url, params: p });

    if (url.hostname.startsWith("geocoding")) {
      return ok(
        opts.geocode ?? {
          results: [{ name: "Lisbon", country: "Portugal", latitude: 38.7, longitude: -9.1 },],
        },
      );
    }
    if (url.hostname.startsWith("archive")) {
      if (opts.archiveHigh == null) return fail();
      const n = spanDays(p);
      return ok({
        daily: {
          temperature_2m_max: Array(n).fill(opts.archiveHigh),
          temperature_2m_min: Array(n).fill(opts.archiveHigh - 10),
          precipitation_sum: Array(n).fill(4), // every day wet -> rainChance 1
        },
      });
    }
    // forecast
    if (opts.forecastHigh == null) return fail();
    const n = spanDays(p);
    return ok({
      daily: {
        temperature_2m_max: Array(n).fill(opts.forecastHigh),
        temperature_2m_min: Array(n).fill(opts.forecastHigh - 10),
        precipitation_probability_mean: Array(n).fill(0),
      },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    forecastCalls: () => calls.filter((c) => c.url.hostname === "api.open-meteo.com"),
    archiveCalls: () => calls.filter((c) => c.url.hostname.startsWith("archive")),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  vi.stubEnv("USE_REAL_WEATHER", "true");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bandForHigh", () => {
  it("maps temperatures onto packing-relevant bands", () => {
    expect(bandForHigh(31)).toBe("hot");
    expect(bandForHigh(24)).toBe("warm");
    expect(bandForHigh(17)).toBe("mild");
    expect(bandForHigh(10)).toBe("cool");
    expect(bandForHigh(2)).toBe("cold");
  });
});

describe("getClimateSummary — inside the forecast horizon", () => {
  it("uses the forecast alone and labels it as one", async () => {
    const m = mockOpenMeteo({ forecastHigh: 29, archiveHigh: 15 });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.source).toBe("forecast");
    expect(climate.destination).toBe("Lisbon, Portugal");
    expect(climate.avgHighC).toBe(29);
    expect(climate.avgLowC).toBe(19);
    expect(climate.band).toBe("hot");
    expect(climate.days).toBe(5);
    // Nothing to cover, so we never touch the archive.
    expect(m.archiveCalls()).toHaveLength(0);
  });
});

describe("getClimateSummary — beyond the forecast horizon", () => {
  it("averages the same dates across past years and does not call the forecast", async () => {
    const m = mockOpenMeteo({ forecastHigh: 29, archiveHigh: 12 });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-12-01"),
      end: day("2026-12-05"),
    });

    expect(climate.source).toBe("climatology");
    expect(climate.avgHighC).toBe(12);
    expect(climate.rainChance).toBe(1);
    expect(m.forecastCalls()).toHaveLength(0);

    // Five past years, same calendar window each time.
    const years = m.archiveCalls().map((c) => c.params.get("start_date"));
    expect(years.sort()).toEqual([
      "2021-12-01",
      "2022-12-01",
      "2023-12-01",
      "2024-12-01",
      "2025-12-01",
    ]);
    for (const c of m.archiveCalls()) expect(c.params.get("end_date")).toMatch(/-12-05$/);
  });

  it("won't call a finished trip's weather a forecast, even when served by the forecast endpoint", async () => {
    // 2026-06-01 is 68 days back — inside the forecast endpoint's 92-day past
    // window, so it answers. That's real data, but it isn't a forecast.
    const m = mockOpenMeteo({ forecastHigh: 17, archiveHigh: 99 });
    const climate = await getClimateSummary({
      destination: "Dublin",
      start: day("2026-06-01"),
      end: day("2026-06-07"),
    });

    expect(m.forecastCalls()).toHaveLength(1);
    expect(climate.avgHighC).toBe(17);
    expect(climate.source).toBe("climatology");
  });

  it("reads observed weather for a trip that already happened", async () => {
    const m = mockOpenMeteo({ forecastHigh: 29, archiveHigh: 7 });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-01-10"),
      end: day("2026-01-12"),
    });

    expect(climate.source).toBe("climatology");
    expect(climate.avgHighC).toBe(7);
    // One request for the actual dates, not a five-year average.
    expect(m.archiveCalls()).toHaveLength(1);
    expect(m.archiveCalls()[0].params.get("start_date")).toBe("2026-01-10");
  });
});

describe("getClimateSummary — straddling the horizon", () => {
  it("blends forecast and history, weighted by days, and won't claim a forecast", async () => {
    // Horizon ends 2026-08-24. Trip is 2026-08-20..2026-08-29: 5 forecast days,
    // 5 historical ones.
    const m = mockOpenMeteo({ forecastHigh: 30, archiveHigh: 20 });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-08-20"),
      end: day("2026-08-29"),
    });

    expect(climate.days).toBe(10);
    expect(climate.avgHighC).toBe(25);
    // Half the days were dry (forecast) and half wet (archive).
    expect(climate.rainChance).toBe(0.5);
    // Partial cover is not a forecast.
    expect(climate.source).toBe("climatology");

    // The forecast request was clipped to the provider's window.
    expect(m.forecastCalls()).toHaveLength(1);
    expect(m.forecastCalls()[0].params.get("start_date")).toBe("2026-08-20");
    expect(m.forecastCalls()[0].params.get("end_date")).toBe("2026-08-24");
    // History picked up only the uncovered tail.
    expect(m.archiveCalls()[0].params.get("start_date")).toBe("2025-08-25");
  });
});

describe("geocoding an ambiguous name", () => {
  it("takes the most populous candidate, not the closest spelling", async () => {
    // Open-Meteo ranks Bāli, India above Bali, Indonesia.
    mockOpenMeteo({
      geocode: {
        results: [
          {
            name: "Bāli",
            admin1: "West Bengal",
            country: "India",
            population: 296973,
            latitude: 22.6,
            longitude: 88.3,
          },
          {
            name: "Bali",
            admin1: "Bali",
            country: "Indonesia",
            population: 4225384,
            latitude: -8.4,
            longitude: 115.2,
          },
        ],
      },
      forecastHigh: 31,
      archiveHigh: 31,
    });
    const climate = await getClimateSummary({
      destination: "Bali",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.destination).toBe("Bali, Indonesia");
    expect(climate.latitude).toBe(-8.4);
  });

  it("keeps the first hit when nothing outranks it, and names the region", async () => {
    mockOpenMeteo({
      geocode: {
        results: [
          {
            name: "Springfield",
            admin1: "Missouri",
            country: "United States",
            population: 170188,
            latitude: 37.2,
            longitude: -93.3,
          },
          {
            name: "Springfield",
            admin1: "Massachusetts",
            country: "United States",
            population: 154341,
            latitude: 42.1,
            longitude: -72.6,
          },
        ],
      },
      forecastHigh: 26,
      archiveHigh: 26,
    });
    const climate = await getClimateSummary({
      destination: "Springfield",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.destination).toBe("Springfield, Missouri, United States");
  });
});

describe("getClimateSummary — when we can't measure anything", () => {
  it("is unknown when the provider is switched off", async () => {
    vi.stubEnv("USE_REAL_WEATHER", "false");
    const m = mockOpenMeteo({ forecastHigh: 29, archiveHigh: 15 });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.source).toBe("unknown");
    expect(hasKnownClimate(climate)).toBe(false);
    expect(m.calls).toHaveLength(0);
  });

  it("is unknown when the destination doesn't resolve", async () => {
    mockOpenMeteo({ geocode: { results: [] }, forecastHigh: 29, archiveHigh: 15 });
    const climate = await getClimateSummary({
      destination: "Nowheresville",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.source).toBe("unknown");
    expect(climate.latitude).toBeNull();
  });

  it("is unknown — never a guess — when every endpoint fails", async () => {
    mockOpenMeteo({ forecastHigh: null, archiveHigh: null });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-12-01"),
      end: day("2026-12-05"),
    });

    expect(climate.source).toBe("unknown");
    expect(hasKnownClimate(climate)).toBe(false);
  });

  it("falls back to history when the forecast endpoint is down", async () => {
    mockOpenMeteo({ forecastHigh: null, archiveHigh: 21 });
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.source).toBe("climatology");
    expect(climate.avgHighC).toBe(21);
  });

  it("survives a network throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const climate = await getClimateSummary({
      destination: "Lisbon",
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.source).toBe("unknown");
  });
});

describe("manualClimateSummary", () => {
  it("outranks anything inferred and fills in a sensible low", () => {
    const climate = manualClimateSummary({
      destination: "Lisbon",
      avgHighC: 25,
      start: day("2026-08-10"),
      end: day("2026-08-14"),
    });

    expect(climate.source).toBe("manual");
    expect(climate.avgLowC).toBe(17);
    expect(climate.band).toBe("warm");
    expect(climate.days).toBe(5);
  });
});
