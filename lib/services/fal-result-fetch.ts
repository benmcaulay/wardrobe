/** Download a fal-generated asset URL with brief CDN settle time and retries. */

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function falAuthHeaders(url: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "image/*,*/*",
    "User-Agent": "wardrobe-app/1.0",
  };
  const key = process.env.FAL_KEY?.trim();
  if (key && /fal\.(ai|media|run)|falcdn/i.test(url)) {
    headers.Authorization = `Key ${key}`;
  }
  return headers;
}

export async function fetchFalResultBuffer(url: string): Promise<Buffer> {
  const maxAttempts = 5;
  let lastStatus = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt === 0) {
      await sleep(750);
    } else {
      await sleep(Math.min(1500 * attempt, 6000));
    }

    const res = await fetch(url, {
      headers: falAuthHeaders(url),
      redirect: "follow",
    });

    if (res.ok) {
      return Buffer.from(await res.arrayBuffer());
    }

    lastStatus = res.status;
    if (!RETRYABLE_STATUSES.has(res.status)) break;
  }

  if (lastStatus === 500) {
    throw new Error(
      "The image was generated but fal's CDN failed to deliver it (500). Please try again in a moment.",
    );
  }
  throw new Error(`Failed to download result: ${lastStatus || "unknown"}`);
}
