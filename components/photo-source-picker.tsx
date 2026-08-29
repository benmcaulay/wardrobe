"use client";

/**
 * Where a picture comes from: camera, the web, or a file.
 *
 * One chooser, used by the first photo on /closet/add and by "Add another
 * picture" on a saved item. Those were different UIs offering different subsets:
 * the add screen had a drop zone with Take photo / Choose file *plus* a separate
 * web-search panel above it, while adding a further view offered a single
 * "Upload photo as view" button and no way to reach either of the other two. The
 * sources are the same three in both places, so the control is the same control.
 *
 * Presentational and stateless. Camera capture is a modal the page owns (there
 * is one per page, not one per picker), and the web lane's query and results are
 * held by the caller because selecting a listing means something different in
 * each place — a new garment on the add screen, another view on an existing one.
 */

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Camera, Hanger, Search, Upload } from "@/components/icons";
import { ProductSearchPanel } from "@/components/product-search-panel";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/image-upload-accept";
import type { ProductMatch } from "@/lib/services/reverseImageSearch";
import { springSnappy } from "@/lib/ui-motion";

/** The web lane. Omit to hide it entirely — not every caller can accept one. */
export type WebSourceProps = {
  query: string;
  onQueryChange: (query: string) => void;
  results: ProductMatch[];
  onResultsChange: (results: ProductMatch[]) => void;
  onSearch: (query: string) => Promise<ProductMatch[]>;
  onSelect: (match: ProductMatch) => void;
  selectedUrl?: string | null;
  onClearSelection?: () => void;
  /** Shown above the search box. */
  hint?: string;
};

type Props = {
  /** Camera capture, a chosen file, a drop, and a paste all arrive here. */
  onFile: (file: File) => void;
  /** Opens the page's camera modal. Omit to hide the camera option. */
  onTakePhoto?: () => void;
  web?: WebSourceProps;
  /** Headline. The drop zone is the primary target, so it carries the label. */
  title?: string;
  subtitle?: string;
  disabled?: boolean;
  error?: string | null;
  /** Compact drops the padding for use inside a modal. */
  compact?: boolean;
  /**
   * Start with the web lane expanded.
   *
   * True on the add screen, where searching for a listing is the intended front
   * door and the panel was always visible before this component existed —
   * collapsing it there would have hidden a deliberately primary path. False
   * everywhere else, so the one source that costs money stays behind a click.
   */
  webDefaultOpen?: boolean;
};

export function PhotoSourcePicker({
  onFile,
  onTakePhoto,
  web,
  title = "Add a garment photo",
  subtitle = "Drop, paste, snap, or click anywhere in this panel",
  disabled = false,
  error,
  compact = false,
  webDefaultOpen = false,
}: Props) {
  const reduce = useReducedMotion();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  /*
   * The web lane is collapsed by default.
   *
   * It is the only source that costs money — SerpAPI bills per search — so it
   * does not get to be the thing your cursor lands on. Camera and file are free
   * and instant, and a chooser that leads with the paid option is a chooser that
   * bills people for browsing.
   */
  const [webOpen, setWebOpen] = useState(webDefaultOpen);

  return (
    <div>
      <motion.label
        htmlFor="photo-source-file"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (disabled) return;
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        /*
         * Horizontal padding is larger than vertical in compact mode. Three
         * source buttons in a modal barely fit the width, and at an even `p-6`
         * the outer two sat right against the dashed border.
         */
        className={`block rounded-3xl border-2 border-dashed text-center transition-colors ${
          compact ? "px-5 py-6" : "p-12"
        } ${
          disabled
            ? "cursor-not-allowed border-ink/10 bg-paper-warm opacity-60"
            : dragActive
              ? "cursor-pointer border-accent bg-accent-soft/20"
              : "cursor-pointer border-ink/15 bg-paper-warm hover:border-ink/30"
        }`}
      >
        <motion.div
          animate={
            reduce ? undefined : dragActive ? { scale: 1.12, rotate: -3 } : { scale: 1, rotate: 0 }
          }
          transition={springSnappy}
          className={`mx-auto flex items-center justify-center rounded-2xl bg-ink text-paper ${
            compact ? "mb-3 h-10 w-10" : "mb-4 h-14 w-14"
          }`}
        >
          <Hanger className={compact ? "h-5 w-5" : "h-7 w-7"} />
        </motion.div>

        <p className={compact ? "font-serif text-lg" : "font-serif text-2xl"}>
          {dragActive ? "Drop it right here" : title}
        </p>
        <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>

        <input
          id="photo-source-file"
          ref={fileRef}
          type="file"
          accept={IMAGE_UPLOAD_ACCEPT}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file twice still fires a change.
            e.target.value = "";
            if (file) onFile(file);
          }}
        />

        {/*
          Wraps rather than shrinks. The three buttons cannot fit one row inside
          a modal, and flex-shrink took it out of the labels instead — "Take
          photo" broke onto two lines and the row still touched both edges.
        */}
        <div
          className={
            compact
              ? "mt-5 flex flex-wrap items-center justify-center gap-2"
              : "mt-6 flex flex-col justify-center gap-2 sm:flex-row sm:gap-3"
          }
        >
          {onTakePhoto && (
            <SourceButton
              onClick={onTakePhoto}
              disabled={disabled}
              variant="solid"
              compact={compact}
              icon={<Camera className="h-4 w-4" />}
              label="Take photo"
              ariaLabel="Take photo with camera"
            />
          )}
          <SourceButton
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            compact={compact}
            icon={<Upload className="h-4 w-4" />}
            label="Choose file"
            ariaLabel="Choose image from photo library or files"
          />
          {web && (
            <SourceButton
              onClick={() => setWebOpen((open) => !open)}
              disabled={disabled}
              compact={compact}
              icon={<Search className="h-4 w-4" />}
              label={webOpen ? "Hide search" : "Search the web"}
              ariaLabel="Find the product photo on the web"
              expanded={webOpen}
            />
          )}
        </div>

        <p className="mt-4 text-[11px] text-ink-muted">JPG, PNG, WebP or HEIC · up to 10 MB</p>
      </motion.label>

      {/*
        Outside the label, not inside it. A click anywhere in that label opens
        the file picker, so a search box nested in it would be unusable — every
        attempt to type in it would pop the OS file dialog instead.
      */}
      {web && webOpen && (
        <div className="mt-3">
          <ProductSearchPanel
            title="Find the photo online"
            hint={
              web.hint ??
              "Each search costs one lookup; scrolling the results it returns is free."
            }
            query={web.query}
            onQueryChange={web.onQueryChange}
            results={web.results}
            onResultsChange={web.onResultsChange}
            onSearch={web.onSearch}
            onSelect={web.onSelect}
            selectedUrl={web.selectedUrl}
            onClearSelection={web.onClearSelection}
          />
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function SourceButton({
  onClick,
  disabled,
  icon,
  label,
  ariaLabel,
  variant = "outline",
  expanded,
  compact = false,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  variant?: "solid" | "outline";
  expanded?: boolean;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      // The wrapping label would otherwise also open the file picker.
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      whileHover={reduce || disabled ? undefined : { scale: 1.04 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.96 }}
      transition={springSnappy}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full tracking-wide transition disabled:opacity-50 ${
        compact ? "px-3.5 py-1.5 text-xs" : "gap-2 px-6 py-2 text-sm"
      } ${
        variant === "solid"
          ? "bg-ink text-paper hover:bg-ink-soft"
          : "border border-ink/15 bg-surface hover:bg-paper-warm"
      }`}
    >
      {icon}
      {label}
    </motion.button>
  );
}
