"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatVolume } from "@/lib/packing/estimate";
import { formatTripRange } from "@/lib/packing/trip-dates";
import { createTrip, deleteTrip } from "./actions";

export type BagOption = { id: string; name: string; volumeLiters: number };

export type TripView = {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  bagCount: number;
  packedCount: number;
};

function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function HubClient({
  bags,
  trips: initialTrips,
}: {
  bags: BagOption[];
  trips: TripView[];
}) {
  const router = useRouter();
  const [trips, setTrips] = useState<TripView[]>(initialTrips);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState(isoToday());
  const [endDate, setEndDate] = useState(isoToday(7));
  const [selectedBags, setSelectedBags] = useState<string[]>(bags.map((b) => b.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleBag(id: string) {
    setSelectedBags((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await createTrip({
      name: name.trim() || destination.trim() || "Trip",
      destination,
      startDate,
      endDate,
      bagIds: selectedBags,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/closet/smartpakker/${res.id}`);
  }

  return (
    <div className="space-y-12">
      <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-tile">
        <h2 className="font-serif text-2xl">Plan a trip</h2>
        <p className="mt-1 text-sm text-ink-muted">
          We&apos;ll check the climate at your destination and pack your bags from your closet.
        </p>

        {bags.length === 0 ? (
          <div className="mt-5 rounded-xl bg-paper-warm p-4 text-sm text-ink-muted">
            First,{" "}
            <Link href="/closet/smartpakker/bags" className="text-ink underline">
              add a bag
            </Link>{" "}
            to pack into.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                Destination
              </label>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Lisbon, Portugal"
                className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                Leaving
              </label>
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
            <div className="sm:col-span-2">
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                Trip name (optional)
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Summer in Portugal"
                className="mt-1 w-full rounded-xl border border-ink/15 bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] uppercase tracking-wide text-ink-muted">
                Bags to pack
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {bags.map((bag) => {
                  const on = selectedBags.includes(bag.id);
                  return (
                    <button
                      key={bag.id}
                      type="button"
                      onClick={() => toggleBag(bag.id)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        on
                          ? "border-ink bg-ink text-paper"
                          : "border-ink/15 bg-white text-ink hover:bg-paper-warm"
                      }`}
                    >
                      {bag.name} · {formatVolume(bag.volumeLiters)}
                    </button>
                  );
                })}
              </div>
            </div>

            {error ? <p className="text-xs text-rose-700 sm:col-span-2">{error}</p> : null}

            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="rounded-full bg-ink px-6 py-2.5 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
              >
                {busy ? "Creating…" : "Start packing"}
              </button>
            </div>
          </div>
        )}
      </section>

      {trips.length > 0 ? (
        <section>
          <h2 className="mb-4 font-serif text-2xl">Your trips</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <li key={trip.id} className="group relative">
                <Link
                  href={`/closet/smartpakker/${trip.id}`}
                  className="block rounded-2xl border border-ink/10 bg-white p-5 shadow-tile transition hover:border-ink/25"
                >
                  <div className="font-serif text-xl">{trip.name}</div>
                  <div className="mt-1 text-sm text-ink-muted">{trip.destination}</div>
                  <div className="mt-3 text-xs text-ink-muted">
                    {formatTripRange(trip.startDate, trip.endDate)}
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {trip.bagCount} {trip.bagCount === 1 ? "bag" : "bags"}
                    {trip.packedCount > 0 ? ` · ${trip.packedCount} packed` : ""}
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await deleteTrip(trip.id);
                    if (res.ok) setTrips((prev) => prev.filter((t) => t.id !== trip.id));
                  }}
                  className="absolute right-3 top-3 rounded-full bg-white/80 px-2 py-1 text-[10px] text-rose-700 opacity-0 transition hover:bg-rose-50 group-hover:opacity-100"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
