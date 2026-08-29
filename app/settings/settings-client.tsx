"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditMark } from "@/components/credit-mark";
import { ReorderableStringList } from "@/components/reorderable-string-list";
import { ReorderableColorList } from "@/components/reorderable-color-list";
import { StylePrefsEditor } from "@/components/style-prefs-editor";
import {
  updateStylePrefs,
  setAutoGenerateGhost,
  setHiddenClosetFilters,
  setTemperatureUnit,
} from "@/lib/actions/preferences";
import {
  TEMPERATURE_UNIT_LABELS,
  formatTemperature,
  readTemperatureUnit,
  type TemperatureUnit,
} from "@/lib/temperature";
import {
  CLOSET_FILTER_KEYS,
  CLOSET_FILTER_LABELS,
  getHiddenFiltersFromPrefs,
  toggleHiddenFilter,
  type ClosetFilterKey,
} from "@/lib/closet-filter-visibility";
import {
  addWardrobeCategory,
  moveWardrobeCategory,
  removeWardrobeCategory,
  renameWardrobeCategory,
  setCategoryShape,
} from "@/lib/actions/wardrobeCategories";
import { CategoryTreeEditor } from "@/components/category-tree-editor";
import type { CategoryDropMode, CategoryParents } from "@/lib/category-tree";
import {
  addWardrobeStyleTag,
  removeWardrobeStyleTag,
  reorderWardrobeStyleTags,
} from "@/lib/actions/wardrobeStyleTags";
import {
  addWardrobeColor,
  setFavoriteColor,
  removeWardrobeColor,
  reorderWardrobeColors,
} from "@/lib/actions/wardrobeColors";
import {
  addWardrobeOwner,
  removeWardrobeOwner,
  renameWardrobeOwner,
  reorderWardrobeOwners,
} from "@/lib/actions/wardrobeOwners";
import { clearAllData } from "@/lib/actions/account";
import { createCreditCheckout } from "@/lib/actions/billing";
import { CREDIT_PACKS, formatPackPrice } from "@/lib/credit-packs";
import {
  categoriesNeedingShape,
  normalizeCategoryName,
  type GarmentKind,
} from "@/lib/categories";
import { getFavoriteColorNames, toggleFavoriteColor } from "@/lib/colors";
import type { GarmentKindChoice } from "@/lib/json";
import type { Color, Owner, StylePrefs } from "@/lib/json";

type EyeDropperResult = { sRGBHex: string };
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> };

type Props = {
  initialPrefs: StylePrefs;
  categoryList: string[];
  /** Category nesting — normalised child → parent. See lib/category-tree.ts. */
  categoryParents: CategoryParents;
  categoryShapes: Record<string, string>;
  styleTagsList: string[];
  ownersList: Owner[];
  colorList: Color[];
  credits: number;
  spend: {
    /** Formatted total, e.g. "$1.34". */
    total: string;
    generations: number;
    billedGenerations: number;
    byModel: Array<{ model: string; generations: number; cost: string }>;
  };
  /**
   * Product searches. Separate from `spend` because it is a different provider
   * on a different unit — SerpAPI bills per search, not per generated image —
   * and folding the two into one figure would make neither legible.
   */
  searches: {
    total: number;
    billed: number;
    cached: number;
    /** Formatted, e.g. "$0.72". Null when no per-search price is configured. */
    cost: string | null;
  };
  autoGenerateGhost: boolean;
  purchasesEnabled: boolean;
};

/** Typed to arm the irreversible "Clear all data" action. */
const DELETE_CONFIRM_PHRASE = "delete my wardrobe";

