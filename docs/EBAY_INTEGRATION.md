# eBay integration — design and staged plan

| | |
|---|---|
| **Status** | Plan. Nothing in this document is built. |
| **Date** | 2026-08-08 |
| **Context** | `docs/TECHNICAL_SPEC.md` §6.4, §13 |
| **Scope** | eBay only. The other six marketplaces are unaffected — see "Why only eBay". |

---

## 1. Why only eBay

eBay is the single marketplace we model that offers a sanctioned, openly
available seller API capable of creating a live listing. Registration is through
the eBay Developers Program; there is no partner-approval gate.

The others are not a matter of effort:

- **Facebook Marketplace, Vinted** (`integration: "gated"`) — an API exists but
  access is approval-only, aimed at large merchants and specific verticals
  (vehicles, property, jobs). A consumer closet app will not be admitted.
- **Depop, Poshmark, Mercari, Grailed** (`integration: "none"`) — no public
  listing API at any tier. Every competing cross-lister automates these with a
  browser extension. That is a different product with materially different
  terms-of-service exposure, and is out of scope here.

The strategic value of eBay is therefore disproportionate: it is the one place
we can demonstrate the full loop — post automatically, and learn the outcome
automatically — which is the thing the manual flow can never prove.

## 2. What it buys us

Two directions, and the second is the underrated one.

**Outbound (posting).** `publishOffer` returns a real listing id, so we write a
`ListingPlacement` with a true `listedAt` and `externalUrl` instead of asking the
user to remember. No copy-paste.

**Inbound (sale sync).** The Fulfillment API reports completed orders with the
actual sale price and eBay's actual fee take. For eBay this **removes the payout-
email paste entirely** and, more importantly, replaces our *estimated* fees with
recorded ones — `ListingPlacement.feeEstimated` flips to `false` on real data.

Both directions land in the existing schema without migration. `ListingPlacement`
was designed with `externalUrl`, per-platform `listedAt`/`soldAt`, and the
`feeEstimated` flag precisely so an API integration could fill them; today the
log-a-sale sheet fills the same columns by hand.

Sale sync also fixes the honest gap called out on the landing page: "avg to sell"
currently reads `—` for most users because nothing sets `listedAt`. eBay
placements would populate it automatically.

## 3. Constraints to design around

1. **Business policies are mandatory.** `publishOffer` fails unless the seller
   has payment, return, and fulfillment policies configured. Sellers must opt in
   to business policies on eBay, after which we can read or create policies via
   the Account API. This is the most common first-run failure and needs to be a
   real step in the connect flow, not an error at publish time.
2. **Category + aspects are the hard part.** eBay requires a *leaf* category, and
   each leaf category has its own required item aspects (Brand, Size, Colour,
   Department, Style…) that vary per category and change over time. Guessing
   wrong produces a publish error, not a warning. This is the bulk of the work
   and the part most likely to be underestimated.
3. **Images must be publicly reachable.** We already satisfy this: R2 with
   `R2_PUBLIC_BASE_URL`. Local-disk dev storage will not work against eBay's
   sandbox, so sandbox testing needs R2 configured.
4. **Sandbox ≠ production.** eBay's sandbox has a separate credential set and its
   category tree can drift from production. Plan for a sandbox pass and then a
   single real listing in production before trusting it.
5. **Tokens expire.** User access tokens are short-lived; refresh tokens are
   long-lived but revocable. Refresh must be centralised, not sprinkled through
   call sites.

## 4. Where it plugs into what exists

The repo already has every seam this needs.

| Need | Existing mechanism |
|---|---|
| Background work, retries, idempotency | `GenerationJob` queue — `enqueueJob`, `claimNextJob` (`FOR UPDATE SKIP LOCKED`), `attempts`/`maxAttempts`, `PermanentJobError` vs. retryable in `lib/jobs/runner.ts` |
| Per-platform listing state | `ListingPlacement` (already built) |
| Public image URLs | R2 storage seam, `R2_PUBLIC_BASE_URL` |
| Provider abstraction w/ working stub | The pattern used for fal.ai / Fashn — every external capability sits behind an interface with a stub so the app runs keyless |
| Fee reconciliation | `lib/sell/fees.ts` — `feeEstimated` already distinguishes measured from inferred |

**OAuth token storage.** Do *not* reuse the NextAuth `Account` table. It is
owned by the Auth.js adapter, keyed `(provider, providerAccountId)`, and
conflating "how you log in" with "which eBay seller account you connected"
will break the day someone signs in with Google and connects a differently-owned
eBay account. Add a dedicated model:

