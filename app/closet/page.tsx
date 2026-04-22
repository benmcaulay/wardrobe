import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { thumbnailUrl } from "@/lib/uploads";

export default async function ClosetPage() {
  const user = await requireUser();
  const items = await prisma.wardrobeItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <header className="mb-10 flex items-baseline justify-between">
        <h1 className="font-serif text-4xl tracking-tight">Closet</h1>
        <span className="text-ink-muted text-sm">
          {items.length} {items.length === 1 ? "piece" : "pieces"}
        </span>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-paper-warm p-12 text-center">
          <p className="font-serif text-2xl">Your closet is empty.</p>
          <p className="text-ink-muted mt-2">Let&apos;s fix that.</p>
          <Link
            href="/closet/add"
            className="inline-block mt-6 rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Upload your first piece
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/closet/${item.id}`}
                className="block rounded-2xl bg-white shadow-tile overflow-hidden aspect-square relative group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl(item.originalImagePath)}
                  alt={item.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-ink/70 to-transparent text-white opacity-0 group-hover:opacity-100 transition">
                  <div className="text-xs font-medium truncate">{item.name}</div>
                  <div className="text-[10px] text-white/80 truncate">{item.brand ?? "—"}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/closet/add"
        aria-label="Add item"
        className="fixed bottom-8 right-8 rounded-full bg-ink text-paper w-14 h-14 flex items-center justify-center text-2xl shadow-tile hover:bg-ink-soft transition"
      >
        +
      </Link>
    </main>
  );
}
