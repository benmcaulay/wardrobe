"use client";

import { useEffect, useRef } from "react";

type Point = {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  pinned: boolean;
};

export type FabricTheme = "light" | "dark";

type Props = {
  className?: string;
  /** Which palette to render. Changing this triggers a radial wipe transition. */
  theme?: FabricTheme;
  /** Client-space origin for the next wipe (e.g. the sun/moon toggle center). */
  origin?: { x: number; y: number } | null;
};

/** All colors that define a scene, so day and night are pure data. */
type Palette = {
  fallback: string;
  bgTop: string;
  bgMid: string;
  bgBottom: string;
  nebula: string; // "r, g, b"
  nebulaCoreA: number;
  nebulaMidA: number;
  bloom: string; // "r, g, b"
  bloomA: number;
  stripe: string; // "r, g, b"
  stripeA: number;
  bakedStar: string; // "r, g, b"
  bakedStarMaxA: number; // 0 disables the baked star field
  sheen: [string, string, string]; // wordmark vertical gradient
  sheenGlow: string; // "r, g, b"
  sheenGlowA: number; // 0 disables the glow
  overlayStar: string; // "r, g, b"
  overlayStarMul: number; // 0 hides the drifting starfield
  spot: string; // "r, g, b" cursor spotlight core
  spot2: string; // "r, g, b" spotlight falloff tint
  spotCoreA: number;
  spotMidA: number;
  vignette: string; // "r, g, b"
  vignetteA: number;
};

const PALETTES: Record<FabricTheme, Palette> = {
  // Night — deep-space indigo with a periwinkle nebula and a living starfield.
  dark: {
    fallback: "#080b18",
    bgTop: "#080b18",
    bgMid: "#111838",
    bgBottom: "#080b18",
    nebula: "116, 138, 232",
    nebulaCoreA: 0.5,
    nebulaMidA: 0.16,
    bloom: "150, 120, 220",
    bloomA: 0.22,
    stripe: "223, 230, 255",
    stripeA: 0.04,
    bakedStar: "223, 230, 255",
    bakedStarMaxA: 0.75,
    sheen: ["#ffffff", "#eaf0ff", "#b9c4ee"],
    sheenGlow: "116, 138, 232",
    sheenGlowA: 0.55,
    overlayStar: "223, 230, 255",
    overlayStarMul: 0.9,
    spot: "116, 138, 232",
    spot2: "170, 185, 255",
    spotCoreA: 0.18,
    spotMidA: 0.07,
    vignette: "3, 5, 12",
    vignetteA: 0.5,
  },
  // Day — a bright cool sky with a warm sun-glow behind an ink wordmark.
  light: {
    fallback: "#eef1f8",
    bgTop: "#e9edf7",
    bgMid: "#f7f9fd",
    bgBottom: "#e4e9f4",
    nebula: "255, 232, 198",
    nebulaCoreA: 0.6,
    nebulaMidA: 0.2,
    bloom: "255, 214, 170",
    bloomA: 0.18,
    stripe: "58, 74, 107",
    stripeA: 0.05,
    bakedStar: "0, 0, 0",
    bakedStarMaxA: 0,
    sheen: ["#3a352e", "#1a1613", "#2b2521"],
    sheenGlow: "255, 236, 205",
    sheenGlowA: 0,
    overlayStar: "255, 255, 255",
    overlayStarMul: 0,
    spot: "255, 226, 170",
    spot2: "255, 244, 214",
    spotCoreA: 0.2,
    spotMidA: 0.08,
    vignette: "120, 132, 168",
    vignetteA: 0.16,
  },
};

/** Coarse enough to stay smooth; fine enough that the wordmark warps cleanly. */
const COLS = 28;
const ROWS = 16;
// Moderate pull so the wordmark distorts but stays readable (+30%).
const INFLUENCE = 280;
const PULL = 0.55;
const SPRING = 0.24;
const DAMPING = 0.83;
const RETURN = 0.075;
const MAX_FORCE = 42;

const WIPE_MS = 750;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mixRgb(a: string, b: string, t: number) {
  const pa = a.split(",").map((n) => parseFloat(n));
  const pb = b.split(",").map((n) => parseFloat(n));
  return pa.map((v, i) => Math.round(lerp(v, pb[i] ?? v, t))).join(", ");
}

