# Wardrobe

Your personal digital closet with **AI-powered ghost-mannequin photos**
and **virtual try-on**. Upload clothing pictures and get back clean,
professional studio-style images — the kind you'd see on a product page —
or upload a few photos of yourself and see how a saved outfit looks on you,
without a photographer.

Background removal runs for real, free, client-side via
`@imgly/background-removal`. Ghost mannequin generation runs for real on
[fal.ai](https://fal.ai) (SeedDream v4 Edit by default) when you set
`FAL_KEY` and `USE_REAL_GHOST_MANNEQUIN="true"`; otherwise it falls back to
a stub composite. Virtual try-on runs on Fashn (`FASHN_API_KEY`) or fal.ai
(`fal-ai/idm-vton` by default). Vision, reverse-image search, and product scraping are
still stubbed.

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

Get a fal.ai key from <https://fal.ai/dashboard/keys>, load it with credit,
then put it in a local `.env` (gitignored — never commit):

```
DATABASE_URL="postgresql://user:password@host:5432/wardrobe"
USE_REAL_GHOST_MANNEQUIN="true"
FAL_KEY="<your-fal-key>"
# optional override (default: fal-ai/seedream/v4/edit)
# FAL_GHOST_MODEL="fal-ai/flux-pro/kontext"
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

### Cost reference (fal.ai)

| Model                                      | ~Cost / image | Notes                                |
| ------------------------------------------ | ------------- | ------------------------------------ |
| `fal-ai/seedream/v4/edit` *(default)*      | ~$0.03        | ByteDance SeedDream, strong prompt adherence |
| `fal-ai/gemini-25-flash-image/edit`        | ~$0.04        | Multi-image refs, 3–5s               |
| `fal-ai/flux-pro/kontext`                  | ~$0.04        | Strong prompt fidelity               |
| `fal-ai/flux-pro/kontext/max/multi`        | ~$0.08        | Up to 4 refs, max quality            |

Switch by setting `FAL_GHOST_MODEL`. The seed gives the demo user **250
credits** (~$10 budget at $0.04/call). Adjust in `prisma/seed.ts` or
`lib/auth.ts` (the user-default).

### Scripts

| Script             | What it does                                   |
| ------------------ | ---------------------------------------------- |
| `pnpm dev`         | Next.js dev server                             |
| `pnpm build`       | Production build                               |
| `pnpm start`       | Production server (`next start`)               |
| `pnpm test`        | Vitest suite (uses stubs)                      |
| `pnpm test:watch`  | Vitest in watch mode                           |
| `pnpm test:fal`    | Real fal.ai round-trip smoke (needs `.env`)    |
| `pnpm test:s3`     | S3/R2 storage-driver integration check         |
| `pnpm db:seed`     | Re-run the seed script (idempotent)            |
| `pnpm db:reset`    | Drop and re-create the database, then re-seed  |

## How an upload becomes a ghost mannequin

1. **Pick** a photo (drag-drop or camera).
2. **Crop** to a square (`react-easy-crop`).
3. The cropped image goes through two parallel passes:
   - Server: `saveUpload` → vision tagging → reverse-image search → product scrape.
   - Client: `@imgly/background-removal` strips the background to a transparent PNG, then `saveCutoutFromClient` saves it server-side.
4. The confirmation form shows the original + cutout side-by-side, metadata pre-filled.
5. Optional **Generate ghost mannequin** button (1 credit). Sends the cutout (preferred) or original — plus any **Context images** the user attaches — to fal.ai. The result drops into the third preview slot.
6. Save persists the WardrobeItem with all paths and logs a `TryOnGeneration` row. Credits already debited at preview-time in real mode.
7. The closet grid prefers ghost > cutout > original; ghost tiles get a small ✨ badge. The item detail page has a 3-button carousel and a "Generate ghost mannequin" button for items added without one.

## Credits

| | |
|---|---|
| Free credits per new user | **250** (~$10 at ~$0.04/call) |
| Cost per ghost mannequin  | **1 credit ≈ $0.03** with `seedream/v4/edit` (default) |
| Behavior in stub mode     | Generations log to `TryOnGeneration` but `User.credits` is **not** decremented |
| Behavior in real mode     | API call first; on success, `User.credits` decremented atomically with the row insert (no double-charge if the call fails) |
| Mode switch               | `USE_REAL_GHOST_MANNEQUIN="true"` + `FAL_KEY="…"` in `.env` |

The credit balance shows in the closet header (`✨ N`, amber when < 10) and
in Settings, with a Buy-credits stub and an "Auto-generate on upload" toggle.

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
| `lib/services/ghostMannequin.ts` ✅     | Composite a garment as a ghost mannequin      | fal.ai (Gemini 2.5 Flash Image / Flux Kontext / SeedDream)           | `USE_REAL_GHOST_MANNEQUIN`, `FAL_KEY`, `FAL_GHOST_MODEL`     |
| `lib/client/background-removal.ts` ✅   | Transparent-background cutouts (live, client) | `@imgly/background-removal` (already wired)                          | none — runs free in-browser via WASM                         |
| `lib/services/vision.ts`               | Garment category / color / style tagging      | Anthropic Claude Vision, OpenAI Vision, Google Vision AI             | `USE_REAL_VISION`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`     |
| `lib/services/reverseImageSearch.ts`   | Find matching products online                 | SerpAPI (Google Lens), Bing Visual Search, TinEye                    | `USE_REAL_REVERSE_IMAGE_SEARCH`, `SERPAPI_KEY`               |
| `lib/services/productScraper.ts`       | Pull price / brand / material from a URL      | ScrapingBee, Bright Data, Apify, custom fetcher                      | `USE_REAL_PRODUCT_SCRAPER`, `SCRAPINGBEE_API_KEY`            |
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
  storage.ts          Storage seam (local disk | S3/R2), key-based API
  uploads.ts          File pipeline (sharp resize, thumbnails, cutout PNGs)
  image-paths.ts      Pure URL helpers, safe for client bundles
components/           Shared UI (item form, cropper, filters, prefs editor, carousel)
prisma/
  schema.prisma       Data model (User, WardrobeItem, TryOnGeneration)
  seed.ts             Demo user (250 credits) + 8 placeholder items
scripts/
  test-fal.ts         Real fal.ai round-trip smoke; `pnpm test:fal`
uploads/              User-uploaded files (gitignored). Served via /api/images.
__tests__/            Vitest suites
```

## Storage

Image files go through a key-based seam (`lib/storage.ts`) with two drivers:

- **local** (default): files under `uploads/`, served by the authenticated
  image routes. Zero config — great for dev and self-hosting.
- **s3**: any S3-compatible store, built for **Cloudflare R2**. Set
  `STORAGE_DRIVER="s3"` (auto when `R2_BUCKET` is set) plus the `R2_*`
  credentials in `.env`. The image routes then 302-redirect to short-lived
  signed URLs so object bytes bypass the app server.

The DB-relative paths stored on rows are the object keys, so switching drivers
needs no data migration. Verify the s3 path with `pnpm test:s3` (runs against an
in-process S3 server; `docker compose --profile s3 up -d` also provides MinIO).

## Privacy

With the local driver, every uploaded image stays on the host (`uploads/`,
served by an authenticated route); with the s3 driver they live in your bucket.
The background-removal WASM runs in-browser. The only payload that leaves your
infrastructure is the garment (and any context shots) sent to fal.ai/Fashn on
**Generate**, plus the result image downloaded back. Check the provider privacy
policies before uploading sensitive images.
