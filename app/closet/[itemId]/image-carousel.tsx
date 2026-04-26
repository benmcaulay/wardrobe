"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { imageUrl } from "@/lib/image-paths";
import { generateGhostFor } from "@/lib/actions/ghost-mannequin";

type VariantKind = "original" | "ghost";

type Props = {
  itemId: string;
  originalPath: string;
  ghostPath: string | null;
  credits: number;
};

export function ImageCarousel({ itemId, originalPath, ghostPath, credits }: Props) {
  const initialActive: VariantKind = ghostPath ? "ghost" : "original";
  const [active, setActive] = useState<VariantKind>(initialActive);
  const [generating, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const activePath = active === "ghost" ? ghostPath : originalPath;
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
      <div className="rounded-2xl overflow-hidden aspect-square shadow-tile bg-paper-warm">
        {activePath ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl(activePath)}
            alt={active}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-ink-muted text-center px-4">
            Not generated yet.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tab
          label="Original"
          path={originalPath}
          active={active === "original"}
          onClick={() => setActive("original")}
        />
        <Tab
          label="✨ Ghost"
          path={ghostPath}
          active={active === "ghost"}
          onClick={() => ghostPath && setActive("ghost")}
        />
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

function Tab({
  label,
  path,
  active,
  onClick,
}: {
  label: string;
  path: string | null;
  active: boolean;
  onClick: () => void;
}) {
  const disabled = !path;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
        active ? "border-ink bg-paper-warm" : "border-ink/10 hover:border-ink/30"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {path ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={imageUrl(path)}
          alt={label}
          className="w-full aspect-square rounded object-cover"
        />
      ) : (
        <div className="w-full aspect-square rounded bg-paper-warm" />
      )}
      <span className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
    </button>
  );
}
