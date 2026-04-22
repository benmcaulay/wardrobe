import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui"],
      },
      colors: {
        ink: {
          DEFAULT: "#1a1613",
          soft: "#2b2521",
          muted: "#6b625c",
        },
        paper: {
          DEFAULT: "#faf8f5",
          warm: "#f3ede4",
        },
        accent: {
          DEFAULT: "#7a8c6f",
          soft: "#c5cfbc",
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
