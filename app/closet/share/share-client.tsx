"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { thumbnailUrl } from "@/lib/image-paths";
import { itemTileImageTransform } from "@/lib/item-tile-meta";
import { MARKETPLACES } from "@/lib/marketplaces";
import { ICON_REGISTRY } from "@/components/icons";
import { SHARE_DESTINATIONS, type ShareDestination } from "@/lib/share/destinations";
import { SHARE_KIND_LABELS, SHARE_KINDS, sharePath, type ShareKind } from "@/lib/share/kinds";
import {
  createShareLink,
  deleteShareLink,
  restoreShareLink,
  revokeShareLink,
} from "@/lib/actions/share";

export type ShareTarget = {
  id: string;
  label: string;
  sublabel: string | null;
  /** Ghost cutout when there is one, else the original — same as the closet grid. */
  imagePath: string | null;
  thumbZoom: number;
  mirror: boolean;
};

export type ShareLinkRow = {
  id: string;
  token: string;
  kind: ShareKind;
  targetId: string | null;
  title: string;
  note: string | null;
  revoked: boolean;
  createdAt: string;
};

const ICONS = new Map(ICON_REGISTRY.map((i) => [i.name, i.Component]));

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS.get(name);
  if (!C) return <span aria-hidden className={className} />;
  return <C className={className} />;
}

