/**
 * Temperature display units.
 *
 * Everything is stored and reasoned about in Celsius — the weather provider
 * speaks it, the packing scorer's band thresholds are written in it, and a
 * trip's saved `climateData` is Celsius regardless of who's looking at it.
 * This module exists purely for the last inch: turning that number into the
 * string a given user wants to read. Converting any earlier would mean two
 * units loose in the codebase and a rounding error in the packing plan.
 */

export type TemperatureUnit = "c" | "f";

export const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = "c";

export const TEMPERATURE_UNIT_LABELS: Record<TemperatureUnit, string> = {
  c: "Celsius",
  f: "Fahrenheit",
};

/** Narrow whatever came out of the prefs JSON to a unit we can render. */
export function readTemperatureUnit(raw: unknown): TemperatureUnit {
  return raw === "f" ? "f" : DEFAULT_TEMPERATURE_UNIT;
}

export function celsiusToFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

/** "29°C" / "84°F". Whole degrees — the inputs are daily averages, not readings. */
export function formatTemperature(celsius: number, unit: TemperatureUnit): string {
  const value = unit === "f" ? celsiusToFahrenheit(celsius) : celsius;
  // -0 reads badly on a chilly day.
  return `${Math.round(value) + 0}°${unit === "f" ? "F" : "C"}`;
}
