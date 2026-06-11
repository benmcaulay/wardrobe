# Wardrobe — Technical Specification

| | |
|---|---|
| **Document** | System & Feature Technical Specification |
| **Product** | Wardrobe (working title) — AI digital closet & recommerce |
| **Version** | 1.0 |
| **Date** | 2026-06-10 |
| **Status** | Draft for technical due diligence |
| **Audience** | Technical Advisor / Diligence (VC) |
| **Prepared from** | Source tree at branch `claude/keen-edison-Rmyvb` |

> **Reading note.** This document describes the system *as built*, distinguishes
> demonstration-grade scaffolding from production-grade subsystems, and states
> the engineering work required to harden each area. The strategic product focus
> is the **swipe-to-sell (recommerce) feature** — §6 specifies it in depth and
> §13 lays out its roadmap. Sections are candid about current maturity by design.

---

## 1. Executive Summary

Wardrobe is a Next.js application that lets a user digitize their physical
wardrobe and act on it in three ways: (1) produce clean, e-commerce-grade
"ghost-mannequin" product photos of each garment via generative AI; (2) run a
generative **virtual try-on** that renders the user wearing selected garments;
and (3) **triage their closet for resale through a Tinder-style swipe deck**
that auto-drafts marketplace listings.

The codebase is a single, cohesive TypeScript monorepo (Next.js App Router) with
a clean separation between deterministic business logic, an external-service
abstraction seam, and the UI. Every external capability (image generation,
background removal, reverse-image search, scraping, weather) sits behind a stable
interface with a working stub, so the product is fully demonstrable with **zero
API keys** and can be switched to real providers one file at a time.

**Maturity at a glance:**

| Subsystem | Maturity | Note |
|---|---|---|
| Core app architecture / data model | **Production-shaped** | Clean module boundaries; needs DB + storage swap (§9, §11) |
| Ghost-mannequin generation | **Working w/ real provider** | fal.ai; deterministic, credit-metered |
| Virtual try-on | **Working w/ real provider** | Fashn or fal.ai (idm-vton) |
| Background removal | **Production (client-side)** | Free WASM, no per-call cost |
| Swipe-to-sell (strategic core) | **Working, manual hand-off** | Drafts + deep-links; no marketplace API posting yet (§6.4) |
| Auth | **Production-shaped** | NextAuth + Google OAuth, DB sessions in Postgres; demo mode is an explicit dev flag (§9.1) |
| Persistence | **Production-shaped** | PostgreSQL 16; JSON columns still TEXT (§11.1) |
| File storage | **Production-shaped** | Storage seam: local disk (dev) or S3/R2 with signed URLs (§11.2) |
| Payments / monetization | **Stub** | Credit ledger exists; no payment processor (§10) |

---

## 2. Product Overview & Strategic Focus

### 2.1 What the product does today

A user enters a demo session, uploads garment photos, and the app builds a
structured **digital closet**. From there:

- **Catalog quality.** Each item can be rendered as a ghost-mannequin product
  shot (invisible-mannequin studio image on pure white).
- **Visualization.** The user uploads reference photos of themselves and renders
  a virtual try-on of any item or saved outfit.
- **Recommerce (focus).** A swipe deck surfaces untriaged items; swiping right
  ("Sell") generates a ready-to-paste marketplace listing (title, description,
  hashtags, suggested price); swiping left ("Keep") archives the decision.
- **Adjacent utility.** An outfit builder (drag/resize/layer canvas) and
  "SmartPakker" trip-packing planner (climate-aware bin-packing) increase
  engagement and data density.

### 2.2 Strategic thesis (why sell-by-swipe is the core)

The resale ("recommerce") market is large and friction-bound: the dominant
reason closets don't get sold is the per-item effort of photographing, writing,
pricing, and cross-listing. Wardrobe already removes most of that effort as a
*byproduct* of being a digital closet:

- The garment is **already photographed** and, via ghost-mannequin, already has
  a catalog-grade image suitable for a listing.
- The item is **already structured** (brand, category, color, material, retail
  price), so a listing **draft and price are generated instantly** (§6.3).
- The **swipe interaction reduces the decision to a single gesture**, turning
  "should I sell this?" from a chore into a session.

