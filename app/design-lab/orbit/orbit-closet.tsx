"use client";

import { useMemo, useRef, useState } from "react";
import { LAB_ITEMS, type LabItem } from "../mock-items";

const CATEGORIES = ["all", ...Array.from(new Set(LAB_ITEMS.map((i) => i.category)))];

const POSITIONS = [
  { x: 8, y: 8, z: 40, delay: 0 },
  { x: 38, y: 4, z: -20, delay: 0.05 },
  { x: 68, y: 12, z: 60, delay: 0.1 },
  { x: 18, y: 42, z: -40, delay: 0.12 },
  { x: 48, y: 38, z: 20, delay: 0.16 },
  { x: 74, y: 48, z: -10, delay: 0.2 },
  { x: 28, y: 68, z: 50, delay: 0.22 },
  { x: 58, y: 72, z: -30, delay: 0.26 },
];

export function OrbitCloset() {
  const fieldRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [selected, setSelected] = useState<LabItem | null>(null);
  const [nav, setNav] = useState("closet");

  const items = useMemo(() => {
    return LAB_ITEMS.filter((i) => {
      if (cat !== "all" && i.category !== cat) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${i.name} ${i.brand} ${i.category}`.toLowerCase().includes(q);
    });
  }, [query, cat]);

  function onPointerMove(e: React.PointerEvent) {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${px * 10}deg) rotateX(${-py * 7}deg)`;
  }

  function onPointerLeave() {
    if (fieldRef.current) fieldRef.current.style.transform = "";
  }

  return (
    <div className="orbit-shell">
      <div className="orbit-noise" aria-hidden />
      <div className="orbit-layout">
        <nav className="orbit-rail" aria-label="Primary">
          {[
            ["closet", "Closet"],
            ["outfits", "Outfits"],
            ["tryon", "Try on"],
            ["pack", "Pack"],
            ["sell", "Sell"],
            ["settings", "Settings"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={nav === id ? "is-active" : ""}
              onClick={() => setNav(id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.65rem",
                padding: "0.65rem 0.55rem",
                borderRadius: "0.75rem",
                border: "none",
                background: nav === id ? "rgba(62, 207, 191, 0.12)" : "transparent",
                color: nav === id ? "var(--o-accent)" : "var(--o-muted)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                width: "100%",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <span className="orbit-rail-dot" />
              <span className="orbit-rail-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="orbit-main">
          <div className="orbit-top">
            <div>
              <div className="orbit-wordmark">WARDROBE</div>
              <p className="orbit-sub">Orbit · spatial closet · {items.length} in field</p>
            </div>
            <div className="orbit-tools">
              <input
                className="orbit-search"
                placeholder="Search field…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`orbit-chip ${cat === c ? "is-on" : ""}`}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
              <span className="orbit-chip orbit-credits">◈ 42</span>
            </div>
          </div>

          {nav !== "closet" ? (
            <div className="orbit-detail" style={{ position: "relative", right: "auto", bottom: "auto" }}>
              <h3>{nav}</h3>
              <p style={{ color: "var(--o-muted)", fontSize: "0.8rem", marginTop: "0.4rem" }}>
                Same destination as production — this panel stands in for the route transition into{" "}
                {nav}.
              </p>
              <button type="button" className="orbit-chip is-on" style={{ marginTop: "0.8rem" }} onClick={() => setNav("closet")}>
                Return to field
              </button>
            </div>
          ) : (
            <div
              ref={fieldRef}
              className="orbit-field"
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
            >
              {items.map((item, idx) => {
                const pos = POSITIONS[idx % POSITIONS.length]!;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`orbit-card ${selected?.id === item.id ? "is-selected" : ""}`}
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      transform: `translateZ(${pos.z}px)`,
                      animationDelay: `${pos.delay}s`,
                      ["--g-hue" as string]: item.hue,
                      ["--g-accent" as string]: item.accent,
                    }}
                    onClick={() => setSelected(item)}
                  >
                    <div className="orbit-swatch" />
                    <div className="orbit-meta">
                      <strong>{item.name}</strong>
                      <span>
                        {item.brand} · {item.category}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selected && nav === "closet" && (
        <aside className="orbit-detail" aria-live="polite">
          <h3>{selected.name}</h3>
          <p style={{ color: "var(--o-muted)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
            {selected.brand} · {selected.category} · {selected.season}
          </p>
          <p style={{ fontSize: "0.8rem", marginTop: "0.7rem", lineHeight: 1.45 }}>
            Depth card selected. In production this opens item detail — here it docks as a floating
            telemetry sheet.
          </p>
          <button
            type="button"
            className="orbit-chip"
            style={{ marginTop: "0.8rem" }}
            onClick={() => setSelected(null)}
          >
            Dismiss
          </button>
        </aside>
      )}

      <button
        type="button"
        className={`orbit-fab ${selected ? "is-pushed" : ""}`}
        aria-label="Add item"
        title="Add item"
      >
        +
      </button>
    </div>
  );
}
