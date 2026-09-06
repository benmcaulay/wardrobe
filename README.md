# MAKING SPACE

**Own less of it, wear more of it.**

A personal digital closet with **AI-powered ghost-mannequin photos** and
**virtual try-on**. Upload clothing pictures and get back clean, professional
studio-style images — the kind you'd see on a product page — or upload a few
photos of yourself and see how a saved outfit looks on you, without a
photographer.

Then the other half: the **Space** ledger (`/closet/space`) reports what came in,
what went out, and roughly how much hanging rail that freed — four separate
figures, never fused into a score. The closet grid holds a piece's slot open for
a beat before closing it, the **Rail** view lays the closet out on a
time-since-worn axis so the gaps are visible, and the app has a night backdrop
called **Space** to go with the name.

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
  `IMAGE_SECRET`, since SerpAPI has to fetch the image itself and cannot
  reach localhost. Without a key, lookup degrades to gemini identification:
  name and brand, no price, no URL.

Virtual try-on, garment classification, trip parsing, and style-note parsing all
run on gemini.

The product is **MAKING SPACE**; the codebase is still `wardrobe`. The package
name, the repo, the `WardrobeItem` model, the local database and the
`WARDROBE_USER_EMAIL` env var all keep their old names on purpose — renaming
them means a migration and a broken import script for no user-visible gain. The
display name lives in [lib/brand.ts](lib/brand.ts).

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

### Deploying somewhere other than this machine

`.env` is gitignored and never leaves the laptop, so a host needs these set in
its own environment. The first two are not optional — NextAuth throws
`[next-auth][error][NO_SECRET]` on every page in production without a secret,
where in dev it is only a warning.

| Variable | Why |
| --- | --- |
| `NEXTAUTH_SECRET` | Signs session tokens. Generate one per environment: `openssl rand -base64 32`. Rotating it invalidates every existing session. |
| `NEXTAUTH_URL` | The deployed origin, e.g. `https://wardrobe.example.com`. Wrong value breaks the OAuth callback. |
| `AUTH_DEMO_MODE` | Ignored in production — demo mode refuses to run there whatever this says, so a stray `"true"` cannot open the shared account. Leave it unset on a host anyway. |
| `DATABASE_URL` | Postgres. |
| `GEMINI_API_KEY` | The only paid AI provider. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Real sign-in. Authorized redirect URI is `<origin>/api/auth/callback/google`. |
| S3/R2 vars | Object storage; the local disk driver does not survive a redeploy. |

`CRON_SECRET` is also required on any host where Vercel Cron drains the queue —
see below.

#### Vercel

`vercel.json` schedules `/api/cron/drain` nightly at 03:00. That endpoint *is* the
worker: Vercel has nowhere to run `pnpm worker`, and `kickJobDrain` is
fire-and-forget after the response, which a serverless function may freeze
before finishing. The route reuses the same claim/lease/`runJob` path as the
CLI worker rather than reimplementing it.

- **A per-minute cron needs Pro.** Hobby allows one cron run *per day* and
  *fails the deployment* on anything more frequent — including hourly. That is
  why the committed schedule is `"0 3 * * *"`. On Hobby the cron is a nightly
  backstop rather than a worker: imports lean on the best-effort inline drain,
  and whatever it misses waits until 03:00. To close that gap without Pro,
  drive `/api/cron/drain` from an external pinger with the `CRON_SECRET`.
- **`CRON_SECRET` must be set.** Vercel sends it as `Authorization: Bearer`.
  Without it the route returns 503 and drains nothing — draining spends Gemini
  credits, so it fails closed rather than running open.
- **`STORAGE_DRIVER="s3"`** with the S3/R2 variables. The local disk driver
  writes under `./uploads`, which does not survive a deploy.
- **`maxDuration` is 300s** for the drain (`vercel.json`). One ghost is
  ~12–48s against a 120s ceiling; the route stops *starting* jobs at 240s so
  the last one finishes inside the limit, and reports `more: true` when the
  queue still holds work.
- The native ML packages are excluded from function bundles via
  `outputFileTracingExcludes` — onnxruntime-node alone is 283 MB against a
  250 MB unzipped limit. They are reached through a guarded lazy import, so a
  host without them behaves exactly as it does when the models are unstaged.