The current gap — and the central roadmap item (§13) — is that no consumer
marketplace exposes a public listing-creation API, so the final hand-off is
manual copy/paste + deep link. Closing that gap (cross-listing automation,
pricing intelligence, and an in-app transaction layer) is the path from
"utility" to "marketplace with take-rate economics."

---

## 3. System Architecture

### 3.1 Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18 |
| Language | TypeScript (strict) |
| Server logic | React Server Components + Server Actions ("use server") |
| Data access | Prisma ORM |
| Database | PostgreSQL 16 (Docker Compose for local dev) |
| Auth | NextAuth v4 — Google OAuth, database sessions (Prisma adapter) |
| Image processing | `sharp` (server), `@imgly/background-removal` (client WASM) |
| Generative AI | fal.ai (`@fal-ai/client`), Fashn (REST) |
| Styling | Tailwind CSS |
| Testing | Vitest |
| Packaging | pnpm |

### 3.2 Topology

The application is a **single deployable Next.js server** plus a database and a
file store. There is no separate API tier; the browser talks to Server
Components (initial render) and Server Actions (mutations) directly. External AI
calls are made **server-side only**, so provider keys never reach the client.

```
Browser ──HTTP──> Next.js (App Router)
  │                   ├── Server Components (read: Prisma)
  │                   ├── Server Actions   (write: Prisma + services)
  │                   └── Route Handlers    (/api/images, /api/demo, /api/backup)
  │                          │
  │                          ├── Prisma ──> PostgreSQL
  │                          ├── lib/storage ──> local disk | S3 / R2
  │                          └── lib/services/* ──> fal.ai / Fashn / SerpAPI / …
  └── @imgly/background-removal (WASM, in-browser; no server round-trip)
```

### 3.3 Request lifecycle (representative: generate ghost mannequin)

1. Client invokes server action `previewGhostMannequin` / `generateGhostFor`.
2. Action authorizes the user (`requireUser`), checks the credit balance.
3. `lib/services/ghostMannequin.ts` resolves+uploads inputs to the provider,
   calls the model, downloads the result, normalizes it (`sharp`), and runs
   `whitenBackground` post-processing to guarantee a pure-white backdrop and a
   transparent cutout.
4. The action persists the result path and **atomically decrements credits with
   the DB row insert** in a transaction (no charge if generation throws).
5. `revalidatePath` refreshes affected routes.

### 3.4 Module boundaries (key design property)

- `lib/services/*` — the **external-capability seam**. Each file exports a stable
  function with a stub and (where wired) a real provider behind a `USE_REAL_*`
  flag. Swapping providers edits exactly one file.
- `lib/*` (pure) — deterministic domain logic (packing algorithm, listing-draft
  builder, pricing heuristic, estimators, category/JSON helpers). No Node
  built-ins where the module must also run client-side, so the same code powers
  live client-side recomputation and server validation.
- `lib/actions/*` and `app/**/actions.ts` — server actions (the write API).
- `app/**` — routes and UI; `components/*` — shared UI.

---

## 4. Data Model

Persisted via Prisma on **PostgreSQL 16** (local dev via `docker-compose.yml`).
Structured fields are stored as JSON-encoded **text** through helpers in
`lib/json.ts` — a holdover from the original SQLite datasource, with a
documented one-migration path to native `Json` columns (§11.1).

### 4.1 Entities

| Entity | Purpose | Key fields |
|---|---|---|
| **User** | Account + style prefs + credit balance | `email` (unique), `credits`, `stylePrefs` (JSON), `autoGenerateGhost` |
| **WardrobeItem** | A garment | `category`, `subcategory`, `brand`, `colors` (JSON), `priceCents`, `material`, `pattern`, `styleTags`/`season` (JSON), image paths (`originalImagePath`, `ghostImagePath`, `ghostViews`, `extraImagePaths`), wear stats, packing overrides (`weightGrams`, `volumeLiters`) |
| **TryOnGeneration** | Audit log of a ghost generation | `itemId`, `resultImagePath`, `creditsUsed` |
| **PersonPhoto** | User reference photo for try-on | `imagePath`, `label` |
| **Outfit** | Named set of item ids | `itemIds` (JSON) |
| **VirtualTryOn** | One try-on render | `personPhotoId`, `outfitId?`, `itemIds` (JSON), `prompt?`, `resultImagePath` |
| **SaleListing** | **Resale state for one item** | `status`, `askingCents`, `condition`, `title`, `description`, `marketplaces` (JSON), `updatedAt` (§6) |
| **OutfitLayout** | Saved outfit-builder canvas | `frameHeight`, `pieces` (JSON of `{itemId,x,y,scale,z}`) |
| **PackingBag** | A piece of luggage | `volumeLiters`, `maxWeightKg?`, `silhouette` |
| **PackingTrip** | A trip plan | `destination`, dates, `climateData` (JSON), `bagIds`, `assignments` (JSON) |

