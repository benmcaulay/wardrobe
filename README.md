# Wardrobe

Your personal digital closet with **AI-powered ghost-mannequin photos**
and **virtual try-on**. Upload clothing pictures and get back clean,
professional studio-style images — the kind you'd see on a product page —
or upload a few photos of yourself and see how a saved outfit looks on you,
without a photographer.

Background removal runs for real, free, client-side via
`@imgly/background-removal`. Ghost mannequin generation runs for real on
Google Gemini when you set `GEMINI_API_KEY` and
`USE_REAL_GHOST_MANNEQUIN="true"`; otherwise it falls back to a stub composite.

**Gemini runs almost everything**, with two deliberate exceptions, both because
gemini measurably cannot do the job:

- **Footwear** renders on fal Seedream v4 edit. Gemini will not obey the
  shoes-upright-at-45°-side-by-side pose — flash mirrors the pair sole-to-sole,
  pro floats them tilted, both with the instruction as the first rule in the
  prompt. Set `FAL_KEY` for that path; without it footwear falls back to gemini
  and is posed worse.
- **Product lookup** uses SerpAPI. Gemini has no web access, so it can name a
  garment but not price or link it — and a fabricated price silently corrupts the
  wishlist budget. `SERPAPI_KEY` alone enables the text lane (Google Shopping);
  the Google Lens photo-match lane also needs `PUBLIC_APP_URL` +
  `PUBLIC_IMAGE_SECRET`, since SerpAPI has to fetch the image itself and cannot
  reach localhost. Without a key, lookup degrades to gemini identification:
  name and brand, no price, no URL.

Virtual try-on, garment classification, trip parsing, and style-note parsing all
run on gemini.

## Quick start (stub mode — no keys)

```bash
pnpm install
docker compose up -d db        # Postgres 16 on localhost:5432
cp .env.example .env           # DATABASE_URL already points at the compose db
pnpm prisma migrate deploy     # applies migrations
pnpm db:seed                   # inserts demo user + 8 placeholder items
pnpm dev                       # http://localhost:3000
```

No API keys needed — AI features run as stubs until you add keys.

## Production setup (real ghost mannequin)

Get a Gemini key from <https://aistudio.google.com/apikey>. **Billing must be
enabled on the Google project** — Google lists Free Tier "Not available" for
every image model, and the API returns `limit: 0` otherwise. Then put it in a
local `.env` (gitignored — never commit):

```
DATABASE_URL="postgresql://user:password@host:5432/wardrobe"
USE_REAL_GHOST_MANNEQUIN="true"
GEMINI_API_KEY="<your-gemini-key>"
# optional: cheapest image model (default: gemini-3.1-flash-image)
# GEMINI_IMAGE_MODEL="gemini-2.5-flash-image"
# optional: footwear renders on fal instead, which poses shoes correctly
# FAL_KEY="<your-fal-key>"
```

Build and run:

```bash
pnpm install
pnpm prisma migrate deploy     # applies migrations on a new machine
pnpm db:seed                   # demo user with 250 credits
pnpm build
pnpm start                     # http://localhost:3000
```

For a quick LAN demo to your phone: `pnpm start -- -H 0.0.0.0`.

To smoke-test the fal.ai round-trip without the UI:

```bash
pnpm test:fal
```

(Picks the first seeded item and generates a ghost mannequin against it.)

### Cost reference

Per generated image, at list price. The app shows the exact figure on every
generate button and totals your spend in Settings.

| Model                                      | ~Cost / image | Notes                                        |
| ------------------------------------------ | ------------- | -------------------------------------------- |
| `gemini-3.1-flash-image` *(default)*       | ~$0.067       | Nano Banana 2, best flash-tier adherence     |
| `gemini-2.5-flash-image`                   | ~$0.039       | Cheapest                                     |
| `gemini-3-pro-image`                       | ~$0.134       | Highest quality                              |
| `fal-ai/bytedance/seedream/v4/edit`        | ~$0.03        | Footwear only — obeys the shoe pose          |

Switch the gemini model with `GEMINI_IMAGE_MODEL`. The seed gives the demo user
**1,000,000 credits** so a local demo never stalls; adjust in `prisma/seed.ts` or
`lib/auth.ts` (the user-default).

### Scripts

