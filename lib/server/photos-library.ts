/**
 * Read the macOS Photos library: who is in it, and which photos are of them.
 *
 * Backs the in-app picker (docs/CAMERA_ROLL_PERSON_ISOLATION.md §5). Apple has
 * already clustered and named every face in the library, which is better
 * labelled data than anything this app could derive — and getting at it needs
 * no face model and performs no biometric processing here.
 *
 * Mac-only by construction: it shells out to a local binary against a local
 * database. Everything is guarded by `photosAvailable()` so the rest of the app
 * degrades to the ordinary file picker instead of erroring.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "@/lib/log";

export type LibraryPerson = { name: string; count: number };

export type LibraryPhoto = {
  uuid: string;
  filename: string;
  date: string | null;
  /** Full-resolution original. Null when iCloud has optimised it away. */
  path: string | null;
  /** Photos-generated JPEG preview, read in place — nothing is exported. */
  derivative: string | null;
  persons: string[];
  missing: boolean;
  favorite: boolean;
};

const INDEX_SCRIPT = path.join(process.cwd(), "scripts", "photos-index.py");

/** Cap one index at a size the grid can actually render. */
export const MAX_INDEXED_PHOTOS = 2000;

/**
 * The Python that has osxphotos importable.
 *
 * Resolved through Homebrew rather than hardcoded, because the path carries the
 * version (`/opt/homebrew/Cellar/osxphotos/0.76.1/...`) and would break on the
 * next upgrade. `--prefix` is the stable opt/ symlink.
 */
let cachedPython: string | null | undefined;

export function osxphotosPython(): string | null {
  if (cachedPython !== undefined) return cachedPython;
  cachedPython = (() => {
    const brew = spawnSync("brew", ["--prefix", "osxphotos"], { encoding: "utf8" });
    if (brew.status !== 0) return null;
    const candidate = path.join(brew.stdout.trim(), "libexec", "bin", "python");
    return fs.existsSync(candidate) ? candidate : null;
  })();
  return cachedPython;
}

export function photosAvailable(): boolean {
  return osxphotosPython() !== null && fs.existsSync(INDEX_SCRIPT);
}

/** Raised when the Photos database is present but macOS will not let us read it. */
export class PhotosPermissionError extends Error {
  constructor() {
    super(
      "Could not read the Photos library. Grant Full Disk Access to the app " +
        "running this server (System Settings → Privacy & Security → Full Disk " +
        "Access), then fully quit and reopen it — macOS only applies the change " +
        "to newly launched processes.",
    );
    this.name = "PhotosPermissionError";
  }
}

function runIndex(args: string[]): unknown {
  const python = osxphotosPython();
  if (!python) throw new Error("osxphotos is not installed (brew install osxphotos)");

  let stdout: string;
  try {
    stdout = execFileSync(python, [INDEX_SCRIPT, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}` : String(err);
    // TCC denies the read even though the file mode allows it, so the failure
    // arrives as a copy error rather than anything mentioning permission.
    if (/Photos\.sqlite|Error copying|operation not permitted|Operation not permitted/i.test(detail)) {
      throw new PhotosPermissionError();
    }
    throw err;
  }
  return stdout.trim() ? JSON.parse(stdout) : [];
}

export function listPersons(): LibraryPerson[] {
  const raw = runIndex(["--persons-only"]);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is LibraryPerson => !!p && typeof p.name === "string")
    .map((p) => ({ name: p.name, count: Number(p.count) || 0 }));
}

export type PersonQuery = {
  persons: string[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
};

export function queryPersonPhotos(query: PersonQuery): LibraryPhoto[] {
  const args: string[] = [];
  for (const person of query.persons) args.push("--person", person);
  if (query.fromDate) args.push("--from-date", query.fromDate);
  if (query.toDate) args.push("--to-date", query.toDate);
  args.push("--limit", String(Math.min(query.limit ?? MAX_INDEXED_PHOTOS, MAX_INDEXED_PHOTOS)));

  const raw = runIndex(args);
  if (!Array.isArray(raw)) return [];
  const photos = raw as LibraryPhoto[];
  log.info("photos.index", { persons: query.persons.join(","), count: photos.length });
  return photos;
}

/* ── Index cache ──────────────────────────────────────────────────────────
 *
 * The preview route has to turn a uuid into a file path, and re-querying
 * osxphotos per thumbnail is not an option: every call loads the whole Photos
 * database. So the index a user just built is held in memory and the route
 * reads from it.
 *
 * It doubles as the security boundary. The route never accepts a path from the
 * client — it accepts a uuid and serves only what this user's own index already
 * contains, which is an allowlist by construction rather than a filter someone
 * has to get right.
 */

type CachedIndex = { photos: Map<string, LibraryPhoto>; at: number };

declare global {
  // eslint-disable-next-line no-var
  var __photosIndex: Map<string, CachedIndex> | undefined;
}

/*
 * On globalThis, for the same reason `lib/db.ts` puts Prisma there.
 *
 * Next compiles server actions and route handlers into separate bundles, so a
 * plain module-level Map is not one Map — the action writes to its copy and the
 * preview route reads an empty one. That failed as every thumbnail 404ing with
 * "Not indexed" while the grid itself loaded fine, which points at the route
 * rather than at the cache it is actually about.
 */
const indexByUser: Map<string, CachedIndex> = globalThis.__photosIndex ?? new Map();
globalThis.__photosIndex = indexByUser;

/** Long enough to browse and select; short enough not to pin stale paths. */
const INDEX_TTL_MS = 60 * 60 * 1000;

export function cacheIndex(userId: string, photos: readonly LibraryPhoto[]): void {
  indexByUser.set(userId, {
    photos: new Map(photos.map((p) => [p.uuid, p])),
    at: Date.now(),
  });
}

export function lookupIndexed(userId: string, uuid: string): LibraryPhoto | null {
  const entry = indexByUser.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.at > INDEX_TTL_MS) {
    indexByUser.delete(userId);
    return null;
  }
  return entry.photos.get(uuid) ?? null;
}

/**
 * Defence in depth on top of the allowlist: whatever the index says, only ever
 * read from inside a Photos library bundle. A path that does not look like one
 * means the index is not what we think it is, and the right move is to serve
 * nothing.
 */
export function isInsidePhotosLibrary(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved.includes(".photoslibrary" + path.sep);
}