### 4.2 Relationships & integrity

- All child entities cascade-delete from `User`; `WardrobeItem` deletion cascades
  to its try-ons and `SaleListing` (1:1 via `itemId @unique`).
- `VirtualTryOn.outfitId` is `SetNull` on outfit deletion (renders survive).
- Indexes: per-`userId` on every owned entity, plus composite
  `(userId, category)` on items and `(userId, status)` on `SaleListing` — the two
  hot query paths (closet filtering and the for-sale board).

### 4.3 Schema observations (diligence)

- **JSON-as-text** is a holdover from the original SQLite datasource, documented
  in-schema. Converting to native `Json` is planned as its own migration (§11.1).
- Money is stored as integer **cents** with an explicit `currency` — correct.
- The model is multi-tenant-ready (every row is user-scoped and indexed); it has
  simply not yet been *run* multi-tenant because auth is demo-grade (§9.1).

---

## 5. Feature Specifications — AI & Catalog

### 5.1 Item ingestion pipeline (`/closet/add`)

1. Pick photo (drag/drop or webcam) → crop to square (`react-easy-crop`).
2. Two parallel passes: **server** (`saveUpload` → EXIF-rotate, resize to 1536px,
   write JPEG + 400px thumbnail; then optional vision tagging / reverse-image
   search / scrape) and **client** (`@imgly/background-removal` produces a
   transparent cutout, saved server-side).
3. Confirmation form pre-fills metadata; user can attach **context shots**.
4. Optional ghost-mannequin generation (1 credit).
5. Save persists the `WardrobeItem` and logs a `TryOnGeneration`.

### 5.2 Ghost-mannequin generation (`lib/services/ghostMannequin.ts`)

- **Provider:** fal.ai image-edit model. **Current default:**
  `fal-ai/seedream/v4/edit` (selected for top-tier prompt adherence — see §5.4);
  overridable via `FAL_GHOST_MODEL`. ~$0.03–0.08/call depending on model.
- **Prompting:** category-specialized prompts (upper/lower/dress/footwear/general)
  with a strict single-item-fidelity clause (prevents the model "completing the
  outfit"), a configurable **camera-angle** directive (footwear 45°-left,
  apparel square-to-camera; `GHOST_*_ANGLE` envs), and white-on-white separation
  guidance.
- **Post-processing (`whitenBackground`):** connected-component flood-fill from
  the frame edges forces a pure-white backdrop and emits a transparent cutout;
  an erosion pass plus a near-white **halo-cleanup** pass remove fringing without
  eating shaded white garment edges. All thresholds are env-tunable
  (`GHOST_WHITEN_*`).
- **Determinism:** output filename is a SHA-256 of the inputs (paths, category,
  instructions, model, mode), so identical requests are idempotent and cacheable.

### 5.3 Virtual try-on (`lib/services/virtualTryOn.ts`)

- **Providers (auto-selected):** **Fashn** if `FASHN_API_KEY` is set (billed on
  the Fashn plan, no in-app credit); otherwise **fal.ai** (1 in-app credit); else
  a watermarked stub.
- **fal path:** defaults to the dedicated `fal-ai/idm-vton` try-on model
  (identity/pose preservation). Editor models (gemini/flux/seedream) are
  supported via a separate code path detected by model id.
- **Multi-garment outfits** are layered by **chaining**: each garment is applied
  to the previous step's result. The fal/idm-vton chain feeds the provider-hosted
  result URL straight into the next step (lossless); the Fashn chain uses PNG
  intermediates to avoid generational JPEG degradation.
- **Quality knobs** (Fashn `mode`/`garment_photo_type`, idm-vton steps) are
  env-configurable with quality-leaning defaults.
- **Crediting** is atomic with the row insert, identical to ghost-mannequin.

