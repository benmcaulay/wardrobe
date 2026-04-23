export default function Loading() {
  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-10 h-10 w-40 rounded-lg bg-paper-warm" />
      <div className="mb-8 space-y-3">
        <div className="h-11 rounded-full bg-paper-warm" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 w-20 rounded-full bg-paper-warm" />
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <li key={i} className="rounded-2xl bg-paper-warm aspect-square" />
        ))}
      </ul>
    </main>
  );
}
