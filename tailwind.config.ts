import type { Config } from "tailwindcss";

/**
 * Make `/opacity` modifiers work on the theme colours.
 *
 * The palette lives in CSS custom properties (app/globals.css) so `.dark` can
 * swap it wholesale. But a custom property holding a hex string can't carry an
 * alpha channel, so Tailwind had nothing to modify: `border-ink/10`,
 * `bg-accent/15` and `ring-accent/40` all compiled to *nothing at all*. 581
 * utilities across 51 files were silently dead — borders fell through to
 * preflight's gray-200, translucent backgrounds rendered fully transparent,
 * and focus rings came out Tailwind's default blue in a paper-and-ink app.
 *
 * `color-mix` fixes it in place. The alternative — storing bare `26 22 19`
 * channels so `rgb(var(--ink) / <alpha-value>)` works — is the more common
 * recipe, but it makes the palette unreadable and quietly breaks every plain
 * `var(--ink)`, of which globals.css and two components have several.
 *
 * `<alpha-value>` is Tailwind's placeholder: it substitutes the modifier's
 * value, or `1` when there is no modifier, so `calc(1 * 100%)` makes every
 * unmodified utility render the colour it always did. Mixing with
 * `transparent` uses premultiplied alpha, so the result is the colour at that
 * alpha rather than one blended toward black.
 *
 * Needs `color-mix` (Chrome 111, Safari 16.2, Firefox 113 — all 2023).
 */
const themeColor = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui"],
      },
      colors: {
        ink: {
          DEFAULT: themeColor("--ink"),
          soft: themeColor("--ink-soft"),
          muted: themeColor("--ink-muted"),
        },
        paper: {
          DEFAULT: themeColor("--paper"),
          warm: themeColor("--paper-warm"),
        },
        accent: {
          DEFAULT: themeColor("--accent"),
          soft: themeColor("--accent-soft"),
        },
      },
      boxShadow: {
        tile: "0 1px 2px rgba(26,22,19,0.04), 0 4px 16px rgba(26,22,19,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
