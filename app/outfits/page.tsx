import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStringArray } from "@/lib/json";
import { thumbnailUrl } from "@/lib/image-paths";
import { DeleteOutfitButton } from "./delete-button";

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function OutfitsPage() {
  const user = await requireUser();
  const outfits = await prisma.outfit.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const allItemIds = [...new Set(outfits.flatMap((o) => parseStringArray(o.itemIds)))];
  const items = allItemIds.length
    ? await prisma.wardrobeItem.findMany({
        where: { id: { in: allItemIds }, userId: user.id },
        select: { id: true, name: true, originalImagePath: true },
      })
    : [];
  const itemsById = new Map(items.map((i) => [i.id, i]));

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <nav className="text-xs text-ink-muted mb-6">
        <Link href="/closet" className="hover:text-ink">
          ← Closet
        </Link>
      </nav>

      <header className="mb-10 flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-4xl tracking-tight">Outfits</h1>
        <Link
          href="/outfits/new"
          className="rounded-full bg-ink text-paper px-5 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
        >
          + New outfit
        </Link>
      </header>

      {outfits.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-paper-warm p-12 text-center">
          <p className="font-serif text-2xl">No outfits yet.</p>
          <p className="text-ink-muted mt-2">Combine pieces you love.</p>
          <Link
            href="/outfits/new"
            className="inline-block mt-6 rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Build your first outfit
          </Link>
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {outfits.map((outfit) => {
            const ids = parseStringArray(outfit.itemIds);
            const resolved = ids.map((id) => itemsById.get(id)).filter(Boolean) as {
              id: string;
              name: string;
              originalImagePath: string;
            }[];
            const stack = resolved.slice(0, 4);
            const overflow = resolved.length - stack.length;

            return (
              <li
                key={outfit.id}
                className="rounded-2xl bg-white shadow-tile p-5 flex flex-col gap-4"
              >
                <div className="flex -space-x-3">
                  {stack.length === 0 ? (
                    <div className="w-16 h-16 rounded-xl bg-paper-warm border border-ink/10" />
                  ) : (
                    stack.map((it, i) => (
                      <div
                        key={it.id}
                        className="relative w-16 h-16 rounded-xl overflow-hidden border-2 border-white shadow-sm"
                        style={{ zIndex: 10 - i }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumbnailUrl(it.originalImagePath)}
                          alt={it.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))
                  )}
                  {overflow > 0 && (
                    <div className="relative w-16 h-16 rounded-xl bg-paper-warm border-2 border-white flex items-center justify-center text-xs text-ink-muted">
                      +{overflow}
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <h2 className="font-serif text-xl tracking-tight truncate">{outfit.name}</h2>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {resolved.length} {resolved.length === 1 ? "piece" : "pieces"} · {formatDate(outfit.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 pt-1 border-t border-ink/5 -mx-1 px-1">
                  <Link
                    href={`/try-on?outfit=${outfit.id}`}
                    className="rounded-full bg-accent text-white px-3 py-1.5 text-xs tracking-wide hover:bg-accent/90 transition"
                  >
                    Try on
                  </Link>
                  <Link
                    href={`/outfits/${outfit.id}/edit`}
                    className="rounded-full border border-ink/15 px-3 py-1.5 text-xs tracking-wide hover:bg-paper-warm transition"
                  >
                    Edit
                  </Link>
                  <DeleteOutfitButton outfitId={outfit.id} name={outfit.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
