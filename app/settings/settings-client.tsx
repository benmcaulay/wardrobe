"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditMark } from "@/components/credit-mark";
import { ReorderableStringList } from "@/components/reorderable-string-list";
import { ReorderableColorList } from "@/components/reorderable-color-list";
import { StylePrefsEditor } from "@/components/style-prefs-editor";
import { updateStylePrefs, setAutoGenerateGhost } from "@/lib/actions/preferences";
import {
  addWardrobeCategory,
  removeWardrobeCategory,
  renameWardrobeCategory,
  reorderWardrobeCategories,
} from "@/lib/actions/wardrobeCategories";
import {
  addWardrobeStyleTag,
  removeWardrobeStyleTag,
  reorderWardrobeStyleTags,
} from "@/lib/actions/wardrobeStyleTags";
import {
  addWardrobeColor,
  removeWardrobeColor,
  reorderWardrobeColors,
} from "@/lib/actions/wardrobeColors";
import { clearAllData } from "@/lib/actions/account";
import { createCreditCheckout } from "@/lib/actions/billing";
import { CREDIT_PACKS, formatPackPrice } from "@/lib/credit-packs";
import { normalizeCategoryName } from "@/lib/categories";
import type { Color, StylePrefs } from "@/lib/json";

type EyeDropperResult = { sRGBHex: string };
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> };

type Props = {
  initialPrefs: StylePrefs;
  categoryList: string[];
  styleTagsList: string[];
  colorList: Color[];
  credits: number;
  autoGenerateGhost: boolean;
  purchasesEnabled: boolean;
};

/** Typed to arm the irreversible "Clear all data" action. */
const DELETE_CONFIRM_PHRASE = "delete my wardrobe";