### 5.4 External-service seam (`lib/services/*`)

| Service | Status | Providers (suggested) |
|---|---|---|
| `ghostMannequin` | **Real** (fal.ai) | fal.ai (SeeDream / Flux Kontext / Gemini) |
| `virtualTryOn` / `fashnTryOn` | **Real** (Fashn or fal.ai) | Fashn, fal.ai idm-vton |
| background removal (client) | **Real** | `@imgly/background-removal` (WASM) |
| `vision` | Stub | Claude Vision, OpenAI, Google Vision |
| `reverseImageSearch` | Stub | SerpAPI (Google Lens), Bing Visual Search |
| `productScraper` | Stub | ScrapingBee, Bright Data, Apify |
| `weather` (SmartPakker) | Real-capable | Open-Meteo (keyless) |

Every stub returns realistic shapes so the full UX runs offline; `USE_REAL_*`
flags flip each to production independently.

---

## 6. Feature Specification — Swipe-to-Sell (Strategic Core)

This is the long-term product focus. The feature spans a swipe deck, a listing
lifecycle, deterministic draft/price generation, and marketplace hand-off.

### 6.1 The swipe deck (`/closet/sell`, `sell-swiper.tsx`)

- **Eligibility query:** items owned by the user, not wishlist, **with no
  `SaleListing` row** (i.e. untriaged), newest first. The image shown prefers the
  ghost-mannequin render over the original.
- **Interaction:** a stacked-card UI (3 cards deep) with pointer-driven drag,
  rotation, and a `COMMIT_THRESHOLD` (110px) past which release commits.
  Right = **Sell**, left = **Keep**; on-card "Sell/Keep" stamps fade in with drag
  distance. Tap targets (✕ / ↶ undo / \$) mirror the gestures.
- **Optimistic + durable:** the card flies off and local state updates
  immediately; the decision persists via a server action inside a React
  transition. **Undo** restores the card and deletes the just-created listing.
- **Per-card economics surfaced inline:** "Paid \$X · resale ~\$Y", computed live
  from the retail price and condition (§6.3).

### 6.2 Listing lifecycle (`SaleListing`, `app/closet/sell/actions.ts`)

State machine on `SaleListing.status`:

```
            swipe right                 user action            user action
(untriaged) ───────────► for_sale ───────────► listed ───────────► sold
     ▲          │                                  
     │ swipe left (keep)                            
     └────────► skipped                             
     remove listing → back to untriaged (re-enters deck)
```

- `setSaleDecision({decision})` — "keep" upserts `skipped`; "sell" upserts
  `for_sale`, generating a draft + suggested price on first creation while
  **preserving prior user edits** on re-sell.
- `updateSaleListing(...)` — edits asking price, condition, title, description,
  marketplaces (validated + length-capped; marketplace ids sanitized).
- `setSaleStatus(...)` — advances lifecycle (`for_sale`→`listed`→`sold`).
- `removeSaleListing(...)` — deletes the row; the item returns to the deck.

All actions enforce ownership (`userId` match) before mutating.

### 6.3 Draft & price generation (`lib/sale-listing.ts`)

**Deterministic, no AI** (instant, free, reproducible — and a clean future
upgrade point to an LLM):

- **Title:** `"Brand Name – Descriptor"`, capped to the marketplace title length.
- **Description:** branded lead-in + bulleted attributes (condition, color,
  material, pattern, type) + a closing CTA.
- **Hashtags:** derived from brand, style tags, subcategory, category, colors,
  material; de-duplicated, capped at 12.
- **Suggested price (`suggestedAskingCents`):** `retail × condition resale-factor`
  (new-with-tags 0.60 → fair 0.20), charm-priced (`.99` above \$10), \$3 floor.
  Returns null when there is no retail anchor.

### 6.4 Marketplace hand-off (`lib/marketplaces.ts`) — the key limitation

Seven marketplaces are modeled (Depop, Poshmark, Mercari, Vinted, eBay, Grailed,
Facebook). **None expose a public listing-creation API**, so `prefillSupported`
is `false` everywhere and the product **cannot auto-post**. The
flow is: generate a copy-ready draft → deep-link to the marketplace's "new
listing" page in a new tab → user pastes. The for-sale board
(`/closet/sell/listings`) is the staging area for this.