export function ShareClient({
  items,
  outfits,
  links,
  wishlistCount,
}: {
  items: ShareTarget[];
  outfits: ShareTarget[];
  links: ShareLinkRow[];
  wishlistCount: number;
}) {
  const router = useRouter();
  // Don't open on a kind that has nothing to share — an empty wishlist would
  // otherwise sit selected-but-disabled, with a live "Make link" button.
  const available = useMemo(
    () =>
      SHARE_KINDS.filter(
        (k) =>
          (k === "wishlist" && wishlistCount > 0) ||
          (k === "item" && items.length > 0) ||
          (k === "outfit" && outfits.length > 0),
      ),
    [items.length, outfits.length, wishlistCount],
  );
  const [kind, setKind] = useState<ShareKind>(() => available[0] ?? "item");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("");

  // window isn't available during SSR, and the absolute URL is only needed
  // once the user actually has a link to copy.
  useEffect(() => setOrigin(window.location.origin), []);

  const allTargets = kind === "item" ? items : kind === "outfit" ? outfits : [];
  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTargets;
    return allTargets.filter(
      (t) =>
        t.label.toLowerCase().includes(q) || (t.sublabel ?? "").toLowerCase().includes(q),
    );
  }, [allTargets, query]);
  const activeLink = useMemo(
    () => links.find((l) => l.token === activeToken) ?? null,
    [links, activeToken],
  );

  async function onCreate() {
    setBusy(true);
    setError(null);
    const res = await createShareLink({ kind, targetId });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setActiveToken(res.value.token);
    router.refresh();
  }

  // Guard the button too: `available` can go empty (nothing in the closet at
  // all), and a wishlist share only makes sense with something on the list.
  const canCreate = available.includes(kind) && (kind === "wishlist" || !!targetId);

  return (
    <div className="space-y-12">
      <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-tile">
        <h2 className="font-serif text-2xl">Make a link</h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {SHARE_KINDS.map((k) => {
            const on = kind === k;
            const disabled =
              (k === "item" && items.length === 0) ||
              (k === "outfit" && outfits.length === 0) ||
              (k === "wishlist" && wishlistCount === 0);
            return (
              <button
                key={k}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setKind(k);
                  setTargetId(null);
                  setActiveToken(null);
                  setQuery("");
                }}
                className={`rounded-full border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  on
                    ? "border-ink/30 bg-paper-warm text-ink"
                    : "border-ink/10 bg-white text-ink hover:border-ink/30"
                }`}
              >
                {SHARE_KIND_LABELS[k].label}
                {k === "wishlist" && wishlistCount > 0 ? ` (${wishlistCount})` : ""}
              </button>
            );
          })}

          {kind !== "wishlist" && (
            <div className="relative ml-auto min-w-[10rem] flex-1 sm:max-w-[16rem]">
              <input
                type="text"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${kind === "item" ? "items" : "outfits"}…`}
                aria-label={`Search ${kind === "item" ? "items" : "outfits"}`}
                className="w-full rounded-full border border-ink/10 bg-white py-1.5 pl-3 pr-8 text-xs focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                >
                  ×
                </button>
              ) : (
                <Icon
                  name="search"
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
                />
              )}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-muted">{SHARE_KIND_LABELS[kind].blurb}</p>

        {/* bg-paper matches the page behind the card; the border is what
            defines the scroll area now that it no longer contrasts. */}
        {kind !== "wishlist" && (
          <div className="mt-5 max-h-64 overflow-y-auto rounded-xl border border-ink/10 bg-paper p-2">
            {targets.length === 0 ? (
              <p className="p-4 text-sm text-ink-muted">
                {query.trim()
                  ? `Nothing matches “${query.trim()}”.`
                  : "Nothing to share here yet."}
              </p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2">
                {targets.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTargetId(t.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition ${
                        targetId === t.id ? "bg-ink text-paper" : "hover:bg-paper-warm"
                      }`}
                    >
                      {t.imagePath ? (
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbnailUrl(t.imagePath)}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                            style={{
                              transform: itemTileImageTransform({
                                thumbZoom: t.thumbZoom,
                                mirror: t.mirror,
                              }),
                            }}
                          />
                        </span>
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white">
                          <Icon name="hanger" className="h-4 w-4 text-ink-muted" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{t.label}</span>
                        {t.sublabel ? (
                          <span
                            className={`block truncate text-[11px] ${
                              targetId === t.id ? "text-paper/70" : "text-ink-muted"
                            }`}
                          >
                            {t.sublabel}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

        <button
          type="button"
          onClick={onCreate}
          disabled={busy || !canCreate}
          className="mt-5 rounded-full bg-ink px-5 py-2 text-sm tracking-wide text-paper transition hover:bg-ink-soft disabled:opacity-50"
        >
          {busy ? "Making link…" : "Make link"}
        </button>
      </section>

      {activeLink && origin ? (
        <ShareSheet
          url={`${origin}${sharePath(activeLink.token)}`}
          title={activeLink.title}
          kind={activeLink.kind}
          token={activeLink.token}
        />
      ) : null}

      <section>
        <h2 className="mb-4 font-serif text-2xl">
          Your links{links.length > 0 ? ` (${links.length})` : ""}
        </h2>
        {links.length === 0 ? (
          <p className="rounded-2xl border border-ink/10 bg-paper-warm p-10 text-center text-ink-muted">
            No links yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <LinkRow
                key={l.id}
                row={l}
                origin={origin}
                onOpen={() => setActiveToken(l.token)}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The destinations grid — this is where the logos live. */
function ShareSheet({
  url,
  title,
  kind,
  token,
}: {
  url: string;
  title: string;
  kind: ShareKind;
  token: string;
}) {
  const cardUrl = `/api/share/${encodeURIComponent(token)}/card`;
  const [copied, setCopied] = useState(false);
  const [nativeAvailable, setNativeAvailable] = useState(false);

  useEffect(() => {
    setNativeAvailable(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  async function run(dest: ShareDestination) {
    if (dest.href) {
      window.open(dest.href({ url, title }), "_blank", "noopener,noreferrer");
      return;
    }
    if (dest.id === "copy") {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      } catch {
        /* clipboard blocked — the URL is on screen to copy by hand */
      }
      return;
    }
    if (dest.id === "native") {
      try {
        await navigator.share({ title, url });
      } catch {
        /* user dismissed the sheet */
      }
      return;
    }
    if (dest.id === "download") {
      // Served with Content-Disposition: attachment, so this downloads the
      // PNG rather than navigating away.
      window.location.href = cardUrl;
    }
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-white p-6 shadow-tile">
      <h2 className="font-serif text-2xl">Send it</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl bg-paper-warm px-3 py-2 text-xs">
          {url}
        </code>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-paper-warm px-3 py-2 text-xs text-ink transition hover:bg-ink/5"
        >
          Preview ↗
        </a>
      </div>

      <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {SHARE_DESTINATIONS.filter((d) => d.id !== "native" || nativeAvailable).map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => run(d)}
              title={d.note ?? d.label}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-ink/10 bg-white px-2 py-4 transition hover:border-ink/25 hover:bg-paper-warm"
            >
              <Icon name={d.icon} className="h-5 w-5 text-ink" />
              <span className="text-[11px] text-ink-muted">
                {d.id === "copy" && copied ? "Copied" : d.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {kind !== "wishlist" && (
        <div className="mt-6 border-t border-ink/10 pt-5">
          <h3 className="text-[11px] uppercase tracking-wide text-ink-muted">
            Selling it instead?
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            These open each marketplace&apos;s new-listing page. None of them accept a prefilled
            listing from the web, so bring your photos and details with you.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {MARKETPLACES.map((m) => (
              <li key={m.id}>
                <a
                  href={m.sellUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={m.note ?? `List on ${m.label}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs text-ink transition hover:border-ink/30"
                >
                  <Icon name="storefront" className="h-3.5 w-3.5 text-ink-muted" />
                  {m.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LinkRow({
  row,
  origin,
  onOpen,
  onChanged,
}: {
  row: ShareLinkRow;
  origin: string;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const url = origin ? `${origin}${sharePath(row.token)}` : sharePath(row.token);

  async function act(key: string, fn: () => Promise<{ ok: boolean }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (res.ok) onChanged();
  }

  return (
    <li>
      <article
        className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${
          row.revoked ? "border-ink/10 bg-paper-warm opacity-70" : "border-ink/10 bg-white"
        }`}
      >
        <Icon
          name={row.kind === "wishlist" ? "heart" : row.kind === "outfit" ? "hanger" : "tag"}
          className="h-4 w-4 shrink-0 text-ink-muted"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {row.title}
            {row.revoked ? <span className="ml-2 text-xs text-ink-muted">· off</span> : null}
          </p>
          <p className="truncate text-[11px] text-ink-muted">{url}</p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {!row.revoked && (
            <button type="button" onClick={onOpen} className="underline text-ink-muted hover:text-ink">
              Send
            </button>
          )}
          {row.revoked ? (
            <button
              type="button"
              onClick={() => act("restore", () => restoreShareLink(row.id))}
              disabled={busy !== null}
              className="underline text-ink-muted hover:text-ink disabled:opacity-50"
            >
              {busy === "restore" ? "…" : "Turn back on"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => act("revoke", () => revokeShareLink(row.id))}
              disabled={busy !== null}
              className="underline text-ink-muted hover:text-ink disabled:opacity-50"
            >
              {busy === "revoke" ? "…" : "Turn off"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!confirm("Delete this link? The URL will stop working entirely.")) return;
              void act("delete", () => deleteShareLink(row.id));
            }}
            disabled={busy !== null}
            className="text-ink-muted hover:text-red-700 disabled:opacity-50"
          >
            {busy === "delete" ? "…" : "Delete"}
          </button>
        </div>
      </article>
    </li>
  );
}
