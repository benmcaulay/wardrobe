"use client";

import { createContext, useContext, useEffect } from "react";

export type Theme = "light";
export type ResolvedTheme = "light";

/** Legacy key — cleared on mount so old dark preference doesn't linger. */
export const THEME_STORAGE_KEY = "wardrobe-theme";

/** Force light mode before hydration so the app never flashes dark. */
export const themeInitScript = `(function(){try{var e=document.documentElement;e.classList.remove('dark');e.style.colorScheme='light';localStorage.removeItem('${THEME_STORAGE_KEY}');}catch(e){}})();`;

type ThemeContextValue = {
  theme: Theme;
  resolved: ResolvedTheme;
  /** No-op — app is always light; landing page owns its own day/night canvas. */
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  resolved: "light",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      /* private mode */
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme: "light", resolved: "light", setTheme: () => {} }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
