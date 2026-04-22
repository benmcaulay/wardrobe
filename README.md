# Wardrobe

Your personal digital closet. Upload clothing photos, see them organized, and
(eventually) generate virtual try-on images using reference photos of yourself.

This is the **foundation build** — every external service (vision AI, reverse
image search, virtual try-on) is stubbed behind a clean interface so the whole
UX is testable end-to-end without any API keys.

## Setup

```bash
pnpm install
pnpm prisma migrate dev        # creates dev.db and runs migrations
pnpm db:seed                   # inserts demo user + 8 placeholder items
pnpm dev                       # http://localhost:3000
```

That's it. No keys, no cloud, no docker.

### Scripts

| Script            | What it does                                     |
| ----------------- | ------------------------------------------------ |
| `pnpm dev`        | Next.js dev server                               |
| `pnpm build`      | Production build                                 |
| `pnpm test`       | Run Vitest suite once                            |
| `pnpm test:watch` | Vitest in watch mode                             |
| `pnpm db:seed`    | Re-run the seed script (idempotent)              |
| `pnpm db:reset`   | Drop and re-create the SQLite DB, then re-seed   |

## How the demo user works

Auth is intentionally fake for now. The landing page (`/`) has an "Enter demo"
button that sets a cookie (`wardrobe_demo_uid`) pointing at a single user
(`demo@local.test`) that the seed script creates. `middleware.ts` redirects
any protected route back to `/` when the cookie is missing.

To add a real auth provider later, replace the three functions in `lib/auth.ts`
(`getCurrentUser`, `requireUser`, `getOrCreateDemoUser`) with NextAuth / Clerk
equivalents. The rest of the app only touches those helpers.

## Replacing stubs with real services

Every external capability lives in `lib/services/*.ts` with a stable signature.
The stub returns realistic fake data. To swap in a real API, edit **one file**
and flip the matching `USE_REAL_*` env var. No callers change.

| Service file                           | Purpose                                   | Suggested providers                                                 | Env vars                                                     |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `lib/services/vision.ts`               | Garment category / color / style tagging  | OpenAI Vision, Anthropic Claude Vision, Google Vision AI            | `USE_REAL_VISION`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`     |
| `lib/services/reverseImageSearch.ts`   | Find matching products online             | SerpAPI (Google Lens), Bing Visual Search, TinEye                   | `USE_REAL_REVERSE_IMAGE_SEARCH`, `SERPAPI_KEY`               |
| `lib/services/productScraper.ts`       | Pull price / brand / material from a URL  | ScrapingBee, Bright Data, Apify, custom fetcher                     | `USE_REAL_PRODUCT_SCRAPER`, `SCRAPINGBEE_API_KEY`            |
| `lib/services/virtualTryOn.ts`         | Composite a garment onto a reference photo | Kling AI VTON, Replicate (IDM-VTON), fal.ai (CatVTON), Vertex Imagen | `USE_REAL_VIRTUAL_TRY_ON`, `REPLICATE_API_TOKEN`, `FAL_KEY`  |
| `lib/services/backgroundRemoval.ts`    | Transparent-background cutouts            | remove.bg, Photoroom, Replicate (rembg)                             | `USE_REAL_BACKGROUND_REMOVAL`, `REMOVE_BG_API_KEY`           |

See `.env.example` for the full list.

## Project layout

```
app/              Next.js App Router pages and route handlers
lib/
  services/       Stubbed external APIs (swap one file to go live)
  auth.ts         Demo-user cookie helpers — replace for real auth
  db.ts           Prisma client singleton
prisma/
  schema.prisma   Data model
  seed.ts         Demo user + placeholder items
uploads/          User-uploaded files (gitignored). Served via /api/images.
__tests__/        Vitest suites
```

## Privacy

During the foundation phase, every image you upload stays on this machine —
the `uploads/` directory, served by a local route. Nothing leaves your
computer. When you switch on a real service via `USE_REAL_*`, that service
will see the image you send it; check its privacy policy.
