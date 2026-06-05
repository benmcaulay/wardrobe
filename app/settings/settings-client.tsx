"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditMark } from "@/components/credit-mark";
import { ReorderableStringList } from "@/components/reorderable-string-list";
import { StylePrefsEditor } from "@/components/style-prefs-editor";
import { updateStylePrefs, setAutoGenerateGhost } from "@/lib/actions/preferences";
import {
  addWardrobeCategory,
  removeWardrobeCategory,
  reorderWardrobeCategories,
} from "@/lib/actions/wardrobeCategories";
import {
  addWardrobeStyleTag,
  removeWardrobeStyleTag,
  reorderWardrobeStyleTags,
} from "@/lib/actions/wardrobeStyleTags";
import { clearAllData } from "@/lib/actions/account";
import type { StylePrefs } from "@/lib/json";

type Props = {
  initialPrefs: StylePrefs;
  categoryList: string[];
  styleTagsList: string[];
  credits: number;
  autoGenerateGhost: boolean;
};

export function SettingsClient({
  initialPrefs,
  categoryList,
  styleTagsList,
  credits,
  autoGenerateGhost,
}: Props) {
  const [prefs, setPrefs] = useState<StylePrefs>(initialPrefs);
  const [newCategory, setNewCategory] = useState("");
  const [newTag, setNewTag] = useState("");
  const [autoGen, setAutoGen] = useState(autoGenerateGhost);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(categoryList);
  const [localTags, setLocalTags] = useState(styleTagsList);
  const [, startCat] = useTransition();
  const [clearing, startClear] = useTransition();
  const router = useRouter();

  useEffect(() => {
    setLocalCategories(categoryList);
  }, [categoryList]);

  useEffect(() => {
    setLocalTags(styleTagsList);
  }, [styleTagsList]);

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
    if (
      !confirm("Delete every item, photo, and preference for this account? This can't be undone.")
    )
      return;
    startClear(async () => {
      await clearAllData();
    });
  }

  function handleAddCategory() {
    setCatError(null);
    startCat(async () => {
      const res = await addWardrobeCategory(newCategory);
      if (!res.ok) {
        setCatError(res.error);
        return;
      }
      setNewCategory("");
      router.refresh();
    });
  }

  function handleDeleteCategory(name: string) {
    if (
      !confirm(
        `Remove “${name}” from your category list?\nItems in this category will be set to None.`,
      )
    )
      return;
    setCatError(null);
    startCat(async () => {
      const res = await removeWardrobeCategory(name);
      if (!res.ok) {
        setCatError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleReorderCategories(next: string[]) {
    setLocalCategories(next);
    setCatError(null);
    startCat(async () => {
      const res = await reorderWardrobeCategories(next);
      if (!res.ok) {
        setCatError(res.error);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  function handleReorderTags(next: string[]) {
    setLocalTags(next);
    setTagError(null);
    startCat(async () => {
      const res = await reorderWardrobeStyleTags(next);
      if (!res.ok) {
        setTagError(res.error);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  function handleAddTag() {
    setTagError(null);
    startCat(async () => {
      const res = await addWardrobeStyleTag(newTag);
      if (!res.ok) {
        setTagError(res.error);
        return;
      }
      setNewTag("");
      router.refresh();
    });
  }

  function handleDeleteTag(name: string) {
    if (!confirm(`Remove “${name}” from your style tag list?\nItems that use it keep the tag until you edit them.`))
      return;
    setTagError(null);
    startCat(async () => {
      const res = await removeWardrobeStyleTag(name);
      if (!res.ok) {
        setTagError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-paper-warm p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h3 className="font-serif text-2xl tracking-tight flex items-center gap-2">
              <CreditMark className="h-7 w-7 shrink-0" title="Credits" />
              <span>
                {credits} {credits === 1 ? "credit" : "credits"}
              </span>
            </h3>
            <p className="text-xs text-ink-muted mt-1">
              1 credit = 1 ghost-mannequin generation (~$0.02 with the real provider).
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
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Style preferences</h3>
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

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Wardrobe categories</h3>
        <p className="text-sm text-ink-muted">
          Categories are saved when you add, remove, or reorder (drag the ⋮⋮ handle). Removing a
          category sets affected items to <span className="text-ink">None</span>.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="e.g. hats"
            className="flex-1 rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCategory();
              }
            }}
          />
          <button
            type="button"
            onClick={handleAddCategory}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs hover:bg-paper-warm transition"
          >
            Add
          </button>
        </div>
        {catError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {catError}
          </p>
        )}
        <ReorderableStringList
          items={localCategories}
          onReorder={handleReorderCategories}
          onRemove={handleDeleteCategory}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Style tags</h3>
        <p className="text-sm text-ink-muted">
          Tags shown as chips when adding or editing pieces. Saved when you add, remove, or reorder
          (drag the ⋮⋮ handle). You must keep at least one tag in the list.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="e.g. athleisure"
            className="flex-1 rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTag();
              }
            }}
          />
          <button
            type="button"
            onClick={handleAddTag}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs hover:bg-paper-warm transition"
          >
            Add
          </button>
        </div>
        {tagError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {tagError}
          </p>
        )}
        <ReorderableStringList
          items={localTags}
          onReorder={handleReorderTags}
          onRemove={handleDeleteTag}
          removeDisabled={() => localTags.length <= 1}
          labelClassName="capitalize"
        />
      </section>

      <section className="rounded-2xl border border-ink/10 bg-white p-5 space-y-3">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Local backup</h3>
        <p className="text-sm text-ink-muted max-w-xl">
          Download a ZIP of every closet photo for this account (originals, thumbnails, extra shots,
          ghost views, and transparent cutouts when they exist), plus a{" "}
          <code className="text-xs bg-paper-warm px-1 rounded">manifest.json</code> listing names and
          categories. Virtual try-on outputs and person photos are not included.
        </p>
        <a
          href="/api/backup/wardrobe"
          className="inline-flex rounded-full bg-ink text-paper px-5 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
        >
          Download wardrobe backup (.zip)
        </a>
      </section>

      <section className="pt-10 border-t border-ink/10 space-y-3">
        <h2 className="font-serif text-xl tracking-tight">Danger zone</h2>
        <p className="text-ink-muted text-sm max-w-xl">
          Clears the local database and deletes every uploaded photo for this account. Useful for
          restarting the demo with a blank slate.
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
