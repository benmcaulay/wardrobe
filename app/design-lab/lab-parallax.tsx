"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";

/**
 * Smooth whole-stage mouse world — Unifiers-of-Japan essence:
 * laggy lerp, perspective tilt, multi-depth drift graphics.
 * Writes --lab-px / --lab-py on the stage (no React re-renders per frame).
 */
export function LabParallaxProvider({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const raf = useRef(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || reduce) {
      el?.style.setProperty("--lab-px", "0");
      el?.style.setProperty("--lab-py", "0");
      return;
    }

    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      target.current = {
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      };
    };

    const onLeave = () => {
      target.current = { x: 0, y: 0 };
    };

    // Heavy damping ≈ Framer spring settle (slow, cinematic).
    const LERP = 0.055;
    const tick = () => {
      const c = current.current;
      const t = target.current;
      c.x += (t.x - c.x) * LERP;
      c.y += (t.y - c.y) * LERP;
      el.style.setProperty("--lab-px", c.x.toFixed(4));
      el.style.setProperty("--lab-py", c.y.toFixed(4));
      raf.current = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.documentElement.addEventListener("mouseleave", onLeave);
    raf.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [reduce]);

  return (
    <div ref={rootRef} className="lab-parallax-root" data-reduce={reduce ? "1" : "0"}>
      {children}
    </div>
  );
}

/** Shifts the entire lab stage as one composition. */
export function LabWorldShift({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`lab-world ${className}`}>{children}</div>;
}

type DriftTheme = "hub" | "orbit" | "runway" | "stack";

type DriftMark = {
  kind: "orb" | "ring" | "rule" | "glyph" | "index" | "flare";
  label?: string;
  depth: number;
  x: string;
  y: string;
  size?: string;
  rotate?: number;
  delay?: number;
};

const THEME_MARKS: Record<DriftTheme, DriftMark[]> = {
  hub: [
    { kind: "orb", depth: 0.25, x: "12%", y: "18%", size: "28rem" },
    { kind: "orb", depth: 0.55, x: "78%", y: "62%", size: "18rem" },
    { kind: "ring", depth: 0.8, x: "64%", y: "22%", size: "9rem" },
    { kind: "rule", depth: 0.4, x: "8%", y: "72%", rotate: -8 },
    { kind: "glyph", label: "01", depth: 1.1, x: "86%", y: "14%" },
    { kind: "index", label: "LAB / 03", depth: 0.7, x: "18%", y: "84%" },
  ],
  orbit: [
    { kind: "orb", depth: 0.2, x: "8%", y: "12%", size: "32rem" },
    { kind: "orb", depth: 0.45, x: "72%", y: "70%", size: "22rem" },
    { kind: "ring", depth: 0.9, x: "58%", y: "18%", size: "11rem", delay: 1.2 },
    { kind: "ring", depth: 1.2, x: "22%", y: "58%", size: "7rem", delay: 2.4 },
    { kind: "flare", depth: 0.6, x: "40%", y: "8%", size: "14rem" },
    { kind: "glyph", label: "◈", depth: 1.35, x: "88%", y: "42%" },
    { kind: "index", label: "FIELD · 08", depth: 0.75, x: "6%", y: "88%" },
    { kind: "rule", depth: 0.5, x: "30%", y: "34%", rotate: 12 },
    { kind: "rule", depth: 1.0, x: "70%", y: "78%", rotate: -6 },
  ],
  runway: [
    { kind: "orb", depth: 0.18, x: "85%", y: "10%", size: "26rem" },
    { kind: "orb", depth: 0.5, x: "5%", y: "75%", size: "20rem" },
    { kind: "rule", depth: 0.65, x: "0%", y: "28%", rotate: 0 },
    { kind: "rule", depth: 1.05, x: "10%", y: "62%", rotate: -3 },
    { kind: "glyph", label: "STRIP", depth: 1.25, x: "78%", y: "48%" },
    { kind: "index", label: "01 / 08", depth: 0.85, x: "4%", y: "16%" },
    { kind: "flare", depth: 0.4, x: "48%", y: "82%", size: "16rem" },
    { kind: "ring", depth: 1.15, x: "32%", y: "22%", size: "8rem" },
  ],
  stack: [
    { kind: "orb", depth: 0.22, x: "70%", y: "8%", size: "30rem" },
    { kind: "orb", depth: 0.48, x: "10%", y: "68%", size: "24rem" },
    { kind: "ring", depth: 0.85, x: "48%", y: "42%", size: "13rem", delay: 0.8 },
    { kind: "glyph", label: "層", depth: 1.3, x: "82%", y: "70%" },
    { kind: "index", label: "SHEET · 03", depth: 0.7, x: "12%", y: "18%" },
    { kind: "rule", depth: 0.55, x: "20%", y: "88%", rotate: -11 },
    { kind: "flare", depth: 0.95, x: "58%", y: "24%", size: "12rem" },
    { kind: "rule", depth: 1.1, x: "62%", y: "56%", rotate: 7 },
  ],
};

/** Atmospheric moving graphics — depth-parallax + idle drift. */
export function LabDriftField({ theme }: { theme: DriftTheme }) {
  const marks = THEME_MARKS[theme];

  return (
    <div className={`lab-drift lab-drift-${theme}`} aria-hidden>
      {marks.map((m, i) => (
        <div
          key={`${m.kind}-${i}`}
          className={`lab-drift-mark lab-drift-${m.kind}`}
          style={
            {
              left: m.x,
              top: m.y,
              width: m.size,
              height: m.size,
              animationDelay: m.delay ? `${m.delay}s` : undefined,
              ["--depth" as string]: m.depth,
              ["--base-rot" as string]: `${m.rotate ?? 0}deg`,
            } as React.CSSProperties
          }
        >
          {m.kind === "glyph" || m.kind === "index" ? <span>{m.label}</span> : null}
          {m.kind === "ring" ? <i /> : null}
        </div>
      ))}
      <div className="lab-drift-vignette" />
    </div>
  );
}

export function useLabDriftTheme(): DriftTheme {
  const pathname = usePathname();
  if (pathname.includes("/orbit")) return "orbit";
  if (pathname.includes("/runway")) return "runway";
  if (pathname.includes("/stack")) return "stack";
  return "hub";
}