| Script             | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `pnpm dev`         | Next.js dev server                             |
| `pnpm build`       | Production build                               |
| `pnpm start`       | Production server (`next start`)               |
| `pnpm test`        | Vitest suite (uses stubs)                      |
| `pnpm test:watch`  | Vitest in watch mode                           |
| `pnpm worker`      | Background generation worker (try-on jobs)     |
| `pnpm test:fal`    | Real ghost round-trip smoke (needs `.env`)     |
| `pnpm test:s3`     | S3/R2 storage-driver integration check         |
| `pnpm test:jobs`   | Job-queue integration check (needs DB)         |
| `pnpm test:stripe` | Credit-purchase fulfillment check (needs DB)   |
| `pnpm eval:ranker` | Offline outfit-ranker evaluation (needs DB)    |
| `pnpm db:seed`     | Re-run the seed script (idempotent)            |
| `pnpm db:reset`    | Drop and re-create the database, then re-seed  |

## How an upload becomes a ghost mannequin

1. **Pick** a photo (drag-drop or camera).
2. **Crop** to a square (`react-easy-crop`).
3. The cropped image goes through two parallel passes:
   - Server: `saveUpload` → vision tagging → reverse-image search → product scrape.
   - Client: `@imgly/background-removal` strips the background to a transparent PNG, then `saveCutoutFromClient` saves it server-side.
4. The confirmation form shows the original + cutout side-by-side, metadata pre-filled.
5. Optional **Generate ghost mannequin** button (1 credit, with the exact dollar cost shown). Sends the cutout (preferred) or original — plus any **Context images** the user attaches — to gemini (or fal for footwear). The result drops into the third preview slot.
6. Save persists the WardrobeItem with all paths and logs a `TryOnGeneration` row. Credits already debited at preview-time in real mode.
7. The closet grid prefers ghost > cutout > original; ghost tiles get a small ✨ badge. The item detail page has a 3-button carousel and a "Generate ghost mannequin" button for items added without one.

## Credits

| | |
|---|---|
| Free credits per new user | **250** (~$10 at ~$0.04/call) |
| Cost per ghost mannequin  | **1 credit ≈ $0.03** with `seedream/v4/edit` (default) |
| Behavior in stub mode     | Generations log to `TryOnGeneration` but `User.credits` is **not** decremented |
| Behavior in real mode     | API call first; on success, `User.credits` decremented atomically with the row insert (no double-charge if the call fails) |
| Mode switch               | `USE_REAL_GHOST_MANNEQUIN="true"` + `GEMINI_API_KEY="…"` in `.env` |

