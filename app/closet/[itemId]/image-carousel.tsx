"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl } from "@/lib/image-paths";
import { generateGhostFor } from "@/lib/actions/ghost-mannequin";

type Variant = {
  kind: "original" | "cutout" | "ghost";
  label: string;
  path: string | null;
};

type Props = {
  itemId: string;
  originalPath: string;
  cutoutPath: string | null;
  ghostPath: string | null;
  credits: number;
};

export function ImageCarousel({ itemId, originalPath, cutoutPath, ghostPath, credits }: Props) {
  const variants: Variant[] = [
    { kind: "ghost", label: "Ghost", path: ghostPath },
    { kind: "cutout", label: "Cutout", path: cutoutPath },
    { kind: "original", label: "Original", path: originalPath },
  ];
  // Default selection: best available.
  const initialActive = ghostPath ? "ghost" : cutoutPath ? "cutout" : "original";
  const [active, setActive] = useState<Variant["kind"]>(initialActive);
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const activeVariant = variants.find((v) => v.kind === active) ?? variants[2];
  const noCredits = credits < 1;

  function onGenerate() {
    setError(null);
    startGenerate(async () => {
      const res = await generateGhostFor(itemId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setActive("ghost");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl overflow-hidden aspect-square shadow-tile"
        style={
          active === "cutout"
            ? {
                backgroundImage:
                  "linear-gradient(45deg, #efe6d8 25%, transparent 25%), linear-gradient(-45deg, #efe6d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #efe6d8 75%), linear-gradient(-45deg, transparent 75%, #efe6d8 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                backgroundColor: "#faf8f5",
              }
            : { backgroundColor: "#f3ede4" }
        }
      >
        {activeVariant.path ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl(activeVariant.path)}
            alt={activeVariant.label}
            className={`w-full h-full ${active === "cutout" ? "object-contain" : "object-cover"}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-ink-muted text-center px-4">
            Not generated yet.
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {variants.map((v) => {
          const isActive = active === v.kind;
          const disabled = !v.path;
          return (
            <button
              key={v.kind}
              type="button"
              onClick={() => v.path && setActive(v.kind)}
              disabled={disabled}
              aria-pressed={isActive}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
                isActive
                  ? "border-ink bg-paper-warm"
                  : "border-ink/10 hover:border-ink/30"
              } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {v.path ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imageUrl(v.path)}
                  alt={v.label}
                  className="w-full aspect-square rounded object-cover"
                />
              ) : (
                <div className="w-full aspect-square rounded bg-paper-warm" />
              )}
              <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                {v.kind === "ghost" ? `✨ ${v.label}` : v.label}
              </span>
            </button>
          );
        })}
      </div>

      {!ghostPath && (
        <div className="rounded-xl border border-ink/10 bg-paper-warm p-3 space-y-2">
          <p className="text-xs">
            <span className="font-medium">Ghost-mannequin photo</span> not generated yet.
          </p>
          <p className="text-[11px] text-ink-muted">
            {noCredits
              ? "Out of credits — buy more in Settings."
              : `Costs 1 credit (you have ✨ ${credits}).`}
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || noCredits}
            className="rounded-full bg-ink text-paper px-4 py-1.5 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate ghost mannequin"}
          </button>
          {error && (
            <p role="alert" className="text-[11px] text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
