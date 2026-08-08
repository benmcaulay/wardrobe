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
  outfitLayerOrder: string[];
  outfitVisualLayers: string[][];
  outfitComboLayouts: Record<string, { x?: number; y?: number; scale?: number }>;
  outfitLayerArrangements: Record<string, string[]>;
};

export function OutfitStudio({
  items,
  colorOptions,
  initialOutfits,
  outfitSlotDefaults,
  outfitLayerOrder,
  outfitVisualLayers,
  outfitComboLayouts,
  outfitLayerArrangements,
}: Props) {
  const [tab, setTab] = useState<Tab>("random");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header>
          <h1 className="font-serif text-4xl tracking-tight">Outfits</h1>
          <p className="text-ink-muted mt-2 max-w-xl">
            Spin random outfits from rules, place category slots on the frame, or compose manually.
          </p>
        </header>
        <div className="flex gap-1 rounded-full border border-ink/10 bg-paper-warm p-1 w-fit shrink-0">
          <TabButton active={tab === "random"} onClick={() => setTab("random")}>
            Random generator
          </TabButton>
          <TabButton active={tab === "compose"} onClick={() => setTab("compose")}>
            Manual compose
          </TabButton>
        </div>
      </div>

      {tab === "random" ? (
        <RandomOutfitBuilder
          items={items}
          colorOptions={colorOptions}
          initialSlotDefaults={outfitSlotDefaults}
          initialLayerOrder={outfitLayerOrder}
          initialVisualLayers={outfitVisualLayers}
          initialComboLayouts={outfitComboLayouts}
          initialLayerArrangements={outfitLayerArrangements}
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
