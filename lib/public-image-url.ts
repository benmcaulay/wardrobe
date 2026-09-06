import crypto from "node:crypto";

/**
 * Short-lived signed URL so SerpAPI Google Lens can fetch an upload.
 * Requires PUBLIC_APP_URL (HTTPS, reachable from the internet) and IMAGE_SECRET.
 */
export function signedPublicImageUrl(relativePath: string): string | null {
  const base = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const secret = process.env.IMAGE_SECRET?.trim();
  if (!base || !secret) return null;

  const exp = Math.floor(Date.now() / 1000) + 600;
  const payload = `${relativePath}|${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  const encodedPath = relativePath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");

  return `${base}/api/public-image/${encodedPath}?exp=${exp}&sig=${sig}`;
}

export function verifyPublicImageToken(
  relativePath: string,
  exp: string,
  sig: string,
): boolean {
  const secret = process.env.IMAGE_SECRET?.trim();
  if (!secret) return false;

  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = `${relativePath}|${expNum}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}
