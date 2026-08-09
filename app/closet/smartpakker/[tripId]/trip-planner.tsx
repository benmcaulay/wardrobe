"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { thumbnailUrl } from "@/lib/image-paths";
import type { Season } from "@/lib/json";
import { formatVolume, formatWeight } from "@/lib/packing/estimate";
import { computeUsage, seasonScore, type CategoryBucket } from "@/lib/packing/plan";
import {
  completeDayCount,
  distinctOutfitCount,
  planDailyOutfits,
  rewearDayCount,
  type DayOutfit,
} from "@/lib/packing/outfits";
import {
  ACTIVITIES,
  wearMultiplier,
  type TripRequirements,
} from "@/lib/packing/requirements";
import { formatTripRange } from "@/lib/packing/trip-dates";
import type { ClimateBand, ClimateSummary } from "@/lib/services/weather";
import {
  fetchTripClimate,
  setTripClimate,
  setTripRequirements,
  parseTripDescription,
  generatePackingPlan,
  setItemPacking,
  updateTrip,
} from "../actions";

const BAND_LABELS: Record<ClimateBand, string> = {
  hot: "Hot",
  warm: "Warm",
  mild: "Mild",
  cool: "Cool",
  cold: "Cold",
};

export type PlannerBag = {
  id: string;
  name: string;
  volumeLiters: number;
  maxWeightKg: number | null;
};

export type PlannerItem = {
  id: string;
  name: string;
  imagePath: string;
  category: string;
  bucket: CategoryBucket;
  colors: { name: string; hex: string }[];
  season: Season[];
  weightGrams: number;
  volumeLiters: number;
  priceCents: number | null;
  currency: string;
  hasOverride: boolean;
};

const BUCKET_LABELS: Record<CategoryBucket, string> = {
  top: "Tops",
  bottom: "Bottoms",
  dress: "Dresses",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessory: "Accessories",
  other: "Other",
};

const BUCKET_ORDER: CategoryBucket[] = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
  "other",
];

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export type PlannerTrip = {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
};

const NONE = "__none__";