> **Diligence flag.** This manual hand-off is the single biggest product
> limitation and the central roadmap bet (§13). It is cleanly isolated: the data
> (drafts, price, images, condition, target marketplaces) is already produced and
> stored; only the *delivery* mechanism is manual.

---

## 7. Feature Specifications — Adjacent

- **Outfits & outfit builder** (`/closet/outfits`): a drag/resize/layer canvas
  persisted as `OutfitLayout` (`{itemId,x,y,scale,z}[]`); outfits feed virtual
  try-on as a unit.
- **SmartPakker** (`/closet/smartpakker`): climate-aware packing. Pure,
  deterministic pipeline (`lib/packing/*`): derive per-category target counts
  from trip length + climate band + rain chance, score items by season/garment
  warmth, select with sensible minimums, then **first-fit-decreasing bin-pack**
  into the user's bags under volume/weight caps. Weight/volume are estimated by a
  heuristic table (category base × material modifier) with per-item overrides.
  Weather via Open-Meteo (keyless) or a deterministic climatology stub.

---

## 8. Image Pipeline & Storage

- **Ingestion:** validated (MIME allow-list: jpeg/png/webp; 10MB cap), EXIF-rotated,
  resized to 1536px max edge, written as mozjpeg + a 400px thumbnail.
- **Canonical render size:** 1024×1366 (3:4 portrait) for generated images.
- **Cutouts:** transparent PNGs (client WASM at ingest; `whitenBackground`
  server-side for ghost results) enable compositing into try-on/outfit shots.
- **Serving:** `/api/images/[...path]` — see §9.2.
- **Backup:** `/api/backup/wardrobe` exports the user's wardrobe (archiver).

---

## 9. Security & Privacy

### 9.1 Authentication — NextAuth (Google OAuth, database sessions)

Sign-in is **NextAuth v4 with Google OAuth**. Sessions use the **database
strategy** — session rows live in the application's own Postgres via the Prisma
adapter (revocable server-side; no JWT secrets to rotate), keeping identity in
the same database as the credit ledger with no per-MAU vendor cost. New users
receive starter credits via the `createUser` event. Sign-out
(`POST /api/logout`) deletes the session row, not just the cookie.

A **demo mode** remains for keyless local development behind an explicit
`AUTH_DEMO_MODE="true"` flag: a single shared user behind a plain cookie. When
the flag is off, the demo entry route returns 404, the landing page hides the
demo button, and stale demo cookies are ignored by `getCurrentUser`.

Remaining hardening: rate limiting on auth endpoints, and CSRF posture review
on server actions (Next's server actions include origin checking; an explicit
review is still warranted before public launch).

### 9.2 Authorization & file serving

- Every server action and the image route call `getCurrentUser`/`requireUser` and
  check `row.userId === user.id`.
- **Image route** (`/api/images/[...path]`): requires a session, **enforces that
  the first path segment equals the caller's user id** (tenant isolation), and
  resolves paths through `resolveUploadPath`, which **rejects traversal** outside
  `uploads/`. Responses are `Cache-Control: private`.
- `resolveUploadPath` is unit-tested against `../` traversal.

### 9.3 Privacy posture

Images persist on the server's local disk and are served only through the
authenticated route. Background removal runs **in-browser** (no upload). The only
data leaving the host is the garment/context image sent to the AI provider
(fal.ai/Fashn) on explicit user action, and the returned render.

### 9.4 Known gaps (candid)

| Gap | Risk | Remediation |
|---|---|---|
| CSRF posture on server actions unreviewed | Session riding | Explicit origin-check review pre-launch (§9.1) |
| Per-IP/auth-endpoint rate limiting absent | Abuse | Add at the edge/proxy pre-launch (AI spend is already quota-capped) |
| `/api/public-image` route exists | Needs review for unauthenticated exposure (used for SerpAPI Lens callbacks) | Audit + signed, expiring URLs |
| Local disk storage | No durability/sharing across instances | Object storage (§11.2) |
| No payment processor | Credits not purchasable | Stripe (§10) |

---

## 10. Monetization Mechanics (current)

A **credit ledger** exists on `User.credits` and meters AI generations:

- New user seeded with 250 credits (~\$10 at ~\$0.04/call).
- Ghost mannequin = 1 credit; fal try-on = 1 credit; Fashn try-on bills on the
  Fashn plan (0 in-app credits).
