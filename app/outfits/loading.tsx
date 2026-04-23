export default function Loading() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10 flex items-baseline justify-between gap-4">
        <div className="h-10 w-32 rounded-lg bg-paper-warm" />
        <div className="h-9 w-32 rounded-full bg-paper-warm" />
      </div>
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="rounded-2xl bg-white shadow-tile p-5 space-y-4">
            <div className="flex -space-x-3">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="w-16 h-16 rounded-xl bg-paper-warm border-2 border-white" />
              ))}
            </div>
            <div className="space-y-2">
              <div className="h-5 w-2/3 rounded bg-paper-warm" />
              <div className="h-3 w-1/3 rounded bg-paper-warm" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
