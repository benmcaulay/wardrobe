import Link from "next/link";
import { IconGallery } from "./icon-gallery";

export const metadata = { title: "Icons · Wardrobe" };

/**
 * Reference sheet for the icon suite. Deliberately rendered with the app's own
 * paper/ink styling rather than in an isolated harness — the point is to see
 * the icons in the surroundings they actually ship into.
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
        <h1 className="font-serif text-5xl tracking-tight">Icons</h1>
        <p className="mt-2 max-w-xl text-ink-muted">
          One monoline family, drawn to match the camera and star-dollar the closet started
          with. Every icon is transparent and strokes with <code>currentColor</code>, so it
          takes the colour of whatever sits around it.
        </p>
      </header>

      <IconGallery />
    </main>
  );
}
