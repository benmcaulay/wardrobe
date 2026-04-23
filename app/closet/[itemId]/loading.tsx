export default function Loading() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-10">
        <div className="rounded-2xl bg-paper-warm aspect-square" />
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-paper-warm" />
              <div className="h-9 w-full rounded-xl bg-paper-warm" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