export function SettingsClient({
  initialPrefs,
  categoryList,
  styleTagsList,
  colorList,
  credits,
  autoGenerateGhost,
  purchasesEnabled,
}: Props) {
  const [prefs, setPrefs] = useState<StylePrefs>(initialPrefs);
  const [newCategory, setNewCategory] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newColorHex, setNewColorHex] = useState("#4a6fb0");
  const [newColorName, setNewColorName] = useState("");
  const [autoGen, setAutoGen] = useState(autoGenerateGhost);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(categoryList);
  const [localTags, setLocalTags] = useState(styleTagsList);
  const [localColors, setLocalColors] = useState(colorList);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [, startCat] = useTransition();
  const [clearing, startClear] = useTransition();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [restore, setRestore] = useState<{
    status: "idle" | "uploading" | "done" | "error";
    message?: string;
  }>({ status: "idle" });
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function onBuyPack(packId: string) {
    setBuyError(null);
    setBuyingPackId(packId);
    try {
      const res = await createCreditCheckout(packId);
      if (!res.ok) {
        setBuyError(res.error);
        return;
      }
      window.location.assign(res.url);
    } catch {
      setBuyError("Could not start checkout. Please try again.");
    } finally {
      setBuyingPackId(null);
    }
  }

  async function handleRestore(file: File) {
    setRestore({ status: "uploading" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/backup/wardrobe/restore", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; imported: number; skipped: number }
        | { ok: false; error: string };
      if (!data.ok) {
        setRestore({ status: "error", message: data.error });
        return;
      }
      const parts = [`Imported ${data.imported} item${data.imported === 1 ? "" : "s"}`];
      if (data.skipped) parts.push(`${data.skipped} already present`);
      setRestore({ status: "done", message: `${parts.join(", ")}.` });
      router.refresh();
    } catch (err) {
      setRestore({ status: "error", message: (err as Error).message });
    }
  }

  useEffect(() => {
    setLocalCategories(categoryList);
  }, [categoryList]);

  useEffect(() => {
    setLocalTags(styleTagsList);
  }, [styleTagsList]);

  useEffect(() => {
    setLocalColors(colorList);
  }, [colorList]);

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

  const deleteConfirmed =
    deleteConfirm.trim().toLowerCase() === DELETE_CONFIRM_PHRASE;

  function onClear() {
    // Guard against accidental submits (e.g. Enter key) when the typed
    // confirmation phrase doesn't match exactly.
    if (!deleteConfirmed) return;
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

  function handleRenameCategory(oldName: string, newName: string) {
    setCatError(null);
    startCat(async () => {
      const res = await renameWardrobeCategory(oldName, newName);
      if (!res.ok) {
        setCatError(res.error);
        router.refresh();
        return;
      }
      setLocalCategories((prev) =>
        prev.map((c) => (c === oldName ? normalizeCategoryName(newName) : c)),
      );
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

  async function pickColorWithDropper() {
    const Ctor = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!Ctor) {
      colorInputRef.current?.click();
      return;
    }
    try {
      const { sRGBHex } = await new Ctor().open();
      setNewColorHex(sRGBHex);
    } catch {
      // user cancelled the dropper
    }
  }

  function handleAddColor() {
    setColorError(null);
    startCat(async () => {
      const res = await addWardrobeColor(newColorHex, newColorName);
      if (!res.ok) {
        setColorError(res.error);
        return;
      }
      setNewColorName("");
      router.refresh();
    });
  }

  function handleDeleteColor(color: Color) {
    if (!confirm(`Remove “${color.name}” from your color palette?\nItems already tagged with it keep the color until you edit them.`))
      return;
    setColorError(null);
    startCat(async () => {
      const res = await removeWardrobeColor(color.name);
      if (!res.ok) {
        setColorError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleReorderColors(next: Color[]) {
    setLocalColors(next);
    setColorError(null);
    startCat(async () => {
      const res = await reorderWardrobeColors(next);
      if (!res.ok) {
        setColorError(res.error);
        router.refresh();
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
        </div>
        {purchasesEnabled ? (
          <div className="pt-2 border-t border-ink/10">
            <p className="text-xs text-ink-muted mb-2">Buy more credits</p>
            {buyError && <p className="text-xs text-rose-600 mb-2">{buyError}</p>}
            <div className="flex flex-wrap gap-2">
              {CREDIT_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  disabled={buyingPackId !== null}
                  onClick={() => onBuyPack(pack.id)}
                  className="rounded-full bg-ink text-paper px-4 py-2 text-xs tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
                >
                  {buyingPackId === pack.id
                    ? "Opening checkout…"
                    : `${pack.label} · ${pack.credits} cr · ${formatPackPrice(pack)}`}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-muted pt-2 border-t border-ink/10">
            Credit purchases aren&apos;t enabled on this deployment.
          </p>
        )}
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
          Categories are saved when you add, remove, rename (click a name), or reorder (drag the ⋮⋮
          handle). Removing a category sets affected items to <span className="text-ink">None</span>.
          Renaming updates all items in that category.
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
          onRename={handleRenameCategory}
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

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Wardrobe colors</h3>
        <p className="text-sm text-ink-muted">
          The palette shown when tagging pieces. Drag the ⋮⋮ handle to set the order used for the{" "}
          <span className="text-ink">Color</span> sort in your closet. Pick a swatch or use the
          eyedropper to sample any color on screen, name it, then add it.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={colorInputRef}
            type="color"
            value={newColorHex}
            onChange={(e) => setNewColorHex(e.target.value)}
            aria-label="Pick a color"
            className="h-9 w-12 shrink-0 rounded-lg border border-ink/10 bg-white p-0.5 cursor-pointer"
          />
          <button
            type="button"
            onClick={pickColorWithDropper}
            title="Sample a color from anywhere on screen"
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-2 text-xs hover:bg-paper-warm transition"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 5.5a2.1 2.1 0 0 0-3-3l-2.6 2.6-1-1-1.6 1.6 6 6 1.6-1.6-1-1L19 5.5z" />
              <path d="M12.5 7.4 4.7 15.2a2 2 0 0 0-.55 1.06L3.5 19.5a.6.6 0 0 0 .7.7l3.24-.65a2 2 0 0 0 1.06-.55l7.8-7.8" />
            </svg>
            Eyedropper
          </button>
          <input
            type="text"
            value={newColorName}
            onChange={(e) => setNewColorName(e.target.value)}
            placeholder="name (e.g. sage)"
            className="flex-1 min-w-[8rem] rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddColor();
              }
            }}
          />
          <button
            type="button"
            onClick={handleAddColor}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs hover:bg-paper-warm transition"
          >
            Add
          </button>
        </div>
        {colorError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {colorError}
          </p>
        )}
        <ReorderableColorList
          items={localColors}
          onReorder={handleReorderColors}
          onRemove={handleDeleteColor}
          removeDisabled={() => localColors.length <= 1}
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

        <div className="space-y-2 border-t border-ink/10 pt-3">
          <p className="text-sm text-ink-muted max-w-xl">
            Restore from a wardrobe backup .zip. Items are added to this account with their photos;
            pieces already imported (same name and date) are skipped, so re-importing is safe.
          </p>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleRestore(f);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              disabled={restore.status === "uploading"}
              className="inline-flex rounded-full border border-ink/15 px-5 py-2 text-sm tracking-wide hover:bg-paper-warm transition disabled:opacity-50"
            >
              {restore.status === "uploading" ? "Importing…" : "Import wardrobe backup…"}
            </button>
            {restore.status === "done" && (
              <span className="text-xs text-ink-muted">{restore.message}</span>
            )}
            {restore.status === "error" && (
              <span className="text-xs text-red-700">{restore.message}</span>
            )}
          </div>
        </div>
      </section>

      <section className="pt-10 border-t border-ink/10 space-y-3">
        <h2 className="font-serif text-xl tracking-tight">Danger zone</h2>
        <p className="text-ink-muted text-sm max-w-xl">
          Clears the local database and deletes every uploaded photo for this account. Useful for
          restarting the demo with a blank slate. This cannot be undone.
        </p>
        <div className="max-w-md space-y-2 rounded-2xl border border-red-200 bg-red-50/40 p-4">
          <label htmlFor="delete-confirm" className="block text-sm text-red-800">
            To confirm, type{" "}
            <span className="font-semibold select-none">{DELETE_CONFIRM_PHRASE}</span>{" "}
            below.
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={DELETE_CONFIRM_PHRASE}
            aria-label={`Type "${DELETE_CONFIRM_PHRASE}" to confirm deletion`}
            className="w-full rounded-full border border-red-200 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <button
            type="button"
            onClick={onClear}
            disabled={clearing || !deleteConfirmed}
            className="rounded-full border border-red-300 bg-red-600 text-white px-5 py-2 text-sm tracking-wide hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-red-600"
          >
            {clearing ? "Clearing…" : "Delete everything"}
          </button>
        </div>
      </section>
    </div>
  );
}
