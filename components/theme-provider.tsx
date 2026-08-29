"use client";

/**
 * Paper or Space.
 *
 * The `.dark` palette in app/globals.css existed for a long time behind the
 * comment "Unused — app stays in day mode", while the landing page painted a
 * full deep-space night of its own (components/fabric-warp.tsx: nebula,
 * periwinkle bloom, drifting starfield). Two night themes, one of them
 * unreachable. Now there is one, the app can enter it, and it is called Space —
 * which the product name had already been implying for free.
 *
 * The two modes are named rather than "light"/"dark" because they are not a
 * neutral accessibility setting here; they are the two backdrops the brand
 * ships. `system` remains available and is the default, because a first-time
 * visitor's OS preference is a better guess than ours.
 *
 * Applied to `documentElement` from a blocking inline script (`themeInitScript`
 * in the document head) so the page never paints paper before flipping to
 * space. Nothing in this provider's markup varies by theme, so it cannot cause
 * a hydration mismatch — the class lands on <html>, above React's root.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** What the user chose. */
export type Theme = "paper" | "space" | "system";
/** What that resolves to right now. */
export type ResolvedTheme = "paper" | "space";

export const THEME_STORAGE_KEY = "wardrobe-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Human labels, in one place so the toggle and the settings copy agree. */
export const THEME_LABELS: Record<Theme, string> = {
  paper: "Paper",
  space: "Space",
  system: "Match system",
};

function isTheme(value: unknown): value is Theme {
  return value === "paper" || value === "space" || value === "system";
}

/**
 * Runs before first paint, in the document head.
 *
 * Kept as a string rather than a module because it has to execute
 * synchronously ahead of hydration; anything imported would arrive too late and
 * the app would flash paper on every load in Space mode. Mirrors `resolveTheme`
 * below — if you change one, change both.
 */
export const themeInitScript = `(function(){try{
var v=localStorage.getItem('${THEME_STORAGE_KEY}');
if(v!=='paper'&&v!=='space'&&v!=='system'){v='system';}
var dark=v==='space'||(v==='system'&&window.matchMedia('${DARK_QUERY}').matches);
var e=document.documentElement;
e.classList.toggle('dark',dark);
e.style.colorScheme=dark?'dark':'light';
}catch(e){}})();`;

type ThemeContextValue = {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Paper ⇄ Space. Leaves `system` behind, which is what a tap on a switch means. */
  toggle: () => void;
  /**
   * False until the first effect runs. Controls that render the *current* mode
   * should hold their label until this is true rather than guessing on the
   * server and correcting a frame later.
   */
  mounted: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "paper",
  setTheme: () => {},
  toggle: () => {},
  mounted: false,
});

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "space") return "space";
  if (theme === "paper") return "paper";
  return systemPrefersDark() ? "space" : "paper";
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "space");
  root.style.colorScheme = resolved === "space" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Starts at the SSR-safe default and is corrected on mount from storage. The
  // inline script has already put the right class on <html> by then, so this
  // catches React up rather than causing the flash it prevents.
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("paper");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* private mode — fall through to system */
    }
    const initial: Theme = isTheme(stored) ? stored : "system";
    setThemeState(initial);
    const next = resolveTheme(initial);
    setResolved(next);
    applyTheme(next);
    setMounted(true);
  }, []);

  // Follow the OS while the choice is `system`. Without this, changing the
  // system theme leaves the app on whatever it resolved to at load.
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const next: ResolvedTheme = query.matches ? "space" : "paper";
      setResolved(next);
      applyTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const resolvedNext = resolveTheme(next);
    setResolved(resolvedNext);
    applyTheme(resolvedNext);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode — the choice holds for this session only */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolveTheme(theme) === "space" ? "paper" : "space");
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, toggle, mounted }),
    [theme, resolved, setTheme, toggle, mounted],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
