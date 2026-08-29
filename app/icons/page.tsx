import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { IconGallery } from "./icon-gallery";
import { MarkSheet } from "./mark-sheet";

export const metadata = { title: `Marks & icons · ${APP_NAME}` };

/**
 * Reference sheet for the brand: the mark candidates, then the icon suite.
 * Deliberately rendered with the app's own paper/ink styling rather than in an
 * isolated harness — the point is to see them in the surroundings they actually
 * ship into. The marks section additionally renders a nested `.dark` block so
 * both backdrops are on one screen; see mark-sheet.tsx.
 */
export default function IconsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-6 text-xs text-ink-muted">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="font-serif text-5xl tracking-tight">Marks &amp; icons</h1>
        <p className="mt-2 max-w-xl text-ink-muted">
          Everything the brand draws. The marks are five candidates, still being
          chosen; the icons are one settled monoline family, drawn to match the
          camera and star-dollar the closet started with. All of it strokes with{" "}
          <code>currentColor</code> and takes its accent from the palette, so
          nothing here needs a second asset for Space mode.
        </p>
      </header>

      <MarkSheet />

      <hr className="my-room border-ink/10" />

      <section>
        <h2 className="mb-6 font-serif text-3xl tracking-tight">Icons</h2>
        <IconGallery />
      </section>
    </main>
  );
}