The credit balance shows in the closet header (`✨ N`, amber when < 10) and
in Settings. Credits are purchasable as **Stripe Checkout packs** (Starter
100/$5 · Standard 300/$12 · Studio 1,000/$35 — defined in
`lib/credit-packs.ts`). Set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` and
point a webhook at `/api/stripe/webhook`; without keys the buy buttons are
hidden. Fulfillment is webhook-driven and idempotent (replays can't
double-grant).

## Auth

Real sign-in is **NextAuth with Google OAuth** and database sessions stored
in Postgres (Prisma adapter). Register an OAuth app in Google Cloud Console
(redirect URI `<origin>/api/auth/callback/google`) and set
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, and
`NEXTAUTH_URL`. New users get 250 starter credits on first sign-in.

For keyless local dev there's an explicit **demo mode**
(`AUTH_DEMO_MODE="true"`, on in `.env.example`): the landing page shows an
"Enter demo" button that sets a cookie pointing at a single shared user
(`demo@local.test`). The demo cookie is not a credential — never enable
demo mode on a deployment with real users. Sign-out (both kinds) is
`POST /api/logout`, which also revokes the database session row.

## Replacing the rest of the stubs

Every external capability lives in `lib/services/*.ts` with a stable
signature. Swapping in a real API only edits one file.

| Service file                           | Purpose                                       | Suggested providers                                                  | Env vars                                                     |
| -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `lib/services/ghostMannequin.ts` ✅     | Composite a garment as a ghost mannequin      | Gemini Interactions API *(default)* or fal.ai (SeedDream / Flux Kontext) | `USE_REAL_GHOST_MANNEQUIN`, `GHOST_PROVIDER`, `GEMINI_API_KEY`, `FAL_KEY`, `FAL_GHOST_MODEL` |
| `lib/client/background-removal.ts` ✅   | Transparent-background cutouts (live, client) | `@imgly/background-removal` (already wired)                          | none — runs free in-browser via WASM                         |
| `lib/services/vision.ts`               | Garment category / color / style tagging      | Anthropic Claude Vision, OpenAI Vision, Google Vision AI             | `USE_REAL_VISION`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`     |
| `lib/services/reverseImageSearch.ts`   | Find the product in a photo                   | SerpAPI Google Lens (real prices + URLs, needs a public origin), else gemini vision (name/brand only) | `SERPAPI_KEY`, `PUBLIC_APP_URL`, `PUBLIC_IMAGE_SECRET`, `GEMINI_API_KEY` |
| `lib/services/productScraper.ts`       | Pull price / brand / material from a URL      | Direct fetch + schema.org/Product JSON-LD. No API key                | `USE_REAL_PRODUCT_SCRAPER`                                   |
| `lib/services/backgroundRemoval.ts`    | Server-side bg-removal fallback               | remove.bg, Photoroom, Replicate rembg                                | `USE_REAL_BACKGROUND_REMOVAL`, `REMOVE_BG_API_KEY`           |

✅ = real implementation already wired. See `.env.example` for the full list.

## Project layout

```
app/                  Next.js App Router pages, route handlers, server actions
  closet/             Grid, add flow, item detail (with image carousel)
  settings/           Style prefs, credits, danger zone
lib/
  services/           External-API stub seam (vision, ghost mannequin, …)
  client/             Browser-only helpers (live bg removal)
  actions/            Shared server actions (preferences, ghost mannequin, account)
  auth.ts             Demo-user cookie — replace for real auth
  db.ts               Prisma client singleton
  jobs/               Generation job queue (enqueue, claim, runner, worker loop)
  storage.ts          Storage seam (local disk | S3/R2), key-based API
  uploads.ts          File pipeline (sharp resize, thumbnails, cutout PNGs)
  image-paths.ts      Pure URL helpers, safe for client bundles
components/           Shared UI (item form, cropper, filters, prefs editor, carousel)
prisma/
  schema.prisma       Data model (User, WardrobeItem, TryOnGeneration)
  seed.ts             Demo user (250 credits) + 8 placeholder items
scripts/
  test-fal.ts         Real ghost round-trip smoke; `pnpm test:fal`
uploads/              User-uploaded files (gitignored). Served via /api/images.
__tests__/            Vitest suites
```

## Background jobs

Virtual try-on (especially multi-garment outfits, which chain one provider call
per garment) is too slow to run inside a request on serverless hosts, so it's a
**queued background job**. The UI enqueues via `enqueueVirtualTryOn`, then polls
`getTryOnJobStatus`; a worker executes the job and writes the result.

Run the worker alongside the web server:

```bash
pnpm worker        # polls the GenerationJob queue (Postgres) and runs jobs
```

Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so you can run several workers
safely. Transient failures retry (up to `maxAttempts`); bad input fails
terminally. Ghost-mannequin generation is a single fast call and still runs
synchronously. Verify the queue end-to-end with `pnpm test:jobs`.

## Storage

Image files go through a key-based seam (`lib/storage.ts`) with two drivers:

- **local** (default): files under `uploads/`, served by the authenticated
  image routes. Zero config — great for dev and self-hosting.
- **s3**: any S3-compatible store — **Supabase Storage**, Cloudflare R2, AWS S3,
  or MinIO. Set `STORAGE_DRIVER="s3"` (auto when `S3_BUCKET` is set) plus the
  `S3_*` credentials in `.env`; the older `R2_*` names still work as fallbacks.
  Providers without virtual-host addressing (Supabase, MinIO) also need
  `S3_FORCE_PATH_STYLE="true"`. The image routes then 302-redirect to short-lived
  signed URLs so object bytes bypass the app server. Step-by-step setup:
  [docs/CLOUD_MIGRATION.md](docs/CLOUD_MIGRATION.md).

The DB-relative paths stored on rows are the object keys, so switching drivers
needs no data migration. Verify the s3 path with `pnpm test:s3` (runs against an
in-process S3 server; `docker compose --profile s3 up -d` also provides MinIO).

## Privacy

With the local driver, every uploaded image stays on the host (`uploads/`,
served by an authenticated route); with the s3 driver they live in your bucket.
The background-removal WASM runs in-browser. The payloads that leave your
infrastructure are the garment (plus any context shots) sent to Gemini — or to
fal for footwear — on **Generate**, the result image downloaded back, and the
photos sent to Gemini for classification, product identification, and try-on.
Images go inline in the request body rather than being uploaded to provider
storage. Check the provider privacy policies before uploading sensitive images.