```prisma
model MarketplaceConnection {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform      String    // MarketplaceId — "ebay" today
  // eBay user id, so a reconnect to a different seller account is detectable.
  externalUserId String?
  accessToken   String    // encrypted at rest — see §7
  refreshToken  String
  expiresAt     DateTime
  scopes        String    // JSON: string[]
  /// Null until we've confirmed payment/return/fulfillment policies exist.
  policiesReadyAt DateTime?
  /// Set when eBay rejects our refresh token; the UI prompts a reconnect.
  revokedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([userId, platform])
  @@index([userId])
}
```

Generalising the model name now costs nothing and means Vinted Pro or a future
partner approval doesn't need a second table.

## 5. The publish pipeline

```
wardrobe item + SaleListing draft
  → resolve leaf category            (Taxonomy API: getCategorySuggestions)
  → resolve required aspects          (Taxonomy API: getItemAspectsForCategory)
  → map our fields onto aspects       (brand, size, colour, material → eBay aspects)
  → createInventoryItem (SKU)         (title, description, images, aspects, condition)
  → createOffer                       (price, marketplace, category, policies)
  → publishOffer                      → listingId
  → upsert ListingPlacement           (status "listed", listedAt, externalUrl)
```

Every step is a pure mapping except the four network calls, so category/aspect
resolution can be unit-tested against recorded fixtures the same way
`lib/sell/payout-parse.ts` is tested against email fixtures.

**Condition mapping.** Our four-tier `ItemCondition` maps onto eBay condition
ids; `new_with_tags` → *New with tags*, `like_new` → *New without tags* or
*Pre-owned excellent* depending on category. This mapping is category-sensitive
and belongs in the same pure module as the aspect mapping.

**Unmappable items must fail loudly.** If a required aspect can't be filled from
our data (eBay wants Size, the item has none), the job should stop and surface
"eBay needs a size for this category" rather than inventing a value. Same
principle as the payout parser: never present a guess as a fact.

## 6. Staged plan

Each stage is independently shippable and independently useful. **Stage 2 is
worth having even if 3 and 4 are never built** — it is the smaller half and it
feeds the metrics that are currently empty.

| Stage | Scope | Notes |
|---|---|---|
| **1. Connect** | `MarketplaceConnection` model + migration, OAuth consent flow, encrypted token storage, centralised refresh, business-policy check with a real remediation step, "Connected to eBay" state on the Sell landing | Foundation. Nothing user-visible beyond a connected badge. |
| **2. Sale sync (inbound)** | Job type `ebay.sync-orders`, polled per connected user; match orders to placements by SKU; write real `soldPriceCents`, `feeCents` (`feeEstimated: false`), `soldAt` | **Highest value per unit effort.** Kills email-pasting for eBay and makes "avg to sell" real. Read-only against eBay, so low blast radius. |
| **3. Publish (outbound)** | Category + aspect resolution, condition mapping, the create/publish pipeline as a job, "Post to eBay" on the listings board, failure surfacing | The big one. Category/aspect work dominates. |
| **4. Lifecycle** | Price revision, end-listing, relist, reconcile drift when a user edits on eBay directly | Only worth it once 3 is in real use. |

**Sequencing note.** Doing 2 before 3 is deliberate. Sale sync is read-only, so a
bug shows up as a wrong number we can correct, not as a bad live listing under
the user's name. It also proves the OAuth and refresh plumbing under real
conditions before we let that plumbing create public listings.

## 7. Risks

- **Publishing under the user's identity is not undoable.** A bad listing is
  public, real, and attached to their seller reputation. Stage 3 needs a preview-
  and-confirm step and a hard rule that we never publish without explicit
  per-item action. No "post everything" bulk button until this is proven.
- **Token secrets at rest.** `accessToken`/`refreshToken` are credentials to a
  user's eBay seller account. They need application-level encryption, not just
  Postgres access control, and must never reach a log line or a client
  component. Worth deciding the key-management approach before Stage 1, not
  after.
- **Category/aspect drift.** eBay changes the tree and aspect requirements. Cache
  with a TTL and treat a publish failure on aspects as expected-and-handled, not
  exceptional.
- **Fee assumptions get overwritten — good.** Once sale sync runs, eBay's
  recorded fee replaces our `DEFAULT_FEE_RULES.ebay` estimate. Expect the two to
  disagree; the recorded one wins, and a persistent gap is a signal our table is
  stale (`isFeeRuleStale`).
- **Scope creep to other platforms.** The extension-based approach that would
  cover Depop/Poshmark/Mercari/Grailed is a separate product decision with its
  own ToS analysis. It should not ride along on this work.

## 8. What's needed from you before Stage 1

1. An eBay developer account (App ID / Cert ID / Dev ID) and a **sandbox seller
   account** — end-to-end testing is impossible without one.
2. R2 configured in whatever environment we test against, since eBay must fetch
   images over a public URL.
3. A decision on token encryption key management (env-held key vs. a KMS).
