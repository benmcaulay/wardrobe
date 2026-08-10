"use client";

/**
 * "Did you wear these?" — ratifying wears the photo scan only guessed at.
 *
 * Kept when the daily picks came out, because it does a different job: the picks
 * proposed an outfit, this confirms one that already happened. Confirming turns a
 * low-confidence guess into a real WearEvent with an occasion attached, which is
 * what the dormancy and recurrence models read. Renders nothing when there is
 * nothing to confirm, so it costs the page no space on an ordinary day.
 */

import { useState, useTransition } from "react";
import { imageUrl } from "@/lib/image-paths";
import { OCCASIONS, OCCASION_LABELS, type Occasion } from "@/lib/wear/occasions";
import {
  confirmPendingWear,
  rejectPendingWear,
  type PendingWear,
} from "@/lib/actions/wear-confirm";

export function PendingWearsCard({
  initialPending,
  onConfirmed,
}: {
  initialPending: PendingWear[];
  onConfirmed: () => void;
}) {
  const [pending, setPending] = useState(initialPending);
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  function onConfirm(id: string, occasion: Occasion) {
    startTransition(async () => {
      await confirmPendingWear(id, occasion);
      setPending((prev) => prev.filter((p) => p.id !== id));
      onConfirmed();
    });
  }

  function onReject(id: string) {
    startTransition(async () => {
      await rejectPendingWear(id);
      setPending((prev) => prev.filter((p) => p.id !== id));
    });
  }

  if (pending.length === 0) return null;

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink">Did you wear these?</h2>
      <p className="mt-1 text-xs text-ink-muted">
        Spotted in your photos. Confirming turns a guess into a real record.
      </p>
      <ul className="mt-3 space-y-3">
        {pending.map((wear) => (
          <li key={wear.id} className="rounded-xl border border-ink/10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-muted">{wear.wornOnISO}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onReject(wear.id)}
                className="text-[11px] text-ink-muted underline disabled:opacity-50"
              >
                Not me
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {wear.items.map((item) => (
                <li key={item.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(item.imagePath)}
                    alt={item.name}
                    className="h-12 w-12 rounded-lg border border-ink/10 bg-paper object-cover"
                  />
                </li>
              ))}
            </ul>
            {open === wear.id ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OCCASIONS.map((occasion) => (
                  <button
                    key={occasion}
                    type="button"
                    disabled={busy}
                    onClick={() => onConfirm(wear.id, occasion)}
                    className="rounded-full border border-ink/15 px-2.5 py-0.5 text-[11px] transition hover:bg-paper-warm disabled:opacity-50"
                  >
                    {OCCASION_LABELS[occasion]}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(wear.id)}
                className="mt-2 rounded-full border border-ink bg-ink px-3 py-1 text-[11px] text-paper disabled:opacity-50"
              >
                Yes — what for?
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}