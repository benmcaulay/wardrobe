import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Invariants for the icon suite, asserted against the generated source text.
 *
 * Reading the file rather than importing it keeps this a pure node test (no
 * JSX/DOM setup) and checks the thing that actually ships. The generator
 * enforces the same rules, but this guards against someone hand-patching an
 * icon later and quietly reintroducing a background plate or a hardcoded
 * colour — the two things that would stop these sitting cleanly on any surface.
 */

const SRC = fs.readFileSync(path.join(process.cwd(), "components/icons.tsx"), "utf8");

/** Each icon component's JSX body. */
function iconBodies(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /export function ([A-Za-z0-9]+)\(\{ size[\s\S]*?\n\}/g;
  for (const m of SRC.matchAll(re)) out.push({ name: m[1], body: m[0] });
  return out;
}

describe("icon suite", () => {
  const icons = iconBodies();

  it("generated a substantial set", () => {
    expect(icons.length).toBeGreaterThanOrEqual(40);
  });

  it("exports a registry entry for every component", () => {
    for (const { name } of icons) {
      expect(SRC).toContain(`Component: ${name} }`);
    }
  });

  it("never hardcodes a colour — icons must inherit from currentColor", () => {
    for (const { name, body } of icons) {
      expect(body, `${name} has a hex colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, `${name} has an rgb()/hsl() colour`).not.toMatch(/\b(?:rgb|hsl)a?\(/);
    }
  });

  it("has no background plate", () => {
    for (const { name, body } of icons) {
      // A rect spanning (nearly) the whole 24-unit canvas would be a plate.
      for (const rect of body.matchAll(/<rect([^/>]*)\/>/g)) {
        const w = Number(/width="([\d.]+)"/.exec(rect[1])?.[1] ?? 0);
        const h = Number(/height="([\d.]+)"/.exec(rect[1])?.[1] ?? 0);
        expect(w >= 23 && h >= 23, `${name} has a full-bleed rect`).toBe(false);
      }
      expect(body, `${name} sets a background fill`).not.toMatch(
        /fill="(?!none|currentColor)[^"]+"/,
      );
    }
  });

  it("only fills with currentColor (accent dots) and never with a literal", () => {
    for (const { name, body } of icons) {
      for (const f of body.matchAll(/fill="([^"]+)"/g)) {
        expect(["none", "currentColor"], `${name} fill="${f[1]}"`).toContain(f[1]);
      }
    }
  });

  it("uses only the allowed primitive elements", () => {
    const allowed = new Set(["svg", "path", "circle", "rect", "line", "polyline", "ellipse"]);
    for (const { name, body } of icons) {
      for (const tag of body.matchAll(/<([a-z][a-zA-Z]*)/g)) {
        expect(allowed, `${name} uses <${tag[1]}>`).toContain(tag[1]);
      }
    }
  });

  it("carries no transforms, groups or inline styles", () => {
    for (const { name, body } of icons) {
      expect(body, `${name} uses transform`).not.toMatch(/\stransform=/);
      expect(body, `${name} uses <g>`).not.toMatch(/<g[\s>]/);
      expect(body, `${name} uses inline style`).not.toMatch(/\sstyle=/);
    }
  });

  it("lets individual shapes inherit the wrapper's stroke weight", () => {
    for (const { name, body } of icons) {
      // Only the shared BASE may set strokeWidth.
      const inComponent = body.match(/strokeWidth=/g) ?? [];
      expect(inComponent.length, `${name} overrides strokeWidth`).toBe(0);
    }
  });

  // Staying inside the canvas is NOT checked by reading path numbers: relative
  // commands carry negative deltas (`l -1 -1`) and arcs carry an x-axis-rotation
  // that reads like a wild coordinate (`a 4 4 85 0 1 ...`), so a numeric scan
  // reports false clipping. Bounds are verified by actually rendering each icon
  // and measuring the ink box — see tmp/verify-bounds.ts.
  it("declares a 24-unit viewBox on every icon", () => {
    expect(SRC).toContain('viewBox: "0 0 24 24"');
    for (const { name, body } of icons) {
      expect(body, `${name} does not use the shared BASE frame`).toContain("{...BASE}");
    }
  });

  it("spreads props last so callers can override size and className", () => {
    for (const { name, body } of icons) {
      expect(body, `${name} does not spread props`).toContain("{...props}");
      const baseAt = body.indexOf("{...BASE}");
      const propsAt = body.indexOf("{...props}");
      expect(propsAt, `${name} spreads props before BASE`).toBeGreaterThan(baseAt);
    }
  });

  it("marks icons decorative for screen readers", () => {
    for (const { name, body } of icons) {
      expect(body, `${name} is missing aria-hidden`).toContain("aria-hidden");
    }
  });
});
