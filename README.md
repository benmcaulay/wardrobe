# Wardrobe

Your personal digital closet with **AI-powered ghost-mannequin photos**.
Upload clothing pictures and get back clean, professional studio-style
images — the kind you'd see on a product page — without a photographer.

Background removal runs for real, free, client-side via
`@imgly/background-removal`. Ghost mannequin generation runs for real on
[fal.ai](https://fal.ai) (Gemini 2.5 Flash Image / Edit) when you set
`FAL_KEY` and `USE_REAL_GHOST_MANNEQUIN="true"`; otherwise it falls back to
a stub composite. Vision, reverse-image search, and product scraping are
still stubbed.

## Quick start (stub mode — no keys)

```bash
pnpm install
pnpm prisma migrate dev        # creates dev.db and runs migrations
pnpm db:seed                   # inserts demo user + 8 placeholder items
pnpm dev                       # http://localhost:3000
```

That's it. No keys, no cloud, no docker.

## Production setup (real ghost mannequin)

Get a fal.ai key from <https://fal.ai/dashboard/keys>, load it with credit,
then put it in a local `.env` (gitignored — never commit):

```
DATABASE_URL="file:./dev.db"
USE_REAL_GHOST_MANNEQUIN="true"
FAL_KEY="<your-fal-key>"
# optional override (default: fal-ai/gemini-25-flash-image/edit)
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
| `fal-ai/gemini-25-flash-image/edit` *(default)* | ~$0.04   | Multi-image refs, 3–5s             |
| `fal-ai/flux-pro/kontext`                  | ~$0.04        | Strong prompt fidelity               |
| `fal-ai/flux-pro/kontext/max/multi`        | ~$0.08        | Up to 4 refs, max quality            |
| `fal-ai/seedream/v4/edit`                  | ~$0.03        | ByteDance SeedDream                  |

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
| `pnpm db:seed`     | Re-run the seed script (idempotent)            |
| `pnpm db:reset`    | Drop and re-create the SQLite DB, then re-seed |

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
| Cost per ghost mannequin  | **1 credit ≈ $0.04** with `gemini-25-flash-image/edit` |
| Behavior in stub mode     | Generations log to `TryOnGeneration` but `User.credits` is **not** decremented |
| Behavior in real mode     | API call first; on success, `User.credits` decremented atomically with the row insert (no double-charge if the call fails) |
| Mode switch               | `USE_REAL_GHOST_MANNEQUIN="true"` + `FAL_KEY="…"` in `.env` |

The credit balance shows in the closet header (`✨ N`, amber when < 10) and
in Settings, with a Buy-credits stub and an "Auto-generate on upload" toggle.

## How the demo user works

Auth is intentionally fake. The landing page (`/`) has an "Enter demo"
button that sets a cookie pointing at a single user (`demo@local.test`)
created by the seed script. `middleware.ts` redirects any protected
route back to `/` when the cookie is missing.

To add a real auth provider, replace the three functions in `lib/auth.ts`
(`getCurrentUser`, `requireUser`, `getOrCreateDemoUser`) with NextAuth /
Clerk equivalents. The rest of the app only touches those helpers.

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

## Privacy

Every image you upload stays on this machine — the `uploads/` directory,
served by a local authenticated route. The background-removal WASM runs
in-browser. The only payload that leaves your computer is the garment
(and any context shots) sent to fal.ai when you click **Generate ghost
mannequin**, plus the result image we download back. Check fal.ai's
[privacy policy](https://fal.ai/privacy-policy) before uploading sensitive
images.
