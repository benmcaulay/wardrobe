"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addItemFromUpload, type AddItemState } from "./actions";

const initialState: AddItemState = {};

export function UploadForm() {
  const [state, formAction] = useFormState(addItemFromUpload, initialState);

  return (
    <form action={formAction} className="space-y-6">
      <label className="block">
        <span className="sr-only">Image file</span>
        <input
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp"
          required
          className="block w-full text-sm file:mr-4 file:rounded-full file:border-0 file:bg-ink file:text-paper file:px-4 file:py-2 file:text-xs file:tracking-wide hover:file:bg-ink-soft cursor-pointer"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
    >
      {pending ? "Uploading…" : "Upload"}
    </button>
  );
}
