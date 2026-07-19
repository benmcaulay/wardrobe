"use client";

import { useCallback, useState } from "react";
import { FabricWarp, type FabricTheme } from "@/components/fabric-warp";
import { GoogleSignInButton } from "@/components/google-signin-button";

type Props = {
  demo: boolean;
  googleConfigured: boolean;
};

const HERO_BG: Record<FabricTheme, string> = {
  light: "#eef1f8",
  dark: "#080b18",
};

export function LandingHero({ demo, googleConfigured }: Props) {
  /** Landing-only backdrop — does not affect app chrome (always day). */
  const [fabricTheme, setFabricTheme] = useState<FabricTheme>("light");
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  const toggleAt = useCallback((clientX: number, clientY: number) => {
    setOrigin({ x: clientX, y: clientY });
    setFabricTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't steal clicks from sign-in / demo CTAs.
    if ((e.target as HTMLElement).closest("a, button, form, input")) return;
    toggleAt(e.clientX, e.clientY);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleAt(window.innerWidth / 2, window.innerHeight / 2);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={
        fabricTheme === "light"
          ? "Day backdrop. Click to switch to night."
          : "Night backdrop. Click to switch to day."
      }
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
      className="relative min-h-dvh overflow-hidden transition-colors duration-700 cursor-pointer outline-none"
      style={{ backgroundColor: HERO_BG[fabricTheme] }}
    >
      <FabricWarp className="absolute inset-0 h-full w-full" theme={fabricTheme} origin={origin} />

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 pointer-events-none">
        <h1 className="sr-only">Wardrobe</h1>

        {/* Spacer matches the canvas wordmark resting near ~40% height */}
        <div className="h-[min(38vh,20rem)] w-full shrink-0" aria-hidden />

        <div className="max-w-md text-center space-y-8 pointer-events-auto">
          <p
            className="font-sans font-medium uppercase tracking-[0.14em] text-xs leading-loose transition-colors duration-700"
            style={{ color: fabricTheme === "dark" ? "#ffffff" : "var(--ink-muted)" }}
          >
            Personal digital closet. Upload what you own, see it organized, and
            turn flat photos into clean ghost-mannequin product shots.
          </p>
          <div className="flex flex-col items-center gap-3">
            {googleConfigured && <GoogleSignInButton />}
            {demo && (
              <form action="/api/demo/enter" method="post">
                <button
                  type="submit"
                  className={
                    googleConfigured
                      ? "rounded-full border border-ink/20 bg-ink/5 text-ink backdrop-blur-sm px-8 py-3 text-sm tracking-wide hover:bg-ink/10 transition"
                      : "rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition"
                  }
                >
                  Enter demo
                </button>
              </form>
            )}
            {!googleConfigured && !demo && (
              <p className="text-sm text-ink-muted">
                No sign-in method is configured. Set GOOGLE_CLIENT_ID /
                GOOGLE_CLIENT_SECRET, or AUTH_DEMO_MODE=&quot;true&quot; for a
                local demo.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
