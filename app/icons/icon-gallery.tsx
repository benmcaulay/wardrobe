"use client";

import { useMemo, useState } from "react";
import { ICON_REGISTRY } from "@/components/icons";

const SIZES = [16, 20, 24, 32] as const;

export function IconGallery() {
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<number>(24);
  const [copied, setCopied] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICON_REGISTRY;
    return ICON_REGISTRY.filter(
      (i) => i.name.includes(q) || i.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  async function copy(name: string, pascal: string) {
    try {
      await navigator.clipboard.writeText(`<${pascal} className="h-5 w-5" />`);
      setCopied(name);
      setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200);
    } catch {
      /* clipboard blocked — the name is on screen anyway */
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="min-w-[14rem] flex-1 rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
        />
        <div className="flex items-center gap-1 rounded-full bg-paper-warm p-0.5 text-xs">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`rounded-full px-3 py-1 transition ${
                size === s ? "bg-surface text-ink shadow-tile" : "text-ink-muted hover:text-ink"
              }`}
            >
              {s}px
            </button>
          ))}
        </div>
        <span className="text-xs tabular-nums text-ink-muted">{shown.length} icons</span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-paper-warm p-10 text-center text-ink-muted">
          Nothing matches “{query}”.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map(({ name, Component }) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => copy(name, name)}
                title="Copy JSX"
                className="flex w-full flex-col items-center gap-3 rounded-2xl border border-ink/10 bg-surface px-3 py-5 transition hover:border-ink/25 hover:bg-paper-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Component size={size} className="text-ink" />
                <span className="w-full truncate text-center text-[11px] text-ink-muted">
                  {copied === name ? "copied" : name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Same components on ink — proves currentColor inheritance with no
          background plate to punch a light square out of the dark. */}
      <section className="rounded-2xl bg-ink p-6">
        <h2 className="mb-4 text-[11px] uppercase tracking-[0.18em] text-paper/50">
          On a dark surface — same components, no background plate
        </h2>
        <ul className="flex flex-wrap gap-5">
          {shown.slice(0, 24).map(({ name, Component }) => (
            <li key={name} title={name}>
              <Component size={size} className="text-paper" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