- **Real-mode crediting is atomic** with the generation log (no charge on
  failure); stub mode logs without debiting.
- "Buy credits" is a **stub** (no payment processor) and "auto-generate on
  upload" is a per-user toggle.

The recommerce feature is **not yet monetized**; §13 outlines the take-rate model.

---

## 11. Productionization Roadmap (Infrastructure)

### 11.1 Database: PostgreSQL — **done**; `Json` columns remaining

The datasource is PostgreSQL 16 (migrations re-baselined; `docker-compose.yml`
for local dev). Remaining: convert JSON-as-text columns to native `Json` — a
deliberate follow-up, since it changes the write contract at every call site of
the `lib/json.ts` helpers — and provision managed Postgres for deployment.

### 11.2 Storage: object storage — **done**

`lib/storage.ts` is a key-based seam with two drivers behind one API
(`putObject` / `getObject` / `objectExists` / `deleteObject` / `deletePrefix` /
`getSignedReadUrl`): **local disk** (default, dev) and **S3/R2** (auto-selected
when `R2_BUCKET` is set). The DB-relative paths already stored on rows are the
object keys, so no data shape changed. On the S3 driver the image routes keep
the per-user authorization check, then **302-redirect to a short-lived signed
URL** so object bytes never transit the app server (a public/CDN base URL via
`R2_PUBLIC_BASE_URL` skips signing). Traversal protection (`safeKey`) applies to
both drivers. The S3 path is covered by an integration check (`pnpm test:s3`,
runs against an in-process S3-compatible server). Remaining for deployment:
provision an R2 bucket + credentials, and optionally front it with a CDN.

### 11.3 Other

- ~~Real auth + sessions~~ — **done** (NextAuth, §9.1). Remaining: CSRF posture review.
- Background job runner for generation (decouple from request lifecycle; enables
  retries, webhooks, batch ghosting).
- ~~Observability~~ — **done at the error/log layer**: structured JSON logging
  (`lib/log.ts`) across services/actions and server-side Sentry forwarding
  (`SENTRY_DSN`, inert when unset). Remaining: metrics/tracing dashboards.
- ~~AI cost guardrails~~ — **done**: per-user + global daily generation quotas
  and an `AI_GENERATIONS_DISABLED` kill switch (`lib/ai-guardrails.ts`),
  enforced before every credit-spending entry point.
- Payments (Stripe) for credits and, later, marketplace take-rate.

---

## 12. Testing & Quality

- **Vitest** suite (currently 75 tests across 10 files) covering: the packing
  algorithm and estimator, listing/closet-sort logic, the upload pipeline +
  path-traversal guard, `whitenBackground` (incl. the halo-cleanup logic), the
  ghost-mannequin camera-angle prompt construction, the virtual-try-on
  contract-routing/description logic, and stub end-to-end image generation.
- **Deterministic core** (pricing, drafts, packing, estimators, prompt builders)
  is pure and fully unit-testable without network or keys.
- `pnpm test:fal` is a real round-trip smoke test against fal.ai.
- **Gaps:** no end-to-end/browser tests of the swipe UX; real-provider paths are
  exercised only by the smoke script (the pure routing/parameter logic around
  them is unit-tested).

---

## 13. Roadmap — Making Sell-by-Swipe the Core

Phased plan to convert the recommerce feature from "drafting utility" into a
defensible marketplace business. Each phase is scoped to the existing
architecture's seams.

**Phase 1 — Reduce hand-off friction (near term).**
- Per-marketplace **URL prefill** where partially possible; clipboard-rich copy
  (formatted title/description/tags) and one-tap deep links.
- Bulk actions on the for-sale board; image export bundles per listing.
- Pricing intelligence: replace the static resale-factor with **sold-comp data**
  (scraper seam already exists) to suggest a market price and sell-through odds.

**Phase 2 — Cross-listing automation.**
- Integrate the marketplaces that *do* have APIs/partner programs (eBay first;
  evaluate Poshmark/Depop/Vinted partner access) behind the existing
  `Marketplace.prefillSupported` flag so the UI lights up per-channel.
- Where no API exists, evaluate authorized automation (official integrations,
  partner feeds) — never ToS-violating scraping.