#### Google sign-in

The one step no script can do for you — the OAuth client has to be created by
hand in a browser. The console moved this out of *APIs & Services > Credentials*
into **Google Auth Platform**, so older instructions point at pages that no
longer exist.

1. **Project** — <https://console.cloud.google.com/projectcreate>, or reuse one.
2. **Branding** — <https://console.cloud.google.com/auth/branding>. Set an app
   name, user support email and developer contact, then save. Clients cannot be
   created until this exists.
3. **Audience** — <https://console.cloud.google.com/auth/audience>. User type
   **External**. Leave publishing status on *Testing*.
4. **Clients** — <https://console.cloud.google.com/auth/clients> → **Create
   client** → application type **Web application**. Fill in only:

   | Field | Value |
   | --- | --- |
   | Authorized redirect URIs | `<origin>/api/auth/callback/google` |
   | Authorized redirect URIs | `http://localhost:3000/api/auth/callback/google` |
   | Authorized JavaScript origins | *leave empty* |

   Matching is exact: no trailing slash, and `http` vs `https` matters. Only the
   canonical origin needs registering — if `www` 308-redirects to the apex, the
   callback always lands on the apex.

   JavaScript origins are for the browser-side implicit flow. NextAuth uses the
   server-side authorization-code flow, so leaving that field empty is correct,
   not an omission.

5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

**Testing mode is not a limitation here.** Its usual costs — 100 test users,
consent warnings, 7-day token expiry — apply to apps requesting sensitive
scopes. `next-auth/providers/google` requests `openid email profile` and
nothing else, which Google treats as non-sensitive: no test users to enrol, no
"Google hasn't verified this app" screen, no expiring authorizations, and no
verification review. Publish the app only if you want it listed; it is not
needed for sign-in to work.

Who may actually sign in is enforced by `AUTH_ALLOWED_EMAILS`, not by Google.


Two things do **not** work off this machine, by construction:

- **Browse photos of me** shells out to `osxphotos` against the local Photos
  library. It hides itself behind `photosAvailable()` elsewhere, so the mode
  degrades to a message rather than erroring.
- **The job worker** (`pnpm worker`) is a separate process with no supervision.
  Nothing generates ghosts while it is down, and `claimNextJob` has no job-type
  affinity, so a worker that cannot reach this machine's models will still
  claim work that needs them.


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
(`demo@local.test`). The cookie is not a credential and the account is shared,
so `demoModeEnabled()` returns false under `NODE_ENV=production` whatever the
variable says — the button disappears, `/api/demo/enter` 404s, and an existing
cookie stops counting as a session. There is deliberately no override; a demo
real people can reach needs a throwaway account per visitor, which is a
different feature. Sign-out (both kinds) is `POST /api/logout`, which also
revokes the database session row.

## Replacing the rest of the stubs

Every external capability lives in `lib/services/*.ts` with a stable
signature. Swapping in a real API only edits one file.

| Service file                           | Purpose                                       | Suggested providers                                                  | Env vars                                                     |
| -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `lib/services/ghostMannequin.ts` ✅     | Composite a garment as a ghost mannequin      | Gemini Interactions API *(default)* or fal.ai (SeedDream / Flux Kontext) | `USE_REAL_GHOST_MANNEQUIN`, `GHOST_PROVIDER`, `GEMINI_API_KEY`, `FAL_KEY`, `FAL_GHOST_MODEL` |
| `lib/client/background-removal.ts` ✅   | Transparent-background cutouts (live, client) | `@imgly/background-removal` (already wired)                          | none — runs free in-browser via WASM                         |
| `lib/services/vision.ts`               | Garment category / color / style tagging      | Anthropic Claude Vision, OpenAI Vision, Google Vision AI             | `USE_REAL_VISION`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`     |
| `lib/services/reverseImageSearch.ts`   | Find the product in a photo                   | SerpAPI Google Lens (real prices + URLs, needs a public origin), else gemini vision (name/brand only) | `SERPAPI_KEY`, `PUBLIC_APP_URL`, `IMAGE_SECRET`, `GEMINI_API_KEY` |
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
