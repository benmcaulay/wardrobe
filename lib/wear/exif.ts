/**
 * Minimal EXIF date reader for camera-roll wear inference.
 *
 * A wear is only useful if it lands on the right day — the recurrence and
 * dormancy models in §6 are entirely about intervals — and the only place the
 * true date lives is the photo's own metadata. `File.lastModified` is a poor
 * substitute: copying, syncing, or editing a photo rewrites it, so a whole
 * imported library can collapse onto the import date.
 *
 * Hand-rolled rather than pulling a dependency: we need exactly one tag, and
 * the parse is a couple of hundred lines of well-specified structure. It reads
 * only the header, never decodes pixels, and runs on the client — the photo
 * itself never leaves the device.
 *
 * Returns a *local* calendar date, because EXIF DateTimeOriginal is written in
 * the camera's local time with no zone. Treating it as UTC would shift evening
 * photos onto the next day, which is the same off-by-one the wear log takes
 * care to avoid elsewhere (see lib/wear/rollup.ts).
 */

const JPEG_SOI = 0xffd8;
const APP1 = 0xffe1;
const EXIF_HEADER = 0x45786966; // "Exif"

const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;

const TYPE_ASCII = 2;

/** "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD", or null if it isn't that shape. */
export function exifDateToISO(value: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T]/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;

  const monthNum = Number(month);
  const dayNum = Number(day);
  // Cameras occasionally write all-zero dates when the clock was never set.
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;
  return `${year}-${month}-${day}`;
}

type Reader = {
  u16: (offset: number) => number;
  u32: (offset: number) => number;
};

function makeReader(view: DataView, littleEndian: boolean): Reader {
  return {
    u16: (offset) => view.getUint16(offset, littleEndian),
    u32: (offset) => view.getUint32(offset, littleEndian),
  };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Walk one IFD, collecting the date tags we care about and following the
 * pointer to the Exif sub-IFD, where DateTimeOriginal actually lives on most
 * cameras (IFD0 only carries the less trustworthy file-modified `DateTime`).
 */
function scanIFD(
  view: DataView,
  reader: Reader,
  tiffStart: number,
  ifdOffset: number,
  found: Map<number, string>,
  depth = 0,
): void {
  if (depth > 2) return; // guard against a malformed pointer loop
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return;

  const entries = reader.u16(base);
  for (let i = 0; i < entries; i += 1) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) return;

    const tag = reader.u16(entry);
    const type = reader.u16(entry + 2);
    const count = reader.u32(entry + 4);

    if (tag === TAG_EXIF_IFD_POINTER) {
      scanIFD(view, reader, tiffStart, reader.u32(entry + 8), found, depth + 1);
      continue;
    }

    if (
      type !== TYPE_ASCII ||
      (tag !== TAG_DATETIME_ORIGINAL && tag !== TAG_DATETIME_DIGITIZED && tag !== TAG_DATETIME)
    ) {
      continue;
    }

    // ASCII values longer than 4 bytes are stored out of line, at an offset
    // relative to the TIFF header rather than the entry.
    const valueOffset = count > 4 ? tiffStart + reader.u32(entry + 8) : entry + 8;
    if (valueOffset + count > view.byteLength) continue;
    found.set(tag, readAscii(view, valueOffset, count));
  }
}

/**
 * Extract the capture date from a JPEG's EXIF block.
 * Returns "YYYY-MM-DD" in the camera's local time, or null.
 */
export function readExifDate(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== JPEG_SOI) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    // Markers are always 0xFFxx; anything else means we've lost sync (or hit
    // entropy-coded scan data) and there is no point continuing.
    if ((marker & 0xff00) !== 0xff00) return null;

    const size = view.getUint16(offset + 2);
    if (size < 2) return null;

    if (marker === APP1) {
      const app1 = offset + 4;
      if (app1 + 10 > view.byteLength) return null;
      if (view.getUint32(app1) !== EXIF_HEADER) {
        offset += 2 + size;
        continue; // XMP or another APP1 flavour
      }

      const tiffStart = app1 + 6;
      if (tiffStart + 8 > view.byteLength) return null;
      const byteOrder = view.getUint16(tiffStart);
      if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;

      const reader = makeReader(view, byteOrder === 0x4949);
      const found = new Map<number, string>();
      scanIFD(view, reader, tiffStart, reader.u32(tiffStart + 4), found);

      // Preference order: when the shutter fired, then when it was digitized,
      // then the file's own timestamp — most to least trustworthy.
      for (const tag of [TAG_DATETIME_ORIGINAL, TAG_DATETIME_DIGITIZED, TAG_DATETIME]) {
        const raw = found.get(tag);
        const iso = raw ? exifDateToISO(raw) : null;
        if (iso) return iso;
      }
      return null;
    }

    // Start of scan — pixel data from here on, no more metadata.
    if (marker === 0xffda) return null;
    offset += 2 + size;
  }
  return null;
}

/**
 * Capture date for a photo, falling back to the file's mtime.
 *
 * The fallback is flagged so callers can down-weight it: a wear dated by mtime
 * is evidence that *something* was worn, on a day that may well be the day the
 * library was synced rather than the day it was worn.
 */
export type PhotoDate = { iso: string; source: "exif" | "mtime" };

export function photoDateFromParts(
  exifBuffer: ArrayBuffer | null,
  lastModified: number,
): PhotoDate {
  const exif = exifBuffer ? readExifDate(exifBuffer) : null;
  if (exif) return { iso: exif, source: "exif" };

  const date = new Date(lastModified);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return { iso, source: "mtime" };
}

/** Only the first chunk of a JPEG is needed; EXIF lives in the header. */
export const EXIF_HEAD_BYTES = 128 * 1024;