- Track listing status across channels on `SaleListing` (extend the state
  machine to per-marketplace sub-states).

**Phase 3 — In-app transaction & take-rate.**
- Bring checkout in-app (payments via Stripe Connect), capturing a take-rate on
  GMV instead of (or in addition to) AI credits.
- AI-assisted listing copy (upgrade `buildListingDraft` to an LLM behind the same
  interface), AI condition assessment from photos, and authentication/valuation
  for higher-value items.
- Buyer-side discovery: the structured, ghost-photographed inventory is already a
  clean catalog — surface it to buyers.

**Defensibility.** The moat compounds with data: structured garments + ghost
imagery + wear history + resale outcomes → better pricing, better drafts, and a
buyer-grade catalog that competitors starting from raw photos cannot easily match.

---

## 14. Technical Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Marketplaces offer no listing API; auto-post blocked | **High (strategic)** | Phase 1/2 (§13); start with eBay; authorized integrations only |
| R2 | Demo mode enabled on a real deployment | Medium | Explicit AUTH_DEMO_MODE flag, off by default in production; documented (§9.1) |
| R3 | AI output quality variance (identity/angle/fidelity) | Medium | Dedicated models (idm-vton/SeeDream), strict prompts, env-tunable post-processing; all swapped this cycle |
| R4 | AI cost scaling with usage | Low | Credit metering + per-user/global daily quotas + kill switch (env-tunable) |
| R5 | Single-region object store latency at scale | Low | Storage seam supports S3/R2 + `R2_PUBLIC_BASE_URL` CDN (§11.2) |
| R6 | Provider dependence (fal.ai/Fashn) | Medium | Single-file service seam makes providers swappable; multi-provider already demonstrated |
| R7 | No payment rails | Medium | Stripe integration (§10, §13 Phase 3) |
| R8 | Legal/ToS exposure in cross-listing | Medium | Use official APIs/partner programs only; legal review per channel |

---

## 15. Appendices

### 15.1 Selected environment flags

`USE_REAL_GHOST_MANNEQUIN`, `USE_REAL_VIRTUAL_TRYON`, `FAL_KEY`,
`FAL_GHOST_MODEL`, `FAL_VTON_MODEL`, `FASHN_API_KEY`, `FASHN_TRYON_MODEL`,
`FASHN_TRYON_MODE`, `FASHN_GARMENT_PHOTO_TYPE`, `GHOST_FOOTWEAR_ANGLE`,
`GHOST_APPAREL_ANGLE`, `GHOST_WHITEN_*`, `USE_REAL_VISION`,
`USE_REAL_REVERSE_IMAGE_SEARCH`, `SERPAPI_KEY`, `USE_REAL_PRODUCT_SCRAPER`,
`USE_REAL_WEATHER`, `DATABASE_URL`, `AUTH_DEMO_MODE`, `NEXTAUTH_SECRET`,
`NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `STORAGE_DRIVER`,
`R2_BUCKET`, `R2_ACCOUNT_ID`/`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`/
`R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`. Full list in `.env.example`.

### 15.2 Server-action / route inventory (write surface)

- **Sell:** `setSaleDecision`, `updateSaleListing`, `setSaleStatus`,
  `removeSaleListing`.
- **AI:** `previewGhostMannequin`, `generateGhostFor`, `generateGhostViewFor`,
  `generateVirtualTryOn`, plus ghost-view management.
- **Closet/outfits/packing:** item CRUD, outfit + layout CRUD, trip/bag CRUD.
- **Account:** preferences, credits, danger zone.
- **Routes:** `/api/images/[...path]`, `/api/public-image/[...path]`,
  `/api/demo/enter`, `/api/backup/wardrobe`.

### 15.3 Repository layout

```
app/        App Router pages, route handlers, server actions
  closet/   grid, add flow, item detail, try-on, outfits, sell, smartpakker
  settings/ style prefs, credits
lib/
  services/ external-API seam (ghost mannequin, try-on, vision, search, weather)
  packing/  deterministic SmartPakker algorithm + estimator
  actions/  shared server actions
  sale-listing.ts, marketplaces.ts   recommerce domain logic
  auth.ts, db.ts, uploads.ts, image-paths.ts   infra seams
components/ shared UI
prisma/     schema + migrations + seed
__tests__/  Vitest suites
```

---

*End of specification.*
