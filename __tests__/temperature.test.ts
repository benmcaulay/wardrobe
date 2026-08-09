import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEMPERATURE_UNIT,
  celsiusToFahrenheit,
  formatTemperature,
  readTemperatureUnit,
} from "@/lib/temperature";

describe("readTemperatureUnit", () => {
  it("defaults to Celsius for anything it doesn't recognise", () => {
    expect(readTemperatureUnit("f")).toBe("f");
    expect(readTemperatureUnit("c")).toBe("c");
    expect(readTemperatureUnit(undefined)).toBe(DEFAULT_TEMPERATURE_UNIT);
    expect(readTemperatureUnit(null)).toBe("c");
    expect(readTemperatureUnit("F")).toBe("c");
    expect(readTemperatureUnit(42)).toBe("c");
  });
});

describe("formatTemperature", () => {
  it("passes Celsius through and converts for Fahrenheit", () => {
    expect(formatTemperature(29, "c")).toBe("29°C");
    expect(formatTemperature(29, "f")).toBe("84°F");
    expect(formatTemperature(0, "f")).toBe("32°F");
    expect(formatTemperature(100, "f")).toBe("212°F");
  });

  it("handles the cold end without a negative zero", () => {
    expect(formatTemperature(-3, "c")).toBe("-3°C");
    expect(formatTemperature(-40, "f")).toBe("-40°F");
    // Rounds to zero from below: "-0°F" would look like a typo.
    expect(formatTemperature(-17.8, "f")).toBe("0°F");
    expect(formatTemperature(-0.2, "c")).toBe("0°C");
  });

  it("round-trips a Celsius value back through the conversion", () => {
    expect(Math.round(celsiusToFahrenheit(21))).toBe(70);
  });
});
