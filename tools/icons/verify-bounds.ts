/**
 * Ground-truth safe-area check for the icon suite.
 *
 * Path data can't be bounds-checked by reading the numbers — relative commands
 * carry negative deltas and arcs carry a rotation value that looks like a wild
 * coordinate. So instead we RENDER each icon large, find the ink bounding box,
 * and convert it back to viewBox units. That measures what actually gets drawn,
 * including the half stroke-width that straddles every path.
 *
 *   npx tsx tmp/verify-bounds.ts <icons.json>
 */
import fs from "node:fs/promises";
import sharp from "sharp";
import { wrap } from "./render";

const SCALE = 240; // render size; 10 device px per viewBox unit
const UNITS = 24;
const MIN = 0;
const MAX = 24;

type Icon = { name: string; body: string };

async function inkBox(icon: Icon) {
  const png = await sharp(Buffer.from(wrap(icon.body, SCALE, "#000000")))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = png;
  const ch = info.channels;
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * ch + (ch - 1)];
      if (alpha < 24) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  const u = (px: number) => (px / SCALE) * UNITS;
  return { x0: u(minX), y0: u(minY), x1: u(maxX + 1), y1: u(maxY + 1) };
}

async function main() {
  const [inPath] = process.argv.slice(2);
  const icons = JSON.parse(await fs.readFile(inPath, "utf8")) as Icon[];

  let bad = 0;
  let empty = 0;

  for (const icon of icons) {
    const box = await inkBox(icon);
    if (!box) {
      console.log(`EMPTY   ${icon.name} — renders nothing`);
      empty++;
      continue;
    }
    const over =
      box.x0 < MIN - 0.01 || box.y0 < MIN - 0.01 || box.x1 > MAX + 0.01 || box.y1 > MAX + 0.01;
    const tag = over ? "CLIPPED" : "ok     ";
    const line = `${tag} ${icon.name.padEnd(16)} x ${box.x0.toFixed(2)}..${box.x1.toFixed(2)}  y ${box.y0.toFixed(2)}..${box.y1.toFixed(2)}`;
    if (over) {
      bad++;
      console.log(line);
    } else if (process.env.VERBOSE) {
      console.log(line);
    }
  }

  console.log(
    `\n${icons.length} icons — ${bad} clipped, ${empty} empty, ${icons.length - bad - empty} within the 0..24 canvas`,
  );
  if (bad || empty) process.exitCode = 1;
}

main();
