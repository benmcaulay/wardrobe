import { requireUser } from "@/lib/auth";
import { UploadForm } from "./upload-form";

export default async function AddItemPage() {
  await requireUser();
  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Add a piece</h1>
        <p className="text-ink-muted mt-2">
          Upload a photo of the garment. JPG, PNG or WebP, up to 10MB.
        </p>
      </header>
      <UploadForm />
    </main>
  );
}
