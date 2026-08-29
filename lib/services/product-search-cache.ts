/**
 * Don't pay twice for the same search.
 *
 * SerpAPI bills per *search request*, not per result, and nothing here used to
 * remember anything: `serpApiGet` fetches with `revalidate: 0`, so typing
 * "black jeans", clicking away, and typing it again billed two searches. The
 * paths that hurt are the quiet ones — "Check prices" on the wishlist issues one
 * search per watched item, so a list with two similarly-named pieces paid twice
 * for one lookup.
 *
 * Scope, stated plainly: this is an **in-process** cache. It is not shared
 * between server instances and it does not survive a restart or a redeploy. It
 * is aimed squarely at the repeat-within-a-session case, which is the one that
 * actually happens, and it is deliberately not a database table — a stale price
 * persisted for a day is worse than a second search.
 *
 * Pure apart from the module-level `Map`: `nowMs` is always passed in, so the
 * TTL and eviction are testable without a clock.
 */

/**
 * How long a result stays fresh.
 *
 * Ten minutes is chosen against what the cache is caching: shop prices, which
 * move on the order of days, and a user's own repeated searching, which happens
 * on the order of seconds. Long enough to catch every realistic repeat, short
 * enough that nobody sees yesterday's price.
 */
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Most queries held at once.
 *
 * A bound is required, not tidiness: this Map lives for the lifetime of the
 * server process, so an unbounded one is a slow memory leak fed by user input.
 */
export const SEARCH_CACHE_MAX_ENTRIES = 200;

type Entry<T> = { at: number; value: T };

const store = new Map<string, Entry<unknown>>();

/**
 * The cache key.
 *
 * Case- and whitespace-insensitive, because "Black Jeans" and "black  jeans"
 * are one search to SerpAPI's biller and should be one search to us. Exported so
 * a test can assert two spellings collide rather than inferring it.
 */
export function searchCacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A fresh cached value, or null.
 *
 * An expired entry is deleted on the way out rather than left to the eviction
 * pass, so a key that is read often but never re-set cannot hold a stale value
 * alive in the Map.
 */
export function getCachedSearch<T>(query: string, nowMs: number): T | null {
  const key = searchCacheKey(query);
  if (!key) return null;
  const hit = store.get(key);
  if (!hit) return null;
  if (nowMs - hit.at >= SEARCH_CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  /*
   * Re-inserted so the Map's insertion order is recency order, which is what
   * makes the eviction below least-recently-*used* rather than
   * least-recently-written. Without this, a hot key inserted early is the first
   * one thrown away.
   */
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function setCachedSearch<T>(query: string, value: T, nowMs: number): void {
  const key = searchCacheKey(query);
  if (!key) return;
  store.delete(key);
  store.set(key, { at: nowMs, value });

  // Oldest-first, because Map iterates in insertion order and `getCachedSearch`
  // keeps that order meaningful.
  while (store.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/** Tests and any future "force refresh" control. */
export function clearSearchCache(): void {
  store.clear();
}

/** Entries currently held, expired ones included. For tests and diagnostics. */
export function searchCacheSize(): number {
  return store.size;
}
