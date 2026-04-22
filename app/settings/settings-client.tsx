"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StylePrefsEditor } from "@/components/style-prefs-editor";
import { updateStylePrefs } from "@/lib/actions/preferences";
import { clearAllData } from "@/lib/actions/account";
import type { StylePrefs } from "@/lib/json";

type Props = {
  initialPrefs: StylePrefs;
};

export function SettingsClient({ initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<StylePrefs>(initialPrefs);
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

  function onClear() {
    if (!confirm("Delete every item, outfit, photo and preference for this account? This can't be undone.")) return;
    startClear(async () => {
      await clearAllData();
    });
  }

  return (
    <div className="space-y-10">
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
