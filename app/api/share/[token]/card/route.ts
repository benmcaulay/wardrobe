import { APP_WORDMARK } from "@/lib/brand";
import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { getObject } from "@/lib/storage";
import { thumbnailPathFor } from "@/lib/image-paths";
import { prisma } from "@/lib/db";
import { resolveShare } from "@/lib/share/resolve";

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

  const filename = `${share.kind}-${share.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