export function FabricWarp({ className, theme = "light", origin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originRef = useRef(origin);
  originRef.current = origin;
  // The pending theme request is read by the animation loop, so it survives
  // React StrictMode's mount/cleanup/mount effect dance without being lost.
  const pendingThemeRef = useRef<FabricTheme | null>(null);
  const pendingOriginRef = useRef<{ x: number; y: number } | null>(null);
  const applyRef = useRef<(() => void) | null>(null);
  // Compare against the last theme we acted on (not a mount flag) so React
  // StrictMode's double-invoked effects can't queue a spurious transition.
  const lastThemeRef = useRef<FabricTheme>(theme);

  useEffect(() => {
    if (theme === lastThemeRef.current) return;
    lastThemeRef.current = theme;
    pendingThemeRef.current = theme;
    pendingOriginRef.current = originRef.current ?? null;
    applyRef.current?.();
  }, [theme]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvasEl: HTMLCanvasElement = canvasRef.current;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvasEl.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Both day and night scenes stay resident so concurrent rings can stack
    // without stomping each other's textures.
    const bufCanvas = [document.createElement("canvas"), document.createElement("canvas")];
    const bufCtx = [
      bufCanvas[0].getContext("2d", { alpha: false }),
      bufCanvas[1].getContext("2d", { alpha: false }),
    ];
    if (!bufCtx[0] || !bufCtx[1]) return;

    const themeIdx = (t: FabricTheme) => (t === "light" ? 0 : 1);
    let curTheme: FabricTheme = theme;

    type Wipe = {
      theme: FabricTheme;
      cx: number;
      cy: number;
      r: number;
      maxR: number;
    };
    let wipes: Wipe[] = [];
    const MAX_WIPES = 8;

    let points: Point[] = [];
    let cssW = 0;
    let cssH = 0;
    let rw = 0; // render width (device pixels)
    let rh = 0;
    let scale = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let running = true;
    let pointerX = -9999;
    let pointerY = -9999;
    let pointerActive = false;
    let time = 0;
    let ready = false;
    let overlayStars: {
      x: number;
      y: number;
      r: number;
      depth: number;
      phase: number;
      speed: number;
    }[] = [];
    let spotX = -9999;
    let spotY = -9999;
    let spotA = 0;

    const sans =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--font-inter")
        .trim() || "ui-sans-serif, system-ui, sans-serif";

    function buildTextureInto(i: number, themeName: FabricTheme) {
      const pal = PALETTES[themeName];
      const c = bufCanvas[i];
      const t = bufCtx[i]!;
      c.width = Math.max(1, Math.floor(rw));
      c.height = Math.max(1, Math.floor(rh));

      const g = t.createLinearGradient(0, 0, 0, rh);
      g.addColorStop(0, pal.bgTop);
      g.addColorStop(0.5, pal.bgMid);
      g.addColorStop(1, pal.bgBottom);
      t.fillStyle = g;
      t.fillRect(0, 0, rw, rh);

      const cx = rw * 0.5;
      const cy = rh * 0.4;

      const glow = t.createRadialGradient(cx, cy, 8, cx, cy, Math.min(rw, rh) * 0.62);
      glow.addColorStop(0, `rgba(${pal.nebula}, ${pal.nebulaCoreA})`);
      glow.addColorStop(0.4, `rgba(${pal.nebula}, ${pal.nebulaMidA})`);
      glow.addColorStop(1, `rgba(${pal.nebula}, 0)`);
      t.fillStyle = glow;
      t.fillRect(0, 0, rw, rh);

      const bx = rw * 0.72;
      const by = rh * 0.74;
      const bloom = t.createRadialGradient(bx, by, 8, bx, by, Math.min(rw, rh) * 0.45);
      bloom.addColorStop(0, `rgba(${pal.bloom}, ${pal.bloomA})`);
      bloom.addColorStop(1, `rgba(${pal.bloom}, 0)`);
      t.fillStyle = bloom;
      t.fillRect(0, 0, rw, rh);

      // Vertical fabric stripes so the cloth reads as a woven textile.
      t.save();
      const band = 30 * scale;
      t.globalAlpha = pal.stripeA;
      t.strokeStyle = `rgba(${pal.stripe}, 1)`;
      t.lineWidth = scale;
      for (let x = 0; x < rw; x += band) {
        t.beginPath();
        t.moveTo(x + 0.5, 0);
        t.lineTo(x + 0.5, rh);
        t.stroke();
      }
      t.restore();

      // Baked star field — warps with the cloth (night only).
      if (pal.bakedStarMaxA > 0) {
        t.save();
        const starCount = Math.round((rw * rh) / (9000 * scale));
        for (let i2 = 0; i2 < starCount; i2++) {
          const sx = Math.random() * rw;
          const sy = Math.random() * rh;
          const r = (Math.random() * 1.1 + 0.35) * scale;
          t.globalAlpha = pal.bakedStarMaxA * (0.35 + Math.random() * 0.65);
          t.fillStyle = `rgba(${pal.bakedStar}, 1)`;
          t.beginPath();
          t.arc(sx, sy, r, 0, Math.PI * 2);
          t.fill();
        }
        t.restore();
      }

      // Wordmark: Inter, uppercase, widely tracked, with a vertical sheen.
      const setLS = (v: number) => {
        try {
          (t as unknown as { letterSpacing: string }).letterSpacing = `${v}px`;
        } catch {
          /* older engines: no canvas letterSpacing */
        }
      };
      const trackRatio = 0.24;
      const maxWidth = rw * 0.9;
      let titleSize = Math.min(rw * 0.18, 104 * scale);
      t.textAlign = "center";
      t.textBaseline = "middle";
      t.font = `500 ${titleSize}px ${sans}`;
      setLS(trackRatio * titleSize);
      const measured = t.measureText("WARDROBE").width;
      if (measured > maxWidth) {
        titleSize *= maxWidth / measured;
        t.font = `500 ${titleSize}px ${sans}`;
        setLS(trackRatio * titleSize);
      }
      const letterSpacing = trackRatio * titleSize;
      const sheen = t.createLinearGradient(0, cy - titleSize * 0.6, 0, cy + titleSize * 0.6);
      sheen.addColorStop(0, pal.sheen[0]);
      sheen.addColorStop(0.55, pal.sheen[1]);
      sheen.addColorStop(1, pal.sheen[2]);
      t.save();
      if (pal.sheenGlowA > 0) {
        t.shadowColor = `rgba(${pal.sheenGlow}, ${pal.sheenGlowA})`;
        t.shadowBlur = titleSize * 0.5;
      }
      t.fillStyle = sheen;
      // Canvas letterSpacing adds trailing space after the last glyph, which
      // nudges a centered string left by half a slot — offset to recenter.
      t.fillText("WARDROBE", cx + letterSpacing * 0.5, cy);
      t.restore();
      setLS(0);

      ready = true;
    }

    function buildBothTextures() {
      buildTextureInto(themeIdx("light"), "light");
      buildTextureInto(themeIdx("dark"), "dark");
    }

    function buildMesh() {
      points = [];
      for (let row = 0; row <= ROWS; row++) {
        for (let col = 0; col <= COLS; col++) {
          const x = (col / COLS) * rw;
          const y = (row / ROWS) * rh;
          const edge = row === 0 || row === ROWS || col === 0 || col === COLS;
          points.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, pinned: edge });
        }
      }
    }

    function buildOverlayStars() {
      overlayStars = [];
      const n = Math.round((rw * rh) / (26000 * scale));
      for (let i = 0; i < n; i++) {
        overlayStars.push({
          x: Math.random() * rw,
          y: Math.random() * rh,
          r: (Math.random() * 1.1 + 0.3) * scale,
          depth: 0.3 + Math.random() * 0.9,
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 1.3,
        });
      }
    }

    function settleWipes() {
      if (wipes.length > 0) {
        curTheme = wipes[wipes.length - 1]!.theme;
        wipes = [];
      }
    }

    function resize() {
      cssW = window.innerWidth;
      cssH = window.innerHeight;
      scale = Math.min(window.devicePixelRatio || 1, 2);
      rw = Math.max(1, Math.floor(cssW * scale));
      rh = Math.max(1, Math.floor(cssH * scale));
      canvasEl.width = rw;
      canvasEl.height = rh;
      canvasEl.style.width = `${cssW}px`;
      canvasEl.style.height = `${cssH}px`;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.imageSmoothingEnabled = true;
      // A resize invalidates buffer sizes — settle rings onto the latest theme.
      settleWipes();
      buildBothTextures();
      buildMesh();
      buildOverlayStars();
    }

    function startWipe(toTheme: FabricTheme, o: { x: number; y: number } | null) {
      // Already settled on that theme with nothing in flight — no-op so the
      // per-frame poll can call this freely.
      const top = wipes[wipes.length - 1];
      const effective = top ? top.theme : curTheme;
      if (toTheme === effective) return;

      if (reduced) {
        curTheme = toTheme;
        wipes = [];
        paintStatic();
        return;
      }

      const ox = o ? o.x * scale : rw / 2;
      const oy = o ? o.y * scale : rh * 0.4;
      const maxR = Math.hypot(Math.max(ox, rw - ox), Math.max(oy, rh - oy)) + 4 * scale;

      // Cap spam: fold the oldest completed-looking ring into the base.
      if (wipes.length >= MAX_WIPES) {
        const oldest = wipes.shift()!;
        curTheme = oldest.theme;
      }

      wipes.push({ theme: toTheme, cx: ox, cy: oy, r: 0, maxR });
    }

    function processPending() {
      const pt = pendingThemeRef.current;
      if (!pt) return;
      // Consume before startWipe so a no-op still clears the request; otherwise
      // we'd re-fire every frame while already targeting that theme.
      pendingThemeRef.current = null;
      const origin = pendingOriginRef.current;
      pendingOriginRef.current = null;
      startWipe(pt, origin);
    }
    applyRef.current = processPending;

    function idx(col: number, row: number) {
      return row * (COLS + 1) + col;
    }

    function spring(a: Point, b: Point) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const rest = Math.hypot(b.ox - a.ox, b.oy - a.oy);
      const diff = (dist - rest) / dist;
      const fx = dx * diff * SPRING;
      const fy = dy * diff * SPRING;
      if (!a.pinned) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.pinned) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    function toRender(cssX: number, cssY: number) {
      return { x: cssX * scale, y: cssY * scale };
    }

    function step(dt: number) {
      time += dt;
      if (wipes.length > 0) {
        const next: Wipe[] = [];
        for (const wipe of wipes) {
          wipe.r += wipe.maxR * (dt / WIPE_MS);
          if (wipe.r >= wipe.maxR) {
            curTheme = wipe.theme;
          } else {
            next.push(wipe);
          }
        }
        wipes = next;
      }

      const breath = pointerActive ? 0.28 : 1;

      for (let row = 1; row < ROWS; row++) {
        for (let col = 1; col < COLS; col++) {
          const p = points[idx(col, row)];
          p.vx += Math.sin(time * 0.0011 + p.ox * 0.012 + p.oy * 0.01) * 0.55 * breath;
          p.vy += Math.cos(time * 0.0009 + p.ox * 0.008 - p.oy * 0.011) * 0.4 * breath;
        }
      }

      if (pointerActive) {
        const cursor = toRender(pointerX, pointerY);
        const influence = INFLUENCE * scale;
        const r2 = influence * influence;
        for (const p of points) {
          if (p.pinned) continue;
          const dx = p.x - cursor.x;
          const dy = p.y - cursor.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2 || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const falloff = 1 - d / influence;
          const strength = falloff * falloff * PULL;
          p.vx += (cursor.x - p.ox) * strength * 0.117;
          p.vy += (cursor.y - p.oy) * strength * 0.117;
          p.vx += (-dy / d) * strength * 2.08;
          p.vy += (dx / d) * strength * 2.08;
        }
      }

      for (let row = 0; row <= ROWS; row++) {
        for (let col = 0; col <= COLS; col++) {
          const a = points[idx(col, row)];
          if (col < COLS) spring(a, points[idx(col + 1, row)]);
          if (row < ROWS) spring(a, points[idx(col, row + 1)]);
          if (col < COLS && row < ROWS) spring(a, points[idx(col + 1, row + 1)]);
          if (col > 0 && row < ROWS) spring(a, points[idx(col - 1, row + 1)]);
        }
      }

      const maxF = MAX_FORCE * scale;
      for (const p of points) {
        if (p.pinned) {
          p.x = p.ox;
          p.y = p.oy;
          p.vx = 0;
          p.vy = 0;
          continue;
        }
        p.vx += (p.ox - p.x) * RETURN;
        p.vy += (p.oy - p.y) * RETURN;
        p.vx = Math.max(-maxF, Math.min(maxF, p.vx * DAMPING));
        p.vy = Math.max(-maxF, Math.min(maxF, p.vy * DAMPING));
        p.x += p.vx;
        p.y += p.vy;
      }
    }

    function drawTexturedTriangle(
      tex: HTMLCanvasElement,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      u2: number,
      v2: number,
    ) {
      ctx!.save();
      ctx!.beginPath();
      ctx!.moveTo(x0, y0);
      ctx!.lineTo(x1, y1);
      ctx!.lineTo(x2, y2);
      ctx!.closePath();
      ctx!.clip();

      x1 -= x0;
      y1 -= y0;
      x2 -= x0;
      y2 -= y0;
      u1 -= u0;
      v1 -= v0;
      u2 -= u0;
      v2 -= v0;

      const det = u1 * v2 - u2 * v1;
      if (Math.abs(det) < 1e-4) {
        ctx!.restore();
        return;
      }

      const a = (x1 * v2 - x2 * v1) / det;
      const b = (y1 * v2 - y2 * v1) / det;
      const c = (x2 * u1 - x1 * u2) / det;
      const d = (y2 * u1 - y1 * u2) / det;
      const e = x0 - a * u0 - c * v0;
      const f = y0 - b * u0 - d * v0;

      ctx!.transform(a, b, c, d, e, f);
      ctx!.drawImage(tex, 0, 0);
      ctx!.restore();
    }

    function drawCloth(tex: HTMLCanvasElement) {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const p00 = points[idx(col, row)];
          const p10 = points[idx(col + 1, row)];
          const p01 = points[idx(col, row + 1)];
          const p11 = points[idx(col + 1, row + 1)];
          drawTexturedTriangle(
            tex, p00.x, p00.y, p10.x, p10.y, p01.x, p01.y,
            p00.ox, p00.oy, p10.ox, p10.oy, p01.ox, p01.oy,
          );
          drawTexturedTriangle(
            tex, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y,
            p10.ox, p10.oy, p11.ox, p11.oy, p01.ox, p01.oy,
          );
        }
      }
    }

    function render() {
      if (!ready) return;
      const basePal = PALETTES[curTheme];
      ctx!.fillStyle = basePal.fallback;
      ctx!.fillRect(0, 0, rw, rh);
      drawCloth(bufCanvas[themeIdx(curTheme)]);

      // Stack every in-flight ring so rapid clicks expand simultaneously.
      for (const wipe of wipes) {
        const wr = Math.max(0, wipe.r);
        const toPal = PALETTES[wipe.theme];
        ctx!.save();
        ctx!.beginPath();
        ctx!.arc(wipe.cx, wipe.cy, wr, 0, Math.PI * 2);
        ctx!.clip();
        ctx!.fillStyle = toPal.fallback;
        ctx!.fillRect(0, 0, rw, rh);
        drawCloth(bufCanvas[themeIdx(wipe.theme)]);
        ctx!.restore();
      }

      const top = wipes[wipes.length - 1];
      const fromPal = basePal;
      const toPal = top ? PALETTES[top.theme] : basePal;
      const p = top ? Math.min(1, Math.max(0, top.r) / top.maxR) : 1;
      drawOverlays(fromPal, toPal, p);

      for (const wipe of wipes) {
        const wr = Math.max(0, wipe.r);
        const ringPal = PALETTES[wipe.theme];
        const rp = Math.min(1, wr / wipe.maxR);
        // Glowing leading edge — light spilling across the cloth.
        ctx!.save();
        ctx!.globalCompositeOperation = "lighter";
        ctx!.beginPath();
        ctx!.arc(wipe.cx, wipe.cy, wr, 0, Math.PI * 2);
        ctx!.lineWidth = 2.5 * scale;
        ctx!.strokeStyle = `rgba(${ringPal.spot2}, ${0.6 * (1 - rp)})`;
        ctx!.shadowColor = `rgba(${ringPal.spot}, 0.9)`;
        ctx!.shadowBlur = 26 * scale;
        ctx!.stroke();
        ctx!.restore();
      }
    }

    function drawOverlays(fromPal: Palette, toPal: Palette, p: number) {
      const vigCol = mixRgb(fromPal.vignette, toPal.vignette, p);
      const vigA = lerp(fromPal.vignetteA, toPal.vignetteA, p);
      const vg = ctx!.createRadialGradient(
        rw / 2, rh * 0.42, Math.min(rw, rh) * 0.18,
        rw / 2, rh * 0.5, Math.max(rw, rh) * 0.72,
      );
      vg.addColorStop(0, `rgba(${vigCol}, 0)`);
      vg.addColorStop(1, `rgba(${vigCol}, ${vigA})`);
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, 0, rw, rh);

      const cur2 =
        pointerActive && pointerX > -9000
          ? toRender(pointerX, pointerY)
          : { x: rw / 2, y: rh / 2 };
      const parX = (cur2.x - rw / 2) * 0.03;
      const parY = (cur2.y - rh / 2) * 0.03;

      // Drifting parallax starfield (night). Fades out toward day.
      const starMul = lerp(fromPal.overlayStarMul, toPal.overlayStarMul, p);
      if (starMul > 0.001) {
        const starCol = mixRgb(fromPal.overlayStar, toPal.overlayStar, p);
        ctx!.save();
        ctx!.globalCompositeOperation = "lighter";
        ctx!.fillStyle = `rgba(${starCol}, 1)`;
        for (const s of overlayStars) {
          const drift = (time * 0.006 * s.speed) % (rh + 40);
          const sx = s.x + parX * s.depth;
          let sy = s.y + drift + parY * s.depth;
          if (sy > rh) sy -= rh + 40;
          const tw = 0.35 + 0.45 * Math.sin(time * 0.0022 * s.speed + s.phase);
          ctx!.globalAlpha = Math.max(0, tw) * s.depth * starMul;
          ctx!.beginPath();
          ctx!.arc(sx, sy, s.r, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.restore();
      }

      // Cursor spotlight — a moon-cool glow at night, warm daylight by day.
      const targetA = pointerActive ? 1 : 0;
      spotA += (targetA - spotA) * 0.08;
      if (pointerActive && pointerX > -9000) {
        spotX = cur2.x;
        spotY = cur2.y;
      }
      if (spotA > 0.01 && spotX > -9000) {
        const spotCol = mixRgb(fromPal.spot, toPal.spot, p);
        const spot2Col = mixRgb(fromPal.spot2, toPal.spot2, p);
        const coreA = lerp(fromPal.spotCoreA, toPal.spotCoreA, p);
        const midA = lerp(fromPal.spotMidA, toPal.spotMidA, p);
        ctx!.save();
        ctx!.globalCompositeOperation = "lighter";
        const rad = Math.min(rw, rh) * 0.3;
        const sp = ctx!.createRadialGradient(spotX, spotY, 0, spotX, spotY, rad);
        sp.addColorStop(0, `rgba(${spotCol}, ${coreA * spotA})`);
        sp.addColorStop(0.5, `rgba(${spot2Col}, ${midA * spotA})`);
        sp.addColorStop(1, `rgba(${spot2Col}, 0)`);
        ctx!.fillStyle = sp;
        ctx!.fillRect(0, 0, rw, rh);
        ctx!.restore();
      }
    }

    function paintStatic() {
      if (!ready) return;
      const pal = PALETTES[curTheme];
      ctx!.fillStyle = pal.fallback;
      ctx!.fillRect(0, 0, rw, rh);
      drawCloth(bufCanvas[themeIdx(curTheme)]);
      drawOverlays(pal, pal, 1);
    }

    let last = performance.now();
    function loop(now: number) {
      if (!running) return;
      const dt = Math.min(32, now - last);
      last = now;
      processPending();
      step(dt);
      render();
      raf = requestAnimationFrame(loop);
    }

    function onPointerMove(e: PointerEvent) {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerActive = true;
    }

    function onPointerEnd() {
      pointerActive = false;
      pointerX = -9999;
      pointerY = -9999;
    }

    function onVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduced && running) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    }

    resize();
    void document.fonts.ready.then(() => {
      buildBothTextures();
      if (reduced) paintStatic();
      else render();
    });

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerEnd);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduced) {
      paintStatic();
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      applyRef.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      document.documentElement.removeEventListener("mouseleave", onPointerEnd);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{ touchAction: "none" }}
    />
  );
}
