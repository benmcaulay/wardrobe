import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import { formatCents } from "@/lib/sale-listing";
import { formatRailInches } from "@/lib/space/ledger";
import {
  resolveShare,
  shareThumbUrl,
  type SharedItem,
  type SharedSpace,
} from "@/lib/share/resolve";

export const dynamic = "force-dynamic";

type Params = { params: { token: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const lookup = await resolveShare(params.token);
  if (lookup.status !== "ok") return { title: `Shared · ${APP_NAME}`, robots: { index: false } };
  return {
    title: `${lookup.share.title} · ${APP_NAME}`,
    // Unlisted means unlisted — keep these out of search results.
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: Params) {
  const lookup = await resolveShare(params.token);

  if (lookup.status === "revoked") {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight">This link was turned off</h1>
        <p className="mt-3 text-ink-muted">
          Whoever shared it has since switched the link off. Ask them for a new one.
        </p>
      </Shell>
    );
  }

  if (lookup.status === "not-found") {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight">Nothing here</h1>
        <p className="mt-3 text-ink-muted">This link doesn&apos;t point at anything.</p>
      </Shell>
    );
  }

  const { share } = lookup;

  // A space share has no garments in it at all, so it takes its own layout
  // rather than threading "no items, no photos, no prices" through the one
  // below.
  if (share.kind === "space" && share.space) {
    return (
      <Shell>
        <header className="mb-10">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">Space</p>
          <h1 className="mt-1 font-serif text-5xl tracking-tight">{share.title}</h1>
          {share.note ? <p className="mt-3 max-w-xl text-ink-muted">{share.note}</p> : null}
        </header>
        <SharedSpaceView space={share.space} />
        <footer className="mt-16 border-t border-ink/10 pt-6 text-xs text-ink-muted">
          Shared from {APP_NAME}. Counts only — no photos, no prices, and nothing about which
          garments they were.
        </footer>
      </Shell>
    );
  }

  const isWishlist = share.kind === "wishlist";
  const total = share.items.reduce((sum, i) => sum + (i.priceCents ?? 0), 0);

  return (
    <Shell>
      <header className="mb-10">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          {isWishlist ? "Wishlist" : share.kind === "outfit" ? "Outfit" : "Shared piece"}
        </p>
        <h1 className="mt-1 font-serif text-5xl tracking-tight">{share.title}</h1>
        {share.note ? <p className="mt-3 max-w-xl text-ink-muted">{share.note}</p> : null}
        <p className="mt-3 text-xs text-ink-muted">
          {share.items.length} {share.items.length === 1 ? "piece" : "pieces"}
          {isWishlist && total > 0 ? ` · ${formatCents(total)} total` : ""}
        </p>
      </header>

      {share.items.length === 0 ? (
        <p className="rounded-2xl bg-paper-warm p-10 text-center text-ink-muted">
          Nothing on this list yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {share.items.map((item) => (
            <li key={item.id}>
              <SharedCard item={item} token={share.token} showPrice={isWishlist} />
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-16 border-t border-ink/10 pt-6 text-xs text-ink-muted">
        Shared from {APP_NAME}. Only these photos and details were shared — nothing else in
        the closet is visible from this link.
      </footer>
    </Shell>
  );
}

/**
 * The shared ledger. Same restraint as the private page: separate figures, no
 * total, nothing that reads as a score — and here, no money at all.
 */
function SharedSpaceView({ space }: { space: SharedSpace }) {
  const peak = Math.max(1, ...space.months.map((m) => Math.max(m.in, m.out)));
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="In" value={space.allTime.in} hint="pieces ever added" />
        <Figure label="Out" value={space.allTime.out} hint="pieces ever sold" />
        <Figure
          label="Rail freed"
          value={formatRailInches(space.allTime.railInches)}
          hint="estimated by garment kind"
        />
        <Figure label="In the closet" value={space.ownedCount} hint="right now" />
      </dl>

      <div className="mt-10">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
          The last {space.months.length} months
        </h2>
        {/* One axis behind every column — see app/closet/space/space-year.tsx. */}
        <div className="relative mt-4">
          <span aria-hidden className="absolute inset-x-0 top-11 h-px bg-ink/20" />
          <ul className="flex items-stretch gap-1.5" aria-hidden>
            {space.months.map((month) => (
              <li key={month.startMs} className="flex min-w-0 flex-1 flex-col items-center">
                <span className="flex h-11 w-full flex-col justify-end">
                  <span
                    className="mx-auto w-full max-w-[26px] rounded-t-sm bg-ink/70"
                    style={{ height: barPx(month.in, peak) }}
                  />
                </span>
                <span className="flex h-11 w-full flex-col justify-start">
                  <span
                    className="mx-auto w-full max-w-[26px] rounded-b-sm bg-accent"
                    style={{ height: barPx(month.out, peak) }}
                  />
                </span>
                <span className="mt-1.5 text-[10px] text-ink-muted">
                  {new Date(month.startMs).toLocaleString("en-US", { month: "narrow" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <table className="sr-only">
          <caption>Pieces in and out by month</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
            </tr>
          </thead>
          <tbody>
            {space.months.map((month) => (
              <tr key={month.startMs}>
                <th scope="row">
                  {new Date(month.startMs).toLocaleString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </th>
                <td>{month.in}</td>
                <td>{month.out}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-muted">
          Dark bars up are pieces in; green bars down are pieces out.
        </p>
      </div>
    </div>
  );
}

function barPx(count: number, peak: number): number {
  if (count <= 0) return 0;
  return Math.max(3, Math.round((count / peak) * 44));
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-paper-warm px-4 py-4">
      <dd className="font-serif text-3xl tracking-tight tabular-nums">{value}</dd>
      <dt className="mt-1 text-[11px] uppercase tracking-[0.1em] text-ink-muted">{label}</dt>
      <p className="mt-0.5 text-[10px] text-ink-muted/80">{hint}</p>
    </div>
  );
}

function SharedCard({
  item,
  token,
  showPrice,
}: {
  item: SharedItem;
  token: string;
  showPrice: boolean;
}) {
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shareThumbUrl(token, item.id)}
        alt={item.name}
        loading="lazy"
        className="aspect-square w-full rounded-xl bg-surface object-cover"
      />
      <div className="mt-2.5 min-w-0">
        <p className="truncate text-sm">{item.name}</p>
        <p className="truncate text-xs text-ink-muted">{item.brand ?? item.category}</p>
        {item.colors.length > 0 && (
          <span className="mt-1.5 flex items-center gap-1" aria-label="Colours">
            {item.colors.slice(0, 5).map((c) => (
              <span
                key={`${c.hex}-${c.name}`}
                title={c.name}
                className="h-2.5 w-2.5 rounded-full border border-ink/15"
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </span>
        )}
        {showPrice && item.priceCents != null && (
          <p className="mt-1.5 text-sm tabular-nums">
            {formatCents(item.priceCents, item.currency)}
            {item.retailer ? <span className="text-ink-muted"> · {item.retailer}</span> : null}
          </p>
        )}
      </div>
    </>
  );

  // A wishlist entry with a store link should be clickable — that's the whole
  // point of sharing a gift list.
  if (showPrice && item.productUrl) {
    return (
      <a
        href={item.productUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="block rounded-2xl border border-ink/10 bg-surface p-3 transition hover:border-ink/25 hover:shadow-tile"
      >
        {body}
        <span className="mt-2 block text-xs text-ink-muted underline">Buy it ↗</span>
      </a>
    );
  }

  return <div className="rounded-2xl border border-ink/10 bg-surface p-3">{body}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl px-6 py-14">{children}</main>;
}
