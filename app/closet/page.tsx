import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl bg-white shadow-tile overflow-hidden aspect-square flex flex-col"
            >
              <div className="flex-1 bg-paper-warm" />
              <div className="p-3 text-xs">
                <div className="font-medium truncate">{item.name}</div>
                <div className="text-ink-muted truncate">{item.brand ?? "—"}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
