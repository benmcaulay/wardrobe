"use client";

import { useEffect, useMemo, useState } from "react";
import { LAB_ITEMS, type LabItem } from "../mock-items";

const CATEGORIES = ["all", ...Array.from(new Set(LAB_ITEMS.map((i) => i.category)))];
const MARQUEE = [
  "sweater",
  "outerwear",
  "bottom",
  "dress",
  "shoes",
  "accessory",
  "top",
  "scan roll",
  "try on",
  "pack trip",
  "sell",
];

export function RunwayCloset() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [selected, setSelected] = useState<LabItem | null>(null);
  const [panel, setPanel] = useState<"closet" | "outfits" | "tryon" | "pack" | "sell">("closet");
  const [wiping, setWiping] = useState(false);
  const [fabPos, setFabPos] = useState({ x: 24, y: 70 });

  const items = useMemo(() => {
    return LAB_ITEMS.filter((i) => {
      if (cat !== "all" && i.category !== cat) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${i.name} ${i.brand} ${i.category}`.toLowerCase().includes(q);
    });
  }, [query, cat]);

  function go(next: typeof panel) {
    if (next === panel) return;
    setWiping(true);
    window.setTimeout(() => {
      setPanel(next);
      setSelected(null);
    }, 260);
    window.setTimeout(() => setWiping(false), 580);
  }

  useEffect(() => {
    if (!selected) {
      setFabPos({ x: 88, y: 82 });
      return;
    }
    const idx = items.findIndex((i) => i.id === selected.id);
    setFabPos({
      x: Math.min(86, 12 + Math.max(0, idx) * 8),
      y: 62,
    });
  }, [selected, items]);

  const marqueeText = [...MARQUEE, ...MARQUEE].join("  ·  ");

  return (
    <div className="runway-shell">
      <header className="runway-header">
        <div>
          <div className="runway-brand">
            WAR<em>DROBE</em>
          </div>
        </div>
        <nav className="runway-nav" aria-label="Primary">
          {(
            [
              ["closet", "Closet"],
              ["outfits", "Outfits"],
              ["tryon", "Try on"],
              ["pack", "Pack"],
              ["sell", "Sell"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={panel === id ? "is-on" : ""}
              onClick={() => go(id)}
            >
              {label}
            </button>
          ))}
          <a href="/settings">◈ 42</a>
        </nav>
      </header>

      <div className="runway-marquee" aria-hidden>
        <div className="runway-marquee-track">
          <span>{marqueeText}</span>
          <span>{marqueeText}</span>
        </div>
      </div>

      <div className="runway-controls">
        <input
          placeholder="Filter the strip…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={cat === c ? "is-on" : ""}
            onClick={() => setCat(c)}
            style={{
              border: "2px solid var(--r-ink)",
              background: cat === c ? "var(--r-ink)" : "#fff",
              color: cat === c ? "var(--r-acid)" : "var(--r-ink)",
              padding: "0.4rem 0.7rem",
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {panel === "closet" ? (
        <div className="runway-strip-wrap">
          <div className="runway-strip">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={`runway-tile ${selected?.id === item.id ? "is-selected" : ""}`}
                style={{
                  animationDelay: `${i * 0.04}s`,
                  ["--g-hue" as string]: item.hue,
                  ["--g-accent" as string]: item.accent,
                }}
                onClick={() => setSelected(item)}
              >
                <div className="runway-tile-art" />
                <div className="runway-tile-meta">
                  <strong>{item.name}</strong>
                  <span>
                    {item.brand} · {item.season}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: "2rem 1.25rem", position: "relative", zIndex: 2 }}>
          <h2
            style={{
              fontFamily: "var(--lab-font-runway-display), Impact, sans-serif",
              fontSize: "clamp(2.5rem, 8vw, 5rem)",
              textTransform: "uppercase",
              lineHeight: 0.85,
            }}
          >
            {panel} lane
          </h2>
          <p style={{ marginTop: "0.75rem", maxWidth: "28rem", color: "var(--r-mute)" }}>
            Curtain wipe landed you here. Production would route to /closet/{panel}. Tap Closet to
            wipe back.
          </p>
        </div>
      )}

      <div className={`runway-curtain ${wiping ? "is-wiping" : ""}`} aria-hidden>
        <span />
        <span />
      </div>

      <aside className={`runway-panel ${selected ? "is-open" : ""}`}>
        {selected && (
          <>
            <h3>{selected.name}</h3>
            <p style={{ opacity: 0.7, fontSize: "0.85rem" }}>
              {selected.brand} · {selected.category} · {selected.season}
            </p>
            <p style={{ marginTop: "0.75rem", maxWidth: "36rem", lineHeight: 1.45 }}>
              Bottom drawer detail — the strip stays in motion behind the ink slab.
            </p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{
                marginTop: "1rem",
                border: "2px solid var(--r-acid)",
                background: "transparent",
                color: "var(--r-acid)",
                padding: "0.45rem 0.9rem",
                fontWeight: 700,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </>
        )}
      </aside>

      <button
        type="button"
        className="runway-fab-orbit"
        aria-label="Add item"
        style={{ left: `${fabPos.x}%`, top: `${fabPos.y}%` }}
      >
        +
      </button>
    </div>
  );
}
