"use client";

/**
 * The Outfits page shell.
 *
 * Three tabs over one closet, in the order the work happens: let the model
 * propose (Smart Generator), do it yourself (Manual compose), or teach it (Train
 * your stylist). What used to be the "Today" tab is folded in rather than kept
 * as a fourth: the weather card joins the generator's rules column (it is another
 * constraint on the outfit, like a colour rule), and styling tips live with the
 * trainer.
 */

import { useCallback, useState, useTransition } from "react";
import { OutfitBuilder, type SavedOutfit } from "./outfit-builder";
import { RandomOutfitBuilder, type RandomOutfitItem } from "./random-outfit-builder";
import { StylistTrainer } from "./stylist-trainer";
import { WeatherCard, useDailyWeather } from "./weather-card";
import { PendingWearsCard } from "./pending-wears";
import { StyleRulesPanel } from "./style-rules-panel";
import type { Color } from "@/lib/json";
import type { OutfitSlotDefaults } from "@/lib/outfit-slot-defaults";
import type { CategoryRule } from "@/lib/outfit-random";
import type { TemperatureUnit } from "@/lib/temperature";
import type { DailyContext } from "@/lib/actions/daily-outfit";
import type { PendingWear } from "@/lib/actions/wear-confirm";
import { addStyleNote, deactivateStyleNote, type SavedNote } from "@/lib/actions/style-notes";

type Tab = "generate" | "compose" | "train";

const TAB_LABELS: Record<Tab, string> = {
  generate: "Smart Generator",
  compose: "Manual compose",
  train: "Train your stylist",
};

const TAB_BLURB: Record<Tab, string> = {
  generate:
    "Spin outfits from your rules — smart, or genuinely random. Lock a piece and it builds around it.",
  compose: "Place pieces on the frame yourself and save the look.",
  train: "Answer a few rounds, or just tell me a rule. Everything else here gets sharper.",
};

type Props = {
  items: RandomOutfitItem[];
  colorOptions: Color[];
  initialOutfits: SavedOutfit[];
  outfitSlotDefaults: OutfitSlotDefaults;
  outfitLayerOrder: string[];
  outfitVisualLayers: string[][];
  outfitComboLayouts: Record<string, { x?: number; y?: number; scale?: number }>;
  outfitLayerArrangements: Record<string, string[]>;
  outfitAutoPopulateRules: boolean;
  outfitStartupRules: CategoryRule[];
  initialContext: DailyContext;
  initialPending: PendingWear[];
  initialNotes: SavedNote[];
  temperatureUnit: TemperatureUnit;
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
  outfitAutoPopulateRules,
  outfitStartupRules,
  initialContext,
  initialPending,
  initialNotes,
  temperatureUnit,
}: Props) {
  const [tab, setTab] = useState<Tab>("generate");
  const [notes, setNotes] = useState<SavedNote[]>(initialNotes);
  const [noteBusy, startNoteTransition] = useTransition();

  /**
   * One counter, incremented by anything that teaches the model — a logged wear,
   * a training answer, a new rule. The generator watches it to re-pull the
   * affinity map it spins against. A shared nonce beats each surface polling on
   * its own timer: the model only moves when someone tells it something, and
   * these are exactly those moments.
   */
  const [signalsNonce, setSignalsNonce] = useState(0);
  const onModelChanged = useCallback(() => setSignalsNonce((n) => n + 1), []);

  const onAddRule = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      startNoteTransition(async () => {
        // No subjects: the action reads that as closet scope, so a habit like
        // "I don't wear boots with shorts" resolves against the whole wardrobe
        // rather than one outfit.
        const result = await addStyleNote(text, []);
        if (!result.ok) return;
        setNotes((prev) => [result.note, ...prev]);
        onModelChanged();
      });
    },
    [onModelChanged],
  );

  const onForgetRule = useCallback(
    (id: string) => {
      startNoteTransition(async () => {
        await deactivateStyleNote(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        onModelChanged();
      });
    },
    [onModelChanged],
  );

  const weather = useDailyWeather({ initialContext, onChanged: onModelChanged });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header>
          <h1 className="font-serif text-4xl tracking-tight">Outfits</h1>
          <p className="text-ink-muted mt-2 max-w-xl">{TAB_BLURB[tab]}</p>
        </header>
        <div className="flex gap-1 rounded-full border border-ink/10 bg-paper-warm p-1 w-fit shrink-0">
          {(["generate", "compose", "train"] as const).map((option) => (
            <TabButton key={option} active={tab === option} onClick={() => setTab(option)}>
              {TAB_LABELS[option]}
            </TabButton>
          ))}
        </div>
      </div>

      {tab === "generate" ? (
        <RandomOutfitBuilder
          items={items}
          colorOptions={colorOptions}
          initialSlotDefaults={outfitSlotDefaults}
          initialLayerOrder={outfitLayerOrder}
          initialVisualLayers={outfitVisualLayers}
          initialComboLayouts={outfitComboLayouts}
          initialLayerArrangements={outfitLayerArrangements}
          initialAutoPopulateRules={outfitAutoPopulateRules}
          initialStartupRules={outfitStartupRules}
          signalsNonce={signalsNonce}
          rulesFooter={<WeatherCard weather={weather} temperatureUnit={temperatureUnit} />}
          footer={
            <PendingWearsCard initialPending={initialPending} onConfirmed={onModelChanged} />
          }
        />
      ) : tab === "compose" ? (
        <OutfitBuilder items={items} colorOptions={colorOptions} initialOutfits={initialOutfits} />
      ) : (
        <StylistTrainer
          items={items}
          colorOptions={colorOptions}
          onLearned={onModelChanged}
          rulesPanel={
            <StyleRulesPanel
              notes={notes}
              busy={noteBusy}
              onAdd={onAddRule}
              onForget={onForgetRule}
            />
          }
        />
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
