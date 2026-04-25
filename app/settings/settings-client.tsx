"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StylePrefsEditor } from "@/components/style-prefs-editor";
import { updateStylePrefs, setAutoGenerateGhost } from "@/lib/actions/preferences";
import { clearAllData } from "@/lib/actions/account";
import type { StylePrefs } from "@/lib/json";

type Props = {
  initialPrefs: StylePrefs;
  credits: number;
  autoGenerateGhost: boolean;
};

export function SettingsClient({ initialPrefs, credits, autoGenerateGhost }: Props) {
  const [prefs, setPrefs] = useState<StylePrefs>(initialPrefs);
  const [autoGen, setAutoGen] = useState(autoGenerateGhost);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [clearing, startClear] = useTransition();
  const router = useRouter();

  const dirty = JSON.stringify(prefs) !== JSON.stringify(initialPrefs);

  async function onSave() {
    setSaving(true);
    await updateStylePrefs(prefs);
    setSaving(false);
    setSavedAt(Date.now());
    router.refresh();
  }

  async function onToggleAuto(next: boolean) {
    setAutoGen(next);
    await setAutoGenerateGhost(next);
    router.refresh();
  }

  function onClear() {
    if (!confirm("Delete every item, photo, and preference for this account? This can't be undone.")) return;
    startClear(async () => {
      await clearAllData();
    });
  }

  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-paper-warm p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h3 className="font-serif text-2xl tracking-tight">
              ✨ {credits} {credits === 1 ? "credit" : "credits"}
            </h3>
            <p className="text-xs text-ink-muted mt-1">
              1 credit = 1 ghost-mannequin generation (~$0.02 with the real
              provider).
            </p>
          </div>
          <button
            type="button"
            onClick={() => alert("Credit purchase isn't wired up in the demo.")}
            className="rounded-full bg-ink text-paper px-4 py-2 text-xs tracking-wide hover:bg-ink-soft transition"
          >
            Buy more credits
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm pt-2 border-t border-ink/10">
          <input
            type="checkbox"
            checked={autoGen}
            onChange={(e) => onToggleAuto(e.target.checked)}
            className="accent-ink"
          />
          Auto-generate ghost mannequin on upload
        </label>
      </section>

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">
          Style preferences
        </h3>
        <StylePrefsEditor value={prefs} onChange={setPrefs} disabled={saving} />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
            className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save preferences"}
          </button>
          {!dirty && savedAt && <span className="text-xs text-ink-muted">Saved</span>}
        </div>
      </section>

      <section className="pt-10 border-t border-ink/10 space-y-3">
        <h2 className="font-serif text-xl tracking-tight">Danger zone</h2>
        <p className="text-ink-muted text-sm max-w-xl">
          Clears the local database and deletes every uploaded photo for this
          account. Useful for restarting the demo with a blank slate.
        </p>
        <button
          type="button"
          onClick={onClear}
          disabled={clearing}
          className="rounded-full border border-red-200 text-red-700 px-5 py-2 text-sm tracking-wide hover:bg-red-50 transition disabled:opacity-50"
        >
          {clearing ? "Clearing…" : "Clear all data"}
        </button>
      </section>
    </div>
  );
}
