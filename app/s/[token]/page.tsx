import type { Metadata } from "next";
import { formatCents } from "@/lib/sale-listing";
import { resolveShare, shareThumbUrl, type SharedItem } from "@/lib/share/resolve";

export const dynamic = "force-dynamic";

type Params = { params: { token: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const lookup = await resolveShare(params.token);
  if (lookup.status !== "ok") return { title: "Shared · Wardrobe", robots: { index: false } };
  return {
    title: `${lookup.share.title} · Wardrobe`,
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
        Shared from Wardrobe. Only these photos and details were shared — nothing else in the
        closet is visible from this link.
      </footer>
    </Shell>
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
        className="aspect-square w-full rounded-xl bg-white object-cover"
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
        className="block rounded-2xl border border-ink/10 bg-white p-3 transition hover:border-ink/25 hover:shadow-tile"
      >
        {body}
        <span className="mt-2 block text-xs text-ink-muted underline">Buy it ↗</span>
      </a>
    );
  }

  return <div className="rounded-2xl border border-ink/10 bg-white p-3">{body}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl px-6 py-14">{children}</main>;
}
