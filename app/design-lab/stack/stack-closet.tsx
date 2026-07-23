"use client";

import { useMemo, useState } from "react";
import { LAB_ITEMS, type LabItem } from "../mock-items";

const CATEGORIES = ["all", ...Array.from(new Set(LAB_ITEMS.map((i) => i.category)))];

export function StackCloset() {
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

  return (
    <div className="stack-shell">
      <div className="stack-shear" aria-hidden />
      <div className="stack-content">
        <div className="stack-hero">
          <div>
            <h1 className="stack-title">
              Your
              <span>wardrobe</span>
              stacked
            </h1>
          </div>
          <div className="stack-side">
            <div className="stack-sheet">
              <nav className="stack-nav" aria-label="Primary">
                {(
                  [
                    ["closet", "closet"],
                    ["outfits", "outfits"],
                    ["tryon", "try on"],
                    ["pack", "pack"],
                    ["sell", "sell"],
                    ["settings", "settings"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={nav === id ? "is-on" : ""}
                    onClick={() => {
                      setNav(id);
                      setSelected(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <input
                className="stack-search"
                placeholder="Search through the sheets…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--s-mute)" }}>
                ◈ 42 credits · Gloock + Ojuju · peel to inspect
              </p>
            </div>
          </div>
        </div>

        {nav !== "closet" ? (
          <div className="stack-sheet" style={{ maxWidth: "32rem", transform: "rotate(-1deg)" }}>
            <h2
              style={{
                fontFamily: "var(--lab-font-stack-display), Georgia, serif",
                fontSize: "2.4rem",
                lineHeight: 0.9,
              }}
            >
              {nav} sheet
            </h2>
            <p style={{ marginTop: "0.6rem", color: "var(--s-mute)", lineHeight: 1.45 }}>
              A new frosted plane for this destination. Production would navigate; here the sheet
              replaces the grid.
            </p>
            <button
              type="button"
              className="primary"
              style={{
                marginTop: "1rem",
                border: "none",
                borderRadius: "999px",
                padding: "0.55rem 1rem",
                background: "var(--s-ink)",
                color: "var(--s-lime)",
                fontWeight: 600,
                cursor: "pointer",
              }}
              onClick={() => setNav("closet")}
            >
              Back to stack
            </button>
          </div>
        ) : (
          <>
            <div className="stack-filters">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cat === c ? "is-on" : ""}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="stack-grid">
              {items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={`stack-card ${selected?.id === item.id ? "is-selected" : ""}`}
                  style={{ animationDelay: `${i * 0.045}s` }}
                  onClick={() => setSelected(item)}
                >
                  <div
                    className="stack-sheet"
                    style={{
                      transform: `rotate(${i % 2 === 0 ? -1.2 : 1.1}deg)`,
                    }}
                  >
                    <div
                      className="stack-art"
                      style={
                        {
                          ["--g-hue" as string]: item.hue,
                          ["--g-accent" as string]: item.accent,
                        } as React.CSSProperties
                      }
                    />
                    <div className="stack-card-meta">
                      <strong>{item.name}</strong>
                      <span>
                        {item.brand} · {item.category}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="stack-peel" role="dialog" aria-modal="true" aria-label={selected.name}>
          <div className="stack-peel-sheet">
            <h3>{selected.name}</h3>
            <p style={{ color: "var(--s-mute)", fontSize: "0.85rem" }}>
              {selected.brand} · {selected.category} · {selected.season}
            </p>
            <div
              className="stack-art"
              style={
                {
                  marginTop: "1rem",
                  maxWidth: "14rem",
                  ["--g-hue" as string]: selected.hue,
                  ["--g-accent" as string]: selected.accent,
                } as React.CSSProperties
              }
            />
            <p style={{ marginTop: "1rem", lineHeight: 1.5, fontSize: "0.95rem" }}>
              Detail peels up as a fresh translucent sheet over the stack — layered UI instead of a
              hard route cut.
            </p>
            <div className="stack-peel-actions">
              <button type="button" className="primary" onClick={() => setSelected(null)}>
                Keep browsing
              </button>
              <button type="button" className="ghost" onClick={() => setSelected(null)}>
                Close sheet
              </button>
            </div>
          </div>
        </div>
      )}

      <button type="button" className="stack-fab" aria-label="Add item">
        +
      </button>
    </div>
  );
}
