"use client";

import { useState } from "react";
import { OutfitBuilder, type SavedOutfit } from "./outfit-builder";
import { RandomOutfitBuilder, type RandomOutfitItem } from "./random-outfit-builder";
import type { Color } from "@/lib/json";
import type { OutfitSlotDefaults } from "@/lib/outfit-slot-defaults";

type Tab = "random" | "compose";

type Props = {
  items: RandomOutfitItem[];
  colorOptions: Color[];
  initialOutfits: SavedOutfit[];
  outfitSlotDefaults: OutfitSlotDefaults;
};

export function OutfitStudio({ items, colorOptions, initialOutfits, outfitSlotDefaults }: Props) {
  const [tab, setTab] = useState<Tab>("random");

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-full border border-ink/10 bg-paper-warm p-1 w-fit">
        <TabButton active={tab === "random"} onClick={() => setTab("random")}>
          Random generator
        </TabButton>
        <TabButton active={tab === "compose"} onClick={() => setTab("compose")}>
          Manual compose
        </TabButton>
      </div>

      {tab === "random" ? (
        <RandomOutfitBuilder
          items={items}
          colorOptions={colorOptions}
          initialSlotDefaults={outfitSlotDefaults}
        />
      ) : (
        <OutfitBuilder items={items} colorOptions={colorOptions} initialOutfits={initialOutfits} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs tracking-wide transition ${
        active ? "bg-ink text-paper shadow-sm" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
