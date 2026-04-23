export default function Loading() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10 space-y-3">
        <div className="h-10 w-40 rounded-lg bg-paper-warm" />
        <div className="h-4 w-96 max-w-full rounded bg-paper-warm" />
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-8">
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-paper-warm" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-paper-warm aspect-[3/4]" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-paper-warm" />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-paper-warm aspect-square" />
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-paper-warm h-64" />
      </div>
    </main>
  );
}
