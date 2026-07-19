"use client";

/** Visual badge for a wardrobe category slot on the outfit canvas. */
export function CategorySlotIcon({
  categories,
  compact,
}: {
  categories: string[];
  compact?: boolean;
}) {
  const label = categories.map((c) => c.trim()).filter(Boolean).join(" / ") || "piece";
  const glyph = categoryGlyph(categories[0] ?? label);

  if (compact) {
    return (
      <span className="flex items-center gap-1.5 pointer-events-none select-none">
        <span className="text-lg leading-none" aria-hidden>
          {glyph}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-ink-muted capitalize">{label}</span>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-center justify-center gap-1 w-full h-full pointer-events-none select-none p-1">
      <span className="text-3xl leading-none" aria-hidden>
        {glyph}
      </span>
      <span className="text-[9px] uppercase tracking-wide text-ink-muted capitalize text-center leading-tight">
        {label}
      </span>
    </span>
  );
}

function categoryGlyph(category: string): string {
  const c = category.trim().toLowerCase();
  if (c.includes("hat") || c.includes("cap") || c.includes("beanie")) return "🧢";
  if (c.includes("shoe") || c.includes("boot") || c.includes("sneaker")) return "👟";
  if (c.includes("bottom") || c.includes("pant") || c.includes("short") || c.includes("skirt"))
    return "👖";
  if (c.includes("dress")) return "👗";
  if (c.includes("outer") || c.includes("jacket") || c.includes("coat")) return "🧥";
  if (c.includes("accessory") || c.includes("bag") || c.includes("belt")) return "👜";
  if (c.includes("top") || c.includes("shirt") || c.includes("tee")) return "👕";
  return "👔";
}
