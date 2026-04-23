"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { thumbnailUrl } from "@/lib/image-paths";
import { createOutfit, updateOutfit, deleteOutfit } from "@/lib/actions/outfits";

export type BuilderItem = {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  originalImagePath: string;
};

type Props =
  | {
      mode: "create";
      items: BuilderItem[];
      initialName?: string;
      initialSelectedItemIds?: string[];
    }
  | {
      mode: "edit";
      outfitId: string;
      items: BuilderItem[];
      initialName: string;
      initialSelectedItemIds: string[];
    };

export function OutfitBuilder(props: Props) {
  const [name, setName] = useState(props.initialName ?? "");
  const [selected, setSelected] = useState<string[]>(props.initialSelectedItemIds ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startDelete] = useTransition();
  const router = useRouter();

  const itemsById = useMemo(() => new Map(props.items.map((i) => [i.id, i])), [props.items]);
  const canSubmit = name.trim().length > 0 && selected.length > 0 && !submitting;

  function toggleItem(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res =
      props.mode === "create"
        ? await createOutfit({ name, itemIds: selected })
        : await updateOutfit({ outfitId: props.outfitId, name, itemIds: selected });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push("/outfits");
    router.refresh();
  }

  async function onDelete() {
    if (props.mode !== "edit") return;
    if (!confirm("Delete this outfit? This can't be undone.")) return;
    startDelete(async () => {
      await deleteOutfit(props.outfitId);
      router.push("/outfits");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-8 items-start">
      <section className="space-y-6">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-ink-muted">Outfit name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            placeholder="Saturday brunch"
            className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 disabled:bg-paper-warm"
            required
          />
        </label>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-ink-muted mb-3">
            Items ({props.items.length})
          </h3>
          {props.items.length === 0 ? (
            <p className="text-ink-muted text-sm">Your closet is empty — add pieces first.</p>
          ) : (
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {props.items.map((it) => {
                const active = selected.includes(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => toggleItem(it.id)}
                      aria-pressed={active}
                      className={`relative block w-full rounded-xl overflow-hidden aspect-square shadow-tile transition ${
                        active ? "ring-2 ring-accent" : "ring-1 ring-transparent hover:ring-ink/15"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnailUrl(it.originalImagePath)}
                        alt={it.name}
                        className="w-full h-full object-cover"
                      />
                      <span
                        className={`absolute top-2 right-2 w-6 h-6 rounded-full text-xs flex items-center justify-center transition ${
                          active
                            ? "bg-accent text-white"
                            : "bg-white/90 text-ink border border-ink/10"
                        }`}
                        aria-hidden
                      >
                        {active ? "✓" : "+"}
                      </span>
                    </button>
                    <p className="mt-1 text-[11px] truncate">{it.name}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <aside className="lg:sticky lg:top-6 space-y-4 rounded-2xl bg-paper-warm p-5">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">
          In this outfit ({selected.length})
        </h3>
        {selected.length === 0 ? (
          <p className="text-sm text-ink-muted">Tap items on the left to add them.</p>
        ) : (
          <ul className="space-y-2">
            {selected.map((id) => {
              const it = itemsById.get(id);
              if (!it) return null;
              return (
                <li key={id} className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl(it.originalImagePath)}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{it.name}</p>
                    <p className="text-[11px] text-ink-muted truncate">{it.brand ?? it.category}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleItem(id)}
                    aria-label={`Remove ${it.name}`}
                    className="text-ink-muted hover:text-ink text-lg leading-none"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-full bg-ink text-paper px-6 py-2.5 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
        >
          {submitting ? "Saving…" : props.mode === "create" ? "Save outfit" : "Save changes"}
        </button>

        {props.mode === "edit" && (
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-full border border-red-200 text-red-700 px-4 py-2 text-xs tracking-wide hover:bg-red-50 transition"
          >
            Delete outfit
          </button>
        )}
      </aside>
    </form>
  );
}