export function TripPlanner({
  trip,
  bags,
  items,
  initialClimate,
  initialRequirements,
  initialAssignments,
}: {
  trip: PlannerTrip;
  bags: PlannerBag[];
  items: PlannerItem[];
  initialClimate: ClimateSummary | null;
  initialRequirements: TripRequirements;
  initialAssignments: Record<string, string[]>;
}) {
  const router = useRouter();
  const [climate, setClimate] = useState<ClimateSummary | null>(initialClimate);
  const [requirements, setRequirements] = useState<TripRequirements>(initialRequirements);
  const [tripText, setTripText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string[]>>(initialAssignments);
  const [estimates, setEstimates] = useState<Map<string, { weightGrams: number; volumeLiters: number }>>(
    () => new Map(items.map((i) => [i.id, { weightGrams: i.weightGrams, volumeLiters: i.volumeLiters }])),
  );
  const [loadingClimate, setLoadingClimate] = useState(false);
  const [packing, setPacking] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Which bag (if any) each item currently sits in.
  const bagOfItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const [bagId, ids] of Object.entries(assignments)) {
      for (const id of ids) map.set(id, bagId);
    }
    return map;
  }, [assignments]);

  const usage = useMemo(
    () => computeUsage(assignments, bags, estimates),
    [assignments, bags, estimates],
  );

  // Persist assignment edits (debounced) so a refresh keeps the layout.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void updateTrip({ id: trip.id, assignments });
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  function moveItem(itemId: string, targetBagId: string) {
    setAssignments((prev) => {
      const next: Record<string, string[]> = {};
      for (const bag of bags) {
        next[bag.id] = (prev[bag.id] ?? []).filter((id) => id !== itemId);
      }
      if (targetBagId !== NONE && next[targetBagId]) {
        next[targetBagId] = [...next[targetBagId], itemId];
      }
      return next;
    });
  }

  async function handleFetchClimate() {
    setLoadingClimate(true);
    const res = await fetchTripClimate(trip.id);
    setLoadingClimate(false);
    if (res.ok) setClimate(res.climate);
  }

  async function handleAutoPack() {
    setPacking(true);
    setWarnings([]);
    const res = await generatePackingPlan(trip.id);
    setPacking(false);
    if (!res.ok) {
      setWarnings([res.error]);
      return;
    }
    setClimate(res.climate);
    setAssignments(res.plan.assignments);
    setWarnings(res.plan.warnings);
  }

  async function saveOverride(itemId: string, weightGrams: number | null, volumeLiters: number | null) {
    const res = await setItemPacking({ itemId, weightGrams, volumeLiters });
    if (!res.ok) return;
    // Reflect the change locally so meters update without a full reload.
    if (weightGrams != null || volumeLiters != null) {
      setEstimates((prev) => {
        const next = new Map(prev);
        const cur = next.get(itemId);
        next.set(itemId, {
          weightGrams: weightGrams ?? cur?.weightGrams ?? 0,
          volumeLiters: volumeLiters ?? cur?.volumeLiters ?? 0,
        });
        return next;
      });
    } else {
      // Cleared override — re-derive from the server heuristic.
      router.refresh();
    }
  }

  const packedIds = new Set(bagOfItem.keys());
  const unpackedAll = items.filter((i) => !packedIds.has(i.id));
  const unpacked = unpackedAll.filter((i) =>
    filter ? i.name.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  // Per-garment-type counts and total value of everything currently packed.
  const summary = useMemo(() => {
    const counts = {} as Record<CategoryBucket, number>;
    const valueByCurrency = new Map<string, number>();
    let pricedCount = 0;
    let total = 0;
    for (const item of items) {
      if (!bagOfItem.has(item.id)) continue;
      total += 1;
      counts[item.bucket] = (counts[item.bucket] ?? 0) + 1;
      if (item.priceCents != null) {
        const cur = item.currency || "USD";
        valueByCurrency.set(cur, (valueByCurrency.get(cur) ?? 0) + item.priceCents);
        pricedCount += 1;
      }
    }
    const typeRows = BUCKET_ORDER.filter((b) => (counts[b] ?? 0) > 0).map((b) => ({
      label: BUCKET_LABELS[b],
      count: counts[b],
    }));
    const valueLabel =
      valueByCurrency.size === 0
        ? null
        : [...valueByCurrency.entries()].map(([cur, cents]) => formatMoney(cents, cur)).join(" + ");
    return { typeRows, valueLabel, pricedCount, total };
  }, [items, bagOfItem]);

  // Derived from the live assignment rather than the last auto-pack, so
  // swapping a piece re-plans the week immediately. This is why lib/packing is
  // pure — the same code the server used runs here with no round trip.
  const dayPlan = useMemo(() => {
    const packed = items
      .filter((i) => bagOfItem.has(i.id))
      .map((i) => ({ id: i.id, bucket: i.bucket, colors: i.colors }));
    const cold = climate ? ["cool", "cold"].includes(climate.band) || climate.rainChance >= 0.4 : false;
    return planDailyOutfits({
      packed,
      days: climate?.days ?? 0,
      includeOuterwear: cold,
      wearMultiplier: wearMultiplier(requirements),
    });
  }, [items, bagOfItem, climate, requirements]);

  async function describeTrip() {
    const text = tripText.trim();
    if (!text) return;
    setParsing(true);
    setParseNote(null);
    const res = await parseTripDescription({ tripId: trip.id, text });
    setParsing(false);
    if (!res.ok) {
      setParseNote(res.error);
      return;
    }
    // Prefill and persist, but the chips stay editable — the parse is a
    // suggestion the user confirms, never a silent write of something they
    // didn't say.
    const next = res.parsed.requirements;
    setRequirements(next);
    setParseNote(
      res.parsed.summary +
        (res.parsed.source === "keywords" ? " (matched on keywords — check the chips.)" : ""),
    );
    await setTripRequirements({
      tripId: trip.id,
      activities: next.activities,
      laundry: next.laundry,
    });
  }

  async function toggleActivity(id: string) {
    const next = requirements.activities.includes(id as never)
      ? requirements.activities.filter((a) => a !== id)
      : [...requirements.activities, id as never];
    const optimistic = { ...requirements, activities: next };
    setRequirements(optimistic);
    const res = await setTripRequirements({ tripId: trip.id, activities: next, laundry: requirements.laundry });
    if (!res.ok) setRequirements(requirements);
  }

  async function toggleLaundry() {
    const optimistic = { ...requirements, laundry: !requirements.laundry };
    setRequirements(optimistic);
    const res = await setTripRequirements({
      tripId: trip.id,
      activities: requirements.activities,
      laundry: optimistic.laundry,
    });
    if (!res.ok) setRequirements(requirements);
  }

  return (
    <div className="space-y-8">
      <TripHeader trip={trip} onSaved={() => router.refresh()} />

      {/* Climate */}
      <section className="rounded-2xl border border-ink/10 bg-white p-5 shadow-tile">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-xl">Climate</h2>
          <button
            type="button"
            onClick={handleFetchClimate}
            disabled={loadingClimate}
            className="rounded-full border border-ink/15 px-4 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-50"
          >
            {loadingClimate ? "Checking…" : climate ? "Refresh climate" : "Check climate"}
          </button>
        </div>
        {/* When the climate is "unknown" we have no latitude and therefore no
            real numbers — showing the placeholder as a forecast is how a June
            trip to Ireland used to read "Hot, 28°C". Ask instead. */}
        {climate && climate.source === "unknown" ? (
          <ClimateUnknown
            tripId={trip.id}
            destination={trip.destination}
            onSet={(next) => setClimate(next)}
          />
        ) : climate ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
            {/* Not "Forecast" — the same row also carries past records and the
                user's own guess. The footnote below says which. */}
            <Stat label="Conditions" value={BAND_LABELS[climate.band]} />
            <Stat label="Avg high" value={`${climate.avgHighC}°C`} />
            <Stat label="Avg low" value={`${climate.avgLowC}°C`} />
            <Stat label="Rain" value={`${Math.round(climate.rainChance * 100)}%`} />
            <Stat label="Days" value={String(climate.days)} />
            <span className="text-[11px] text-ink-muted">
              {climate.source === "forecast"
                ? "Live forecast"
                : climate.source === "climatology"
                  ? "From past records"
                  : "You set this"}
            </span>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            Check the climate to tailor the packing list to the weather.
          </p>
        )}
      </section>

      {/* What the trip is for — the input that stops every trip packing alike */}
      <section className="rounded-2xl border border-ink/10 bg-white p-5 shadow-tile">
        <h2 className="font-serif text-xl">What&apos;s this trip for?</h2>
        <p className="mt-1 text-sm text-ink-muted">
          We&apos;ll make sure the bag covers it.
        </p>

        <div className="mt-3 flex flex-wrap items-start gap-2">
          <input
            value={tripText}
            onChange={(e) => setTripText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void describeTrip();
            }}
            placeholder="Or describe it: 5 days in Lisbon for a wedding, plus a beach day"
            className="min-w-0 flex-1 rounded-2xl border border-ink/15 bg-white px-3.5 py-2 text-sm placeholder:text-ink-muted/60 focus:border-ink/30"
          />
          <button
            type="button"
            onClick={() => void describeTrip()}
            disabled={parsing || !tripText.trim()}
            className="rounded-full border border-ink/25 px-4 py-2 text-xs transition hover:bg-paper-warm disabled:opacity-40"
          >
            {parsing ? "Reading…" : "Read it"}
          </button>
        </div>
        {parseNote && <p className="mt-2 text-xs text-ink-muted">{parseNote}</p>}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {ACTIVITIES.map((a) => {
            const on = requirements.activities.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => void toggleActivity(a.id)}
                aria-pressed={on}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
                  on
                    ? "border-ink bg-ink text-paper"
                    : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
                }`}
              >
                {a.label}
              </button>
            );
          })}
          <span aria-hidden className="mx-1 w-px self-stretch bg-ink/10" />
          <button
            type="button"
            onClick={() => void toggleLaundry()}
            aria-pressed={requirements.laundry}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition ${
              requirements.laundry
                ? "border-ink bg-ink text-paper"
                : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
            }`}
          >
            Laundry available
          </button>
        </div>
      </section>

      {/* Auto-pack */}
      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleAutoPack}
          disabled={packing || bags.length === 0}
          className="rounded-full bg-ink px-6 py-2.5 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
        >
          {packing ? "Packing…" : "Auto-pack my bags"}
        </button>
        <span className="text-xs text-ink-muted">
          Total packed: {formatVolume(usage.totals.volumeLiters)} · {formatWeight(usage.totals.weightGrams)} ·{" "}
          {usage.totals.count} {usage.totals.count === 1 ? "item" : "items"}
        </span>
      </section>

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      ) : null}

      {/* Day by day — the output contract that makes a bad bag obvious */}
      {dayPlan.length > 0 ? (
        <section className="rounded-2xl border border-ink/10 bg-white p-5 shadow-tile">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-xl">Day by day</h2>
            <p className="text-xs text-ink-muted">
              {completeDayCount(dayPlan)} of {dayPlan.length} days dressed
              {distinctOutfitCount(dayPlan) > 0
                ? ` · ${distinctOutfitCount(dayPlan)} distinct ${
                    distinctOutfitCount(dayPlan) === 1 ? "outfit" : "outfits"
                  }`
                : ""}
              {/* Reconciles with the packing warning's "covers N of M days",
                  which counts only days you can dress in clean clothes. */}
              {rewearDayCount(dayPlan) > 0
                ? ` · ${rewearDayCount(dayPlan)} need a re-wear`
                : ""}
            </p>
          </div>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {dayPlan.map((day) => (
              <DayCard key={day.day} day={day} itemById={itemById} startDate={trip.startDate} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Packed summary: garment-type counts + total value */}
      {summary.total > 0 ? (
        <section className="rounded-2xl border border-ink/10 bg-white p-5 shadow-tile">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-xl">Packed summary</h2>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                Total value
              </div>
              <div className="text-lg">{summary.valueLabel ?? "—"}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {summary.typeRows.map((row) => (
              <span
                key={row.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-paper-warm px-3 py-1 text-sm"
              >
                <span className="font-medium">{row.count}</span>
                <span className="text-ink-muted">{row.label}</span>
              </span>
            ))}
          </div>
          {summary.valueLabel != null && summary.pricedCount < summary.total ? (
            <p className="mt-3 text-[11px] text-ink-muted">
              Value covers {summary.pricedCount} of {summary.total} packed{" "}
              {summary.total === 1 ? "item" : "items"} with a recorded price.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Bags */}
      {bags.length === 0 ? (
        <div className="rounded-2xl bg-paper-warm p-6 text-sm text-ink-muted">
          This trip has no bags.{" "}
          <Link href="/closet/smartpakker/bags" className="text-ink underline">
            Add a bag
          </Link>{" "}
          then edit the trip to include it.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {bags.map((bag) => {
            const u = usage.perBag.find((p) => p.bagId === bag.id)!;
            return (
              <BagPanel
                key={bag.id}
                bag={bag}
                usage={u}
                items={(assignments[bag.id] ?? []).map((id) => itemById.get(id)).filter(Boolean) as PlannerItem[]}
                addableItems={unpackedAll}
                allBags={bags}
                estimates={estimates}
                climate={climate}
                onMove={moveItem}
                onSaveOverride={saveOverride}
              />
            );
          })}
        </div>
      )}

      {/* Unpacked pool */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-xl">Not packed ({unpacked.length})</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="rounded-full border border-ink/15 bg-paper px-4 py-1.5 text-xs focus:border-ink/40 focus:outline-none"
          />
        </div>
        {unpacked.length === 0 ? (
          <p className="text-sm text-ink-muted">Everything&apos;s packed.</p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {unpacked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                currentBagId={NONE}
                allBags={bags}
                estimate={estimates.get(item.id)}
                climate={climate}
                onMove={moveItem}
                onSaveOverride={saveOverride}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Preset highs, so setting the weather by hand is a tap rather than typing. */
const CLIMATE_PRESETS: { label: string; avgHighC: number }[] = [
  { label: "Hot", avgHighC: 31 },
  { label: "Warm", avgHighC: 25 },
  { label: "Mild", avgHighC: 18 },
  { label: "Cool", avgHighC: 11 },
  { label: "Cold", avgHighC: 3 },
];

/**
 * Shown when we couldn't work out the destination's weather. Deliberately does
 * not display the placeholder temperatures — the whole point of the fix is that
 * we stop presenting a guess as a forecast — and offers the two ways forward:
 * try the lookup, or say what it'll be like.
 */
function ClimateUnknown({
  tripId,
  destination,
  onSet,
}: {
  tripId: string;
  destination: string;
  onSet: (climate: ClimateSummary) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(avgHighC: number) {
    setBusy(true);
    setError(null);
    const res = await setTripClimate({ tripId, avgHighC });
    setBusy(false);
    if (res.ok) onSet(res.climate);
    else setError(res.error);
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-ink-muted">
        We don&apos;t know what the weather is like in {destination || "your destination"} for these
        dates, so the packing list is using a neutral guess. Tell us roughly what to expect:
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CLIMATE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => choose(p.avgHighC)}
            className="rounded-full border border-ink/15 bg-white px-3.5 py-1.5 text-xs transition hover:bg-paper-warm disabled:opacity-50"
          >
            {p.label}
            <span className="ml-1.5 text-ink-muted">{p.avgHighC}°C</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
    </div>
  );
}

/** One day of the trip: what you'd wear, or what's missing. */
function DayCard({
  day,
  itemById,
  startDate,
}: {
  day: DayOutfit;
  itemById: Map<string, PlannerItem>;
  startDate: string;
}) {
  const pieces = day.itemIds.map((id) => itemById.get(id)).filter((i): i is PlannerItem => !!i);
  const date = new Date(startDate);
  date.setUTCDate(date.getUTCDate() + day.day - 1);
  const label = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <li
      className={`rounded-xl border p-3 ${
        day.complete ? "border-ink/10 bg-paper" : "border-amber-300/60 bg-amber-50"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        {!day.complete ? (
          <span className="text-[11px] text-amber-900">Nothing to wear</span>
        ) : day.rewear ? (
          <span className="text-[11px] text-ink-muted">Re-wear</span>
        ) : !day.coherent ? (
          <span className="text-[11px] text-ink-muted">Bold combination</span>
        ) : null}
      </div>
      {pieces.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pieces.map((piece) => (
            <img
              key={piece.id}
              src={thumbnailUrl(piece.imagePath)}
              alt={piece.name}
              title={piece.name}
              className="h-12 w-12 rounded-lg bg-white object-contain"
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-muted">Pack a top, a bottom and shoes.</p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
      <div className="text-lg">{value}</div>
    </div>
  );
}

function TripHeader({ trip, onSaved }: { trip: PlannerTrip; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [destination, setDestination] = useState(trip.destination);
  const [startDate, setStartDate] = useState(trip.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(trip.endDate.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = formatTripRange(trip.startDate, trip.endDate);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await updateTrip({ id: trip.id, destination, startDate, endDate });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    onSaved();
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-ink/15 bg-white p-5 shadow-tile">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
              Destination
            </label>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">Leaving</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
              Returning
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
            />
          </div>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-full bg-ink px-4 py-2 text-xs tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs transition hover:bg-paper-warm"
          >
            Cancel
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Changing the destination or dates resets the climate — check it again afterwards.
        </p>
      </div>
    );
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-4xl tracking-tight">{trip.name}</h1>
        <p className="mt-1 text-ink-muted">
          {trip.destination} · {range}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-full border border-ink/15 px-4 py-1.5 text-xs transition hover:bg-paper-warm"
      >
        Edit trip
      </button>
    </header>
  );
}

function BagPanel({
  bag,
  usage,
  items,
  addableItems,
  allBags,
  estimates,
  climate,
  onMove,
  onSaveOverride,
}: {
  bag: PlannerBag;
  usage: ReturnType<typeof computeUsage>["perBag"][number];
  items: PlannerItem[];
  addableItems: PlannerItem[];
  allBags: PlannerBag[];
  estimates: Map<string, { weightGrams: number; volumeLiters: number }>;
  climate: ClimateSummary | null;
  onMove: (itemId: string, targetBagId: string) => void;
  onSaveOverride: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  const volumePct = Math.min(100, (usage.usedVolumeLiters / bag.volumeLiters) * 100);
  const weightPct =
    usage.maxWeightGrams != null
      ? Math.min(100, (usage.usedWeightGrams / usage.maxWeightGrams) * 100)
      : null;

  const pickerMatches = addableItems.filter((i) =>
    pickerSearch ? i.name.toLowerCase().includes(pickerSearch.toLowerCase()) : true,
  );

  return (
    <div className="flex flex-col rounded-2xl border border-ink/10 bg-white p-5 shadow-tile">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{bag.name}</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
          <button
            type="button"
            onClick={() => {
              setAdding((o) => !o);
              setPickerSearch("");
            }}
            className="rounded-full border border-ink/15 px-3 py-1 text-xs transition hover:bg-paper-warm"
          >
            {adding ? "Done" : "+ Add items"}
          </button>
        </div>
      </div>

      {/* Volume meter */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span>Volume</span>
          <span className={usage.overVolume ? "text-rose-700" : ""}>
            {formatVolume(usage.usedVolumeLiters)} / {formatVolume(bag.volumeLiters)}
          </span>
        </div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-paper-warm">
          <div
            className={`h-full rounded-full transition-all ${
              usage.overVolume ? "bg-rose-500" : "bg-ink"
            }`}
            style={{ width: `${volumePct}%` }}
          />
        </div>
      </div>

      {/* Weight meter (only if a cap is set) */}
      {weightPct != null ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-muted">
            <span>Weight</span>
            <span className={usage.overWeight ? "text-rose-700" : ""}>
              {formatWeight(usage.usedWeightGrams)} / {formatWeight(usage.maxWeightGrams!)}
            </span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-paper-warm">
            <div
              className={`h-full rounded-full transition-all ${
                usage.overWeight ? "bg-rose-500" : "bg-ink"
              }`}
              style={{ width: `${weightPct}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Add-items picker */}
      {adding ? (
        <div className="mt-4 rounded-xl border border-ink/15 bg-paper/60 p-3">
          <input
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            placeholder={`Search items to add to ${bag.name}…`}
            autoFocus
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs focus:border-ink/40 focus:outline-none"
          />
          {pickerMatches.length === 0 ? (
            <p className="mt-3 px-1 text-center text-xs text-ink-muted">
              {addableItems.length === 0 ? "Everything's already packed." : "No matching items."}
            </p>
          ) : (
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
              {pickerMatches.map((item) => {
                const est = estimates.get(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onMove(item.id, bag.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-paper-warm"
                    >
                      <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-paper-warm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl(item.imagePath)}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
                      <span className="text-[11px] text-ink-muted">
                        {formatVolume(est?.volumeLiters ?? item.volumeLiters)}
                      </span>
                      <span className="text-[11px] font-medium text-ink">Add</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <ul className="mt-4 space-y-2">
        {items.length === 0 ? (
          <li className="rounded-xl bg-paper-warm/60 px-3 py-6 text-center text-xs text-ink-muted">
            Empty — auto-pack or use “+ Add items” above.
          </li>
        ) : (
          items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              currentBagId={bag.id}
              allBags={allBags}
              estimate={estimates.get(item.id)}
              climate={climate}
              onMove={onMove}
              onSaveOverride={onSaveOverride}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function ItemRow({
  item,
  currentBagId,
  allBags,
  estimate,
  climate,
  onMove,
  onSaveOverride,
}: {
  item: PlannerItem;
  currentBagId: string;
  allBags: PlannerBag[];
  estimate?: { weightGrams: number; volumeLiters: number };
  climate: ClimateSummary | null;
  onMove: (itemId: string, targetBagId: string) => void;
  onSaveOverride: (itemId: string, weightGrams: number | null, volumeLiters: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const weightGrams = estimate?.weightGrams ?? item.weightGrams;
  const volumeLiters = estimate?.volumeLiters ?? item.volumeLiters;
  const [w, setW] = useState(String(weightGrams));
  const [v, setV] = useState(String(volumeLiters));

  const wrongSeason = climate ? seasonScore(item.season, climate.band) === 0 : false;

  return (
    <li className="rounded-xl border border-ink/10 bg-paper/60 p-2">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-paper-warm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnailUrl(item.imagePath)} alt={item.name} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{item.name}</div>
          <div className="flex items-center gap-2 text-[11px] text-ink-muted">
            <span>
              {formatWeight(weightGrams)} · {formatVolume(volumeLiters)}
            </span>
            {wrongSeason ? (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                off-season
              </span>
            ) : null}
          </div>
        </div>
        {currentBagId === NONE ? (
          <select
            value={NONE}
            onChange={(e) => onMove(item.id, e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
          >
            <option value={NONE}>Add to…</option>
            {allBags.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            {allBags.length > 1 ? (
              <select
                value={currentBagId}
                onChange={(e) => onMove(item.id, e.target.value)}
                className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
                title="Move to another bag"
              >
                {allBags.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              onClick={() => onMove(item.id, NONE)}
              className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] text-rose-700 transition hover:bg-rose-50"
            >
              Remove
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] text-ink-muted underline hover:text-ink"
        >
          {open ? "Close" : "Adjust"}
        </button>
      </div>

      {open ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-ink-muted">Grams</label>
            <input
              value={w}
              onChange={(e) => setW(e.target.value)}
              inputMode="numeric"
              className="mt-0.5 w-20 rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-ink-muted">Litres</label>
            <input
              value={v}
              onChange={(e) => setV(e.target.value)}
              inputMode="decimal"
              className="mt-0.5 w-20 rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs focus:border-ink/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const wn = Number(w);
              const vn = Number(v);
              onSaveOverride(
                item.id,
                Number.isFinite(wn) ? wn : null,
                Number.isFinite(vn) ? vn : null,
              );
              setOpen(false);
            }}
            className="rounded-full bg-ink px-3 py-1 text-[11px] text-paper transition hover:bg-ink-soft"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              onSaveOverride(item.id, null, null);
              setOpen(false);
            }}
            className="text-[11px] text-ink-muted underline hover:text-ink"
          >
            Reset to estimate
          </button>
        </div>
      ) : null}
    </li>
  );
}
