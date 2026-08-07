/**
 * Dev-only preview harness for the icon suite.
 *
 * Reads a JSON array of { name, body } (body = the inner SVG markup of a
 * 24x24 icon) and writes a contact sheet PNG so a human — or an agent with
 * image reading — can actually look at the result instead of trusting the
 * path data. Also renders each icon at 16px, the size it ships at in the nav,
 * because that is where a too-thin stroke or a fussy detail falls apart.
 *
 * The preview composites onto the app's paper colour purely so the strokes are
 * visible; the shipped SVGs have no background of their own.
 *
 *   npx tsx tmp/icon-render.ts <icons.json> <out.png>
 */
import fs from "node:fs/promises";
import sharp from "sharp";

const PAPER = "#faf8f5";
const INK = "#1a1613";
const STROKE_WIDTH = 1.75;

type Icon = { name: string; body: string };

/** Wrap an icon body in the standard 24x24 frame. */
export function wrap(body: string, size: number, color = INK): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const CELL = 132;
const BIG = 72;
const SMALL = 16;
const COLS = 6;

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error("usage: tsx tmp/icon-render.ts <icons.json> <out.png>");
    process.exit(1);
  }

  const icons = JSON.parse(await fs.readFile(inPath, "utf8")) as Icon[];
  const rows = Math.ceil(icons.length / COLS);
  const W = COLS * CELL;
  const H = rows * CELL;

  const layers: sharp.OverlayOptions[] = [];

  for (const [i, icon] of icons.entries()) {
    const cx = (i % COLS) * CELL;
    const cy = Math.floor(i / COLS) * CELL;

    let big: Buffer;
    let small: Buffer;
    try {
      big = await sharp(Buffer.from(wrap(icon.body, BIG))).png().toBuffer();
      small = await sharp(Buffer.from(wrap(icon.body, SMALL))).png().toBuffer();
    } catch (err) {
      console.error(`FAILED to render "${icon.name}": ${(err as Error).message}`);
      continue;
    }

    layers.push({ input: big, left: cx + Math.round((CELL - BIG) / 2), top: cy + 14 });
    layers.push({ input: small, left: cx + CELL - SMALL - 14, top: cy + CELL - SMALL - 26 });

    const label = icon.name.replace(/[<&>]/g, "");
    const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="20"><text x="${CELL / 2}" y="14" font-family="monospace" font-size="11" fill="#6b625c" text-anchor="middle">${label}</text></svg>`;
    layers.push({ input: Buffer.from(text), left: cx, top: cy + CELL - 20 });
  }

  await sharp({
    create: { width: W, height: H, channels: 4, background: PAPER },
  })
    .composite(layers)
    .png()
    .toFile(outPath);

  console.log(`wrote ${outPath} — ${icons.length} icons, ${COLS}x${rows} grid`);
}

// Only run when invoked directly — verify-bounds.ts imports `wrap` from here.
if (process.argv[1]?.endsWith("render.ts")) main();
