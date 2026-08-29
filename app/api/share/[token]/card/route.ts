import { APP_WORDMARK } from "@/lib/brand";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { getObject } from "@/lib/storage";
import { thumbnailPathFor } from "@/lib/image-paths";
import { prisma } from "@/lib/db";
import { resolveShare, type SharedSpace } from "@/lib/share/resolve";
import { formatRailInches } from "@/lib/space/ledger";

/**
 * Render a share card PNG — the thing you actually post to Instagram or TikTok,
 * which can't accept a link.
 *
 * Portrait 1080x1350 (the standard social aspect). Composed from the same
 * thumbnails the public page uses, so it leaks nothing extra.
 */
export const dynamic = "force-dynamic";

const W = 1080;
const H = 1350;
const PAPER = "#faf8f5";
const INK = "#1a1613";
const MUTED = "#6b625c";
const ACCENT = "#7a8c6f";
const MAX_TILES = 6;

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/** Trim to fit a rough character budget so long names don't overflow. */
function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token ?? "");
  const lookup = await resolveShare(token);
  if (lookup.status !== "ok") return new NextResponse("Not found", { status: 404 });

  const { share } = lookup;

  // A space card has no photographs in it, so it skips the whole tile pipeline
  // rather than composing a grid of nothing.
  if (share.kind === "space" && share.space) {
    return pngResponse(await renderSpaceCard(share.title, share.space), "space");
  }

  const picks = share.items.slice(0, MAX_TILES);

  const rows = await prisma.wardrobeItem.findMany({
    where: { id: { in: picks.map((p) => p.id) } },
    select: { id: true, originalImagePath: true },
  });
  const pathById = new Map(rows.map((r) => [r.id, thumbnailPathFor(r.originalImagePath)]));

  // Single item gets one big square; a set gets a 2- or 3-up grid.
  const cols = picks.length === 1 ? 1 : picks.length <= 4 ? 2 : 3;
  const gutter = 28;
  const margin = 72;
  const gridW = W - margin * 2;
  const cell = Math.floor((gridW - gutter * (cols - 1)) / cols);
  const rowsCount = Math.ceil(picks.length / cols);
  const gridTop = 250;

  const layers: sharp.OverlayOptions[] = [];

  for (const [i, item] of picks.entries()) {
    const key = pathById.get(item.id);
    if (!key) continue;
    const buf = await getObject(key);
    if (!buf) continue;

    try {
      const tile = await sharp(buf)
        .resize(cell, cell, { fit: "cover", position: "attention" })
        .png()
        .toBuffer();
      const rounded = await sharp(tile)
        .composite([
          {
            input: Buffer.from(
              `<svg width="${cell}" height="${cell}"><rect width="${cell}" height="${cell}" rx="28" fill="#fff"/></svg>`,
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();

      layers.push({
        input: rounded,
        left: margin + (i % cols) * (cell + gutter),
        top: gridTop + Math.floor(i / cols) * (cell + gutter),
      });
    } catch {
      /* skip an unreadable image rather than failing the whole card */
    }
  }

  const gridBottom = gridTop + rowsCount * cell + (rowsCount - 1) * gutter;
  const kicker =
    share.kind === "wishlist" ? "WISHLIST" : share.kind === "outfit" ? "OUTFIT" : "FROM MY CLOSET";
  const sub =
    share.kind === "item"
      ? [picks[0]?.brand, picks[0]?.category].filter(Boolean).join(" · ")
      : `${share.items.length} ${share.items.length === 1 ? "piece" : "pieces"}`;

  const text = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${margin}" y="120" font-family="Georgia,'Times New Roman',serif" font-size="30" letter-spacing="6" fill="${MUTED}">${esc(kicker)}</text>
    <text x="${margin}" y="196" font-family="Georgia,'Times New Roman',serif" font-size="66" fill="${INK}">${esc(clamp(share.title, 30))}</text>
    <text x="${margin}" y="${Math.min(gridBottom + 66, H - 132)}" font-family="Helvetica,Arial,sans-serif" font-size="32" fill="${MUTED}">${esc(clamp(sub, 46))}</text>
    <text x="${margin}" y="${H - 56}" font-family="Helvetica,Arial,sans-serif" font-size="26" letter-spacing="3" fill="${MUTED}">${APP_WORDMARK}</text>
  </svg>`;

  layers.push({ input: Buffer.from(text), left: 0, top: 0 });

  const png = await sharp({
    create: { width: W, height: H, channels: 4, background: PAPER },
  })
    .composite(layers)
    .png()
    .toBuffer();

  return pngResponse(png, `${share.kind}-${share.title}`);
}

function pngResponse(png: Buffer, name: string): NextResponse {
  const filename = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}

/**
 * The year, as a card. Two rows of mirrored bars and three figures — the same
 * four readings the private page shows, minus money, which `SharedSpace` has no
 * field for.
 *
 * Drawn entirely in SVG: no thumbnails means no storage reads, so this path
 * can't fail on an unreadable image and doesn't need the skip-and-continue
 * handling the tile grid has.
 */
async function renderSpaceCard(title: string, space: SharedSpace): Promise<Buffer> {
  const margin = 72;
  const axisY = 780;
  const arm = 190;
  const slotW = space.months.length > 0 ? (W - margin * 2) / space.months.length : 0;
  const barW = Math.max(6, Math.min(56, slotW * 0.52));
  const peak = Math.max(1, ...space.months.map((m) => Math.max(m.in, m.out)));

  const bars = space.months
    .flatMap((month, i) => {
      const cx = margin + slotW * (i + 0.5);
      const x = cx - barW / 2;
      const inH = barHeight(month.in, peak, arm);
      const outH = barHeight(month.out, peak, arm);
      return [
        inH > 0
          ? `<rect x="${x.toFixed(1)}" y="${(axisY - inH).toFixed(1)}" width="${barW.toFixed(1)}" height="${inH.toFixed(1)}" rx="6" fill="${INK}" opacity="0.72"/>`
          : "",
        outH > 0
          ? `<rect x="${x.toFixed(1)}" y="${axisY.toFixed(1)}" width="${barW.toFixed(1)}" height="${outH.toFixed(1)}" rx="6" fill="${ACCENT}"/>`
          : "",
      ];
    })
    .filter(Boolean)
    .join("");

  const figures = [
    { label: "IN", value: String(space.allTime.in) },
    { label: "OUT", value: String(space.allTime.out) },
    { label: "RAIL FREED", value: formatRailInches(space.allTime.railInches) },
  ]
    .map((figure, i) => {
      const x = margin + i * ((W - margin * 2) / 3);
      return (
        `<text x="${x}" y="1150" font-family="Georgia,'Times New Roman',serif" font-size="64" fill="${INK}">${esc(figure.value)}</text>` +
        `<text x="${x}" y="1192" font-family="Helvetica,Arial,sans-serif" font-size="24" letter-spacing="3" fill="${MUTED}">${esc(figure.label)}</text>`
      );
    })
    .join("");

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${PAPER}"/>
    <text x="${margin}" y="120" font-family="Georgia,'Times New Roman',serif" font-size="30" letter-spacing="6" fill="${MUTED}">SPACE</text>
    <text x="${margin}" y="196" font-family="Georgia,'Times New Roman',serif" font-size="66" fill="${INK}">${esc(clamp(title, 30))}</text>
    <text x="${margin}" y="262" font-family="Helvetica,Arial,sans-serif" font-size="30" fill="${MUTED}">${esc(
      `${space.ownedCount} ${space.ownedCount === 1 ? "piece" : "pieces"} in the closet`,
    )}</text>
    ${bars}
    <line x1="${margin}" y1="${axisY}" x2="${W - margin}" y2="${axisY}" stroke="${INK}" stroke-opacity="0.2" stroke-width="2"/>
    <text x="${margin}" y="${axisY + arm + 80}" font-family="Helvetica,Arial,sans-serif" font-size="26" fill="${MUTED}">UP: IN &#183; DOWN: OUT</text>
    ${figures}
    <text x="${margin}" y="${H - 56}" font-family="Helvetica,Arial,sans-serif" font-size="26" letter-spacing="3" fill="${MUTED}">${APP_WORDMARK}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** No bar at all for zero — a hairline reads as "almost none". */
function barHeight(count: number, peak: number, arm: number): number {
  if (count <= 0) return 0;
  return Math.max(4, (count / peak) * arm);
}
