"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOutfit } from "@/lib/actions/outfits";

export function DeleteOutfitButton({ outfitId, name }: { outfitId: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(`Delete the outfit "${name}"? This can't be undone.`)) return;
    start(async () => {
      await deleteOutfit(outfitId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-full border border-red-200 text-red-700 px-3 py-1.5 text-xs tracking-wide hover:bg-red-50 transition disabled:opacity-50 ml-auto"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
