import { requireUser } from "@/lib/auth";
import { AddItemFlow } from "./add-item-flow";

export default async function AddItemPage() {
  await requireUser();
  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Add a piece</h1>
        <p className="text-ink-muted mt-2">
          Upload a photo — we&apos;ll analyze it, search for a product match, and
          pre-fill the details for you.
        </p>
      </header>
      <AddItemFlow />
    </main>
  );
}
