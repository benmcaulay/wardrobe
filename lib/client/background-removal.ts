"use client";

/**
 * Client-side wrapper around @imgly/background-removal. Takes the raw image
 * blob and returns a PNG blob with the background removed. Runs entirely in
 * the browser via WASM — free and private, but the model weights download
 * lazily on first use (~30MB).
 *
 * The dynamic import keeps the WASM/JS chunks out of the initial bundle and
 * out of the SSR pass — they only load when the function is first called.
 */
export async function removeBackgroundFromBlob(input: Blob): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(input, {
    output: { format: "image/png", quality: 0.92 },
  });
}