export function SettingsClient({
  initialPrefs,
  categoryList,
  categoryParents,
  categoryShapes,
  styleTagsList,
  ownersList,
  colorList,
  credits,
  spend,
  searches,
  autoGenerateGhost,
  purchasesEnabled,
}: Props) {
  const [prefs, setPrefs] = useState<StylePrefs>(initialPrefs);
  const [newCategory, setNewCategory] = useState("");
  const [shapes, setShapes] = useState<Record<string, string>>(categoryShapes);
  const [newTag, setNewTag] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newColorHex, setNewColorHex] = useState("#4a6fb0");
  const [newColorName, setNewColorName] = useState("");
  const [autoGen, setAutoGen] = useState(autoGenerateGhost);
  const [tempUnit, setTempUnit] = useState<TemperatureUnit>(() =>
    readTemperatureUnit(initialPrefs.temperatureUnit),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [hiddenFilters, setHiddenFilters] = useState<ClosetFilterKey[]>(() =>
    getHiddenFiltersFromPrefs(initialPrefs),
  );
  const [filterError, setFilterError] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(categoryList);
  const [localParents, setLocalParents] = useState(categoryParents);
  /**
   * The category the add field is pointed at, or null for the top level.
   *
   * Held here rather than in the tree editor because the field and the list are
   * siblings: selecting a row is what re-aims the field, so one of them has to
   * own it and the field is the thing that acts on it.
   */
  const [addUnder, setAddUnder] = useState<string | null>(null);
  const [localTags, setLocalTags] = useState(styleTagsList);
  const [localOwners, setLocalOwners] = useState(ownersList);
  const [localColors, setLocalColors] = useState(colorList);
  /**
   * Favourited palette colours, by normalised name.
   *
   * Held apart from `prefs` on purpose: the heart saves on the spot, so folding
   * it into the style-prefs form would light up "Save preferences" for a change
   * that is already saved — and a stale copy in that payload would undo it.
   */
  const [favoriteColors, setFavoriteColors] = useState(() => getFavoriteColorNames(initialPrefs));
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
    // A rename or a removal elsewhere can retire the selected category; leaving
    // it selected would aim the add field at something that is not there.
    setAddUnder((current) => {
      if (!current) return null;
      const key = normalizeCategoryName(current);
      return categoryList.find((c) => normalizeCategoryName(c) === key) ?? null;
    });
  }, [categoryList]);

  useEffect(() => {
    setLocalParents(categoryParents);
  }, [categoryParents]);

  useEffect(() => {
    setLocalTags(styleTagsList);
  }, [styleTagsList]);

  useEffect(() => {
    setLocalOwners(ownersList);
  }, [ownersList]);

  useEffect(() => {
    setLocalColors(colorList);
  }, [colorList]);

  useEffect(() => {
    setFavoriteColors(getFavoriteColorNames(initialPrefs));
  }, [initialPrefs]);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(initialPrefs);

  async function onSave() {
    setSaving(true);
    await updateStylePrefs(prefs);
    setSaving(false);
    setSavedAt(Date.now());
    router.refresh();
  }

  async function onPickTemperatureUnit(next: TemperatureUnit) {
    if (next === tempUnit) return;
    setTempUnit(next);
    await setTemperatureUnit(next);
    router.refresh();
  }

  async function onToggleAuto(next: boolean) {
    setAutoGen(next);
    await setAutoGenerateGhost(next);
    router.refresh();
  }

  /** `shown` is the checkbox state, so hiding is the inverse. */
  function handleToggleFilter(key: ClosetFilterKey, shown: boolean) {
    const next = toggleHiddenFilter(hiddenFilters, key, !shown);
    const previous = hiddenFilters;
    setHiddenFilters(next);
    setFilterError(null);
    startCat(async () => {
      try {
        await setHiddenClosetFilters(next);
        router.refresh();
      } catch {
        setHiddenFilters(previous);
        setFilterError("Couldn't save that. Try again.");
      }
    });
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
      const res = await addWardrobeCategory(newCategory, addUnder);
      if (!res.ok) {
        setCatError(res.error);
        return;
      }
      // Selection survives the add, so several subcategories go in one after
      // another without re-picking the parent each time.
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

  /**
   * A drag in the category tree: beside another category, or inside it.
   *
   * Sent as the two names plus the intent rather than as a rebuilt list,
   * because the rule that makes a move legal — nothing may end up inside its
   * own descendant — belongs to the server. Nothing is applied optimistically
   * for the same reason: the answer can be "no".
   */
  function handleMoveCategory(dragged: string, target: string, mode: CategoryDropMode) {
    setCatError(null);
    startCat(async () => {
      const res = await moveWardrobeCategory(dragged, target, mode);
      if (!res.ok) setCatError(res.error);
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

  function handleAddOwner() {
    setOwnerError(null);
    startCat(async () => {
      const res = await addWardrobeOwner(newOwner);
      if (!res.ok) {
        setOwnerError(res.error);
        return;
      }
      setNewOwner("");
      router.refresh();
    });
  }

  function handleReorderOwners(nextNames: string[]) {
    const reordered = nextNames
      .map((n) => localOwners.find((o) => o.name === n))
      .filter((o): o is Owner => !!o);
    setLocalOwners(reordered);
    setOwnerError(null);
    startCat(async () => {
      const res = await reorderWardrobeOwners(nextNames);
      if (!res.ok) setOwnerError(res.error);
      router.refresh();
    });
  }

  function handleRenameOwner(oldName: string, newName: string) {
    setLocalOwners((prev) => prev.map((o) => (o.name === oldName ? { ...o, name: newName } : o)));
    setOwnerError(null);
    startCat(async () => {
      const res = await renameWardrobeOwner(oldName, newName);
      if (!res.ok) setOwnerError(res.error);
      router.refresh();
    });
  }

  function handleDeleteOwner(name: string) {
    if (
      !confirm(
        `Remove “${name}” as an owner?\nItems owned by ${name} will fall back to your first owner.`,
      )
    )
      return;
    setOwnerError(null);
    startCat(async () => {
      const res = await removeWardrobeOwner(name);
      if (!res.ok) {
        setOwnerError(res.error);
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

  function handleToggleFavoriteColor(color: Color, favorite: boolean) {
    setColorError(null);
    // Drawn immediately — a heart that waits on a round trip feels broken —
    // then reconciled from the server if it refuses.
    setFavoriteColors((prev) => toggleFavoriteColor(prev, color.name));
    startCat(async () => {
      const res = await setFavoriteColor(color.name, favorite);
      if (!res.ok) {
        setColorError(res.error);
        setFavoriteColors((prev) => toggleFavoriteColor(prev, color.name));
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
              1 credit = 1 generation. Cost per generation depends on the model —
              shown on each generate button.
            </p>
          </div>
        </div>
        <div className="pt-2 border-t border-ink/10">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-xs text-ink-muted">Spent on generation</p>
            <p className="font-serif text-xl tracking-tight tabular-nums">{spend.total}</p>
          </div>
          {spend.byModel.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {spend.byModel.map((m) => (
                <li key={m.model} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-ink-muted truncate">{m.model}</span>
                  <span className="text-ink-muted tabular-nums shrink-0">
                    {m.generations}&times; · {m.cost}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">
              {spend.generations === 0
                ? "No generations yet."
                : `${spend.generations} ${spend.generations === 1 ? "generation" : "generations"}, none billed — stub mode or served from cache.`}
            </p>
          )}
          {spend.billedGenerations > 0 && spend.billedGenerations < spend.generations && (
            <p className="mt-1 text-[11px] text-ink-muted">
              {spend.generations - spend.billedGenerations} of {spend.generations} were free
              (cache hits, stubs, or generated before cost tracking).
            </p>
          )}
        </div>

        {/*
          Product searches, which used to be the one paid call in the app that
          reported nothing anywhere. Counted rather than costed by default: the
          per-search price depends on your SerpAPI plan, and printing a guessed
          dollar figure is the thing this codebase refuses to do. Set
          SERPAPI_COST_TENTH_CENTS and the total appears.
        */}
        <div className="pt-2 border-t border-ink/10">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-xs text-ink-muted">Product searches</p>
            <p className="font-serif text-xl tracking-tight tabular-nums">
              {searches.cost ?? searches.billed}
            </p>
          </div>
          {searches.total === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">No searches yet.</p>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">
              {searches.billed} billed
              {searches.cached > 0 && <> · {searches.cached} served from cache, free</>}
              {searches.cost == null && (
                <> · no per-search price set, so this is a count not a total</>
              )}
            </p>
          )}
          <p className="mt-1 text-[11px] text-ink-muted">
            Searching charges per search, not per result — scrolling the results you
            already have is free. Checking wishlist prices searches once per watched
            item whose store page has no readable price.
          </p>
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
          Click a category to aim the field below at it — what you add then lands{" "}
          <span className="text-ink">inside</span> it, so{" "}
          <span className="text-ink">t shirt</span> can live under{" "}
          <span className="text-ink">shirt</span> and filtering by the parent finds both. Click it
          again to rename. You can also move a category by dragging the ⋮⋮ handle: drop it on the{" "}
          <span className="text-ink">left half</span> of another to put it alongside, or the{" "}
          <span className="text-ink">right half</span> to nest it inside. Removing a category sets
          affected items to <span className="text-ink">None</span> and lifts anything nested under
          it up a level.
        </p>
        {addUnder && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>
              New categories go inside{" "}
              <span className="text-ink capitalize">{addUnder}</span>.
            </span>
            <button
              type="button"
              onClick={() => setAddUnder(null)}
              className="underline underline-offset-2 hover:text-ink"
            >
              Add at the top level instead
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder={addUnder ? `Add subcategory to ${addUnder}` : "e.g. hats"}
            aria-label={addUnder ? `Add subcategory to ${addUnder}` : "Add a category"}
            className="flex-1 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCategory();
              }
              // Escape aims the field back at the top level without reaching
              // for the mouse.
              if (e.key === "Escape" && addUnder) {
                e.preventDefault();
                setAddUnder(null);
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
        <CategoryTreeEditor
          list={localCategories}
          parents={localParents}
          onMove={handleMoveCategory}
          onRename={handleRenameCategory}
          onRemove={handleDeleteCategory}
          selected={addUnder}
          onSelect={setAddUnder}
        />

        <UnreadableCategories
          categories={localCategories}
          shapes={shapes}
          onChoose={(cat, shape) => {
            const key = normalizeCategoryName(cat);
            setShapes((prev) => {
              const next = { ...prev };
              if (shape) next[key] = shape;
              else delete next[key];
              return next;
            });
            void setCategoryShape(cat, shape as GarmentKindChoice | "").then((res) => {
              if (!res.ok) setCatError(res.error);
              else router.refresh();
            });
          }}
        />

      </section>

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Owners</h3>
        <p className="text-sm text-ink-muted">
          Who a piece belongs to. Shown as chips when adding or editing, and as the{" "}
          <span className="text-ink">Everyone / Shared</span> switcher at the top of your closet.
          A piece can have more than one owner — that&apos;s a shared item. Click a name to rename;
          drag the ⋮⋮ handle to reorder (the first owner is the default for new pieces). Keep at
          least one.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            placeholder="e.g. Alex"
            className="flex-1 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddOwner();
              }
            }}
          />
          <button
            type="button"
            onClick={handleAddOwner}
            className="rounded-full border border-ink/15 px-4 py-2 text-xs hover:bg-paper-warm transition"
          >
            Add
          </button>
        </div>
        {ownerError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {ownerError}
          </p>
        )}
        <ReorderableStringList
          items={localOwners.map((o) => o.name)}
          onReorder={handleReorderOwners}
          onRename={handleRenameOwner}
          onRemove={handleDeleteOwner}
          removeDisabled={() => localOwners.length <= 1}
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
            className="flex-1 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
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
          eyedropper to sample any color on screen, name it, then add it. Tap a heart to mark a
          colour you favour — saved as you tap.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={colorInputRef}
            type="color"
            value={newColorHex}
            onChange={(e) => setNewColorHex(e.target.value)}
            aria-label="Pick a color"
            className="h-9 w-12 shrink-0 rounded-lg border border-ink/10 bg-surface p-0.5 cursor-pointer"
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
            className="flex-1 min-w-[8rem] rounded-xl border border-ink/10 bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
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
          favorites={favoriteColors}
          onToggleFavorite={handleToggleFavoriteColor}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Closet filters</h3>
        <p className="text-sm text-ink-muted max-w-xl">
          Choose which filters appear above your closet. Turning one off only hides it for you —
          nothing is deleted, and any filtering it was doing is cleared so your closet never stays
          narrowed by a control you can&apos;t see. Search and sort always stay.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {CLOSET_FILTER_KEYS.map((key) => {
            const shown = !hiddenFilters.includes(key);
            const meta = CLOSET_FILTER_LABELS[key];
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/10 bg-surface px-3 py-2.5 transition hover:border-ink/25">
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={(e) => handleToggleFilter(key, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{meta.label}</span>
                    <span className="block text-xs text-ink-muted">{meta.hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {filterError && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {filterError}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-xs uppercase tracking-wide text-ink-muted">Temperature</h3>
        <p className="text-sm text-ink-muted max-w-xl">
          The unit trip forecasts are shown in. Display only — nothing is re-saved, so switching
          back and forth never drifts a stored figure.
        </p>
        <div
          role="radiogroup"
          aria-label="Temperature unit"
          className="inline-flex rounded-full border border-ink/15 bg-surface p-1"
        >
          {(["c", "f"] as const).map((unit) => {
            const active = tempUnit === unit;
            return (
              <button
                key={unit}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPickTemperatureUnit(unit)}
                className={`rounded-full px-4 py-1.5 text-sm transition ${
                  active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-warm"
                }`}
              >
                {TEMPERATURE_UNIT_LABELS[unit]}
                {/* A worked example beats the abbreviation: 21°C means nothing
                    to half the world, and neither does 70°F to the other half. */}
                <span className={`ml-2 ${active ? "text-paper/60" : "text-ink-muted/70"}`}>
                  {formatTemperature(21, unit)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-ink/10 bg-surface p-5 space-y-3">
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
            className="w-full rounded-full border border-red-200 bg-surface px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
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

const SHAPE_CHOICES: { value: string; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "dress", label: "Dress" },
  { value: "outerwear", label: "Outerwear" },
  { value: "shoes", label: "Shoes" },
  { value: "accessory", label: "Accessory" },
];

/**
 * Categories whose name says nothing about garment shape.
 *
 * "workwear", "favorites" and "y2k" cannot be classified from text, so the
 * ghost pipeline would fall back to its generic guess-the-type prompt — and the
 * category gate refuses to generate at all. Asking once per label fixes every
 * item in it. Hidden entirely when nothing needs an answer.
 */
function UnreadableCategories({
  categories,
  shapes,
  onChoose,
}: {
  categories: string[];
  shapes: Record<string, string>;
  onChoose: (category: string, shape: string) => void;
}) {
  const needing = categoriesNeedingShape(categories, shapes as Record<string, GarmentKind>);
  const assigned = categories.filter((c) => shapes[normalizeCategoryName(c)]);

  if (needing.length === 0 && assigned.length === 0) return null;

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-4 space-y-3">
      <div>
        <p className="text-sm">Category shapes</p>
        <p className="text-xs text-ink-muted mt-1">
          Catalog renders need to know whether a category is a top, a bottom, and so on. Most names
          give that away — <span className="text-ink">shirt</span>,{" "}
          <span className="text-ink">jeans</span> — but names like{" "}
          <span className="text-ink">workwear</span> or <span className="text-ink">favorites</span>{" "}
          don&apos;t. Set those once here.
        </p>
      </div>

      {needing.length > 0 && (
        <ul className="space-y-2">
          {needing.map((cat) => (
            <li key={cat} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-amber-700 shrink-0">
                {cat} — shape unknown
              </span>
              <select
                defaultValue=""
                onChange={(e) => onChoose(cat, e.target.value)}
                className="rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:outline-none focus:border-ink/40"
                aria-label={`Shape for ${cat}`}
              >
                <option value="">Choose a shape…</option>
                {SHAPE_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}

      {assigned.length > 0 && (
        <ul className="space-y-2 pt-1 border-t border-ink/10">
          {assigned.map((cat) => (
            <li key={cat} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-muted shrink-0">{cat}</span>
              <select
                value={shapes[normalizeCategoryName(cat)] ?? ""}
                onChange={(e) => onChoose(cat, e.target.value)}
                className="rounded-lg border border-ink/15 bg-surface px-2 py-1 text-xs focus:outline-none focus:border-ink/40"
                aria-label={`Shape for ${cat}`}
              >
                {SHAPE_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
                <option value="">Clear (guess from the name)</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
