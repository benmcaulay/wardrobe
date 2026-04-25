# Wardrobe

Your personal digital closet with **AI-powered ghost-mannequin photos**.
Upload clothing pictures and get back clean, professional studio-style
images — the kind you'd see on a product page — without a photographer.

This is the **foundation build**. Every external service (vision AI, reverse
image search, ghost mannequin) is stubbed behind a clean interface so the full
UX runs end-to-end with no API keys. Background removal is wired up for real,
client-side, via `@imgly/background-removal`.

## Setup

```bash
pnpm install
pnpm prisma migrate dev        # creates dev.db and runs migrations
pnpm db:seed                   # inserts demo user + 8 placeholder items
pnpm dev                       # http://localhost:3000
```

That's it. No keys, no cloud, no docker.

### Scripts

| Script            | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Next.js dev server (`-H 0.0.0.0` for LAN demo)     |
| `pnpm build`      | Production build                                   |
| `pnpm test`       | Run Vitest suite once                              |
| `pnpm test:watch` | Vitest in watch mode                               |
| `pnpm db:seed`    | Re-run the seed script (idempotent)                |
| `pnpm db:reset`   | Drop and re-create the SQLite DB, then re-seed     |

## How the demo user works

Auth is intentionally fake for now. The landing page (`/`) has an "Enter demo"
button that sets a cookie (`wardrobe_demo_uid`) pointing at a single user
(`demo@local.test`) created by the seed script with **100 ghost-mannequin
credits**. `middleware.ts` redirects any protected route back to `/` when the
cookie is missing.

To add a real auth provider, replace the three functions in `lib/auth.ts`
(`getCurrentUser`, `requireUser`, `getOrCreateDemoUser`) with NextAuth / Clerk
equivalents. The rest of the app only touches those helpers.

## How an upload becomes a ghost mannequin

1. **Pick** a photo (drag-drop or camera).
2. **Crop** to a square (`react-easy-crop`).
3. The cropped image goes through two parallel passes:
   - Server: `saveUpload` → vision tagging → reverse-image search → product scrape (all stubbed).
   - Client: `@imgly/background-removal` strips the background to a transparent PNG, then `saveCutoutFromClient` server-action saves it.
4. The confirmation form shows the original + cutout side-by-side, all metadata pre-filled.
5. Optional checkbox: **Create a ghost-mannequin photo** (1 credit). When checked, the save action also calls `generateGhostFor` which composites the cutout onto a neutral 3D mannequin frame.
6. The closet grid prefers ghost > cutout > original; ghost-mannequin tiles get a small ✨ badge.
7. The item detail page has a 3-button carousel (Original / Cutout / Ghost) and a "Generate ghost mannequin" button if it wasn't generated at upload time.

## Credits

| | |
|---|---|
| Free credits per new user | **100** (seed default; change in `prisma/seed.ts`) |
| Cost per ghost mannequin  | **1 credit ≈ $0.02** with the real fal.ai provider |
| Behavior in stub mode     | Generations log to `TryOnGeneration` but `User.credits` is **not** decremented, so the demo never runs out |
| Behavior in real mode     | `User.credits` decremented atomically with the row insert |
| Mode switch               | Set `USE_REAL_GHOST_MANNEQUIN="true"` in `.env.local` |

The credit balance shows in the closet header (`✨ N`, amber when < 10) and in
Settings, with a Buy-credits stub and an "Auto-generate on upload" toggle.

## Replacing stubs with real services

Every external capability lives in `lib/services/*.ts` with a stable signature.
Swapping in a real API only edits one file.

| Service file                           | Purpose                                       | Suggested providers                                                  | Env vars                                                     |
| -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `lib/services/vision.ts`               | Garment category / color / style tagging      | Anthropic Claude Vision, OpenAI Vision, Google Vision AI             | `USE_REAL_VISION`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`     |
| `lib/services/reverseImageSearch.ts`   | Find matching products online                 | SerpAPI (Google Lens), Bing Visual Search, TinEye                    | `USE_REAL_REVERSE_IMAGE_SEARCH`, `SERPAPI_KEY`               |
| `lib/services/productScraper.ts`       | Pull price / brand / material from a URL      | ScrapingBee, Bright Data, Apify, custom fetcher                      | `USE_REAL_PRODUCT_SCRAPER`, `SCRAPINGBEE_API_KEY`            |
| `lib/services/ghostMannequin.ts`       | Composite a garment onto a 3D mannequin       | fal.ai OOTDiffusion, Replicate IDM-VTON, fal.ai CatVTON              | `USE_REAL_GHOST_MANNEQUIN`, `FAL_KEY`, `REPLICATE_API_TOKEN` |
| `lib/services/backgroundRemoval.ts`    | Transparent-background cutouts (server fall-back) | remove.bg, Photoroom, Replicate rembg                               | `USE_REAL_BACKGROUND_REMOVAL`, `REMOVE_BG_API_KEY`           |
| `lib/client/background-removal.ts`     | Transparent-background cutouts (live, client) | `@imgly/background-removal` (already wired)                          | none — runs free in-browser via WASM                         |

See `.env.example` for the full list of phase-2 vars.

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
components/
  item-form-fields.tsx, image-cropper.tsx, closet-filters.tsx,
  style-prefs-editor.tsx
prisma/
  schema.prisma       Data model (User, WardrobeItem, TryOnGeneration)
  seed.ts             Demo user (100 credits) + 8 placeholder items
uploads/              User-uploaded files (gitignored). Served via /api/images.
__tests__/            Vitest suites
```

## Privacy

In stub mode every image stays on this machine — the `uploads/` directory,
served by a local authenticated route, plus the bg-removal WASM runs in-browser.
Nothing leaves your computer. When you flip a `USE_REAL_*` flag, that one
provider will see the image you send it; check its privacy policy.
