# Outfit Intelligence

A plan for learning outfit preferences from wear data, using it to auto-complete
outfits, and surfacing underutilized pieces without ever telling a user to sell
something.

## Four principles

Everything below follows from these. When a decision is ambiguous, resolve it
against this list.

1. **The prior does the work; wear data refines it.** Closets are islands — no
   cross-user pooling — so a new user has zero history and a new item has zero
   wears. Compatibility must be computable from features alone on day one.
   Personalization is a thin, heavily-regularized residual on top, not the
   engine.
2. **Risk is budgeted at the slate, not the item.** Never make one risky
   suggestion. Make three suggestions where two are safe and one stretches. This
   is the only place exploration happens, and it is also the entire
   utilization-boosting mechanism — they are one system, not two features.
3. **Observe, never prescribe.** The system reports facts about items ("last
   worn 14 months ago", "you own four similar white tees", "pieces like this
   resell around $X"). It never says "sell this." The user assembles the
   decision.
4. **Every signal carries a confidence.** Passive inference is noisy. A wear is
   not a boolean, it is a weighted observation. Nothing in the model may assume
   integer wear counts.

## Settled scope

- **Inference runs on-device (in-browser).** See §3 for what that costs.
- **Fit and proportion are out of scope.** Not "later" — out. No data is collected
  on how garments fit *together*, the judgement is hard to quantify even for
  people, and a small in-browser model has no business attempting it. Excluding it
  also removes an entire class of confidently-wrong suggestion.
- **No calendar integration.** Camera roll is the data source; occasion labels come
  from the wear-confirmation tap (§7).
- **Occasion is a fixed enum**, defined in §7.
- **No global style prompt.** Replaced by per-note rules (§9) — blanket style
  statements are largely redundant with the closet, and CLIP cannot represent a
  negation like "not with that shirt".
- **Household wears do not cross-train affinity.** Person B wearing a coat says
  nothing about person A's taste. Affinity models stay per-wearer; compatibility
  is shared across the household, since whether two garments go together is not a
  matter of whose they are. Multi-wearer items are still insulated from dormancy
  surfacing (§6).
- **Protected-item UI is deferred.** Ship the field, skip the interface. The
  suppression rules in §6 already reference it, and the protect-rate guardrail in
  §8 needs somewhere to write. Adding a boolean now costs nothing; retrofitting a
  concept the scoring code assumed exists costs a migration.

## 1. Signals

Two distinct kinds of evidence, which train different parameters and must not be
conflated:

- **Affinity** — how much the user likes an *item*. Item-level scalar.
- **Compatibility** — how well items work *together*. Pair- and set-level.

A saved outfit is primarily compatibility evidence. A locked slot is primarily
affinity evidence. Treating a save as five affinity votes is the standard way to
get a recommender that only ever suggests your five favourite things.

| Signal | Source | Trains | Polarity | Confidence |
| --- | --- | --- | --- | --- |
| Explicit "wore this" | mark-worn action | affinity + compat | + | 1.0 |
| Photo-inferred wear | camera roll match | affinity + compat | + | 0.2–0.6 |
| User confirms inferred wear | confirmation prompt | both | + | → 1.0 |
| Outfit saved | `Outfit` create | **compatibility** | + | 0.9 |
| Slot locked in builder | `lockedItemId` | **affinity** | + | 0.7 |
| Reroll / "show me another" | builder | compatibility | − | 0.6 |
| Suggestion dismissed | daily proposal | both | − | 0.7 |
| Virtual try-on generated | `VirtualTryOn` | affinity (curiosity) | + | 0.3 |
| Tried on, never worn (90d) | derived | affinity | − | 0.3 |
| Packed for a trip | `PackingBag` | affinity | + | 0.4 |
| Listed for sale | `SaleListing` | affinity | −− terminal | 1.0 |
| Wishlist → purchased | derived | style direction | + | 0.8 |

The reroll is the most valuable signal in the table and currently does not exist.
Every reroll is a clean pairwise comparison — *chosen ≻ rejected*, under identical
context — which is exactly the input a Bradley-Terry model wants. Choice data is
worth several times its weight in wear counts because it is contrastive and
context-controlled. Build the reroll button before anything else in Phase 2.

## 2. Data model

### `WearEvent`

The foundation. A scalar counter is a lossy projection of a sequence, and the
sequence cannot be recovered later.

Items hang off a `WearEventItem` join table rather than the JSON-array
convention used by `Outfit.itemIds`. Per-item history is the hottest read in the
system — every rollup, dormancy score, and recurrence gap walks it — and a JSON
string can only be searched with an unindexed `LIKE`, which is O(items × events)
across a closet. Grouping the join table by `wearEventId` still gives the
set-level "these were worn together" view that compatibility learns from.

```prisma
model WearEvent {
  id         String   @id @default(cuid())
  userId     String
  wornOn     DateTime @db.Date        // date, not timestamp — wears are day-grained
  items      WearEventItem[]
  outfitId   String?

  source     String                   // "explicit" | "photo" | "packing" | "backfill"
  confidence Float    @default(1.0)   // 0..1 — never assume 1
  confirmedAt DateTime?               // set when user validates an inference

  // context — the whole point of the table
  tempHighC   Float?
  climateBand String?                 // reuse ClimateBand from lib/services/weather.ts
  precipMm    Float?
  occasion    String?
  wearerId    String?                 // from the `owners` roster
  placeLabel  String?

  createdAt  DateTime @default(now())

  @@index([userId, wornOn])
  @@index([userId, source])
}
```

`WardrobeItem.timesWorn` and `lastWornAt` become **denormalized mirrors** of this
table, kept in sync so every existing screen keeps working. This is the same
pattern already documented for `SaleListing.marketplaces` vs `ListingPlacement`.
Add `effectiveWears Float` alongside `timesWorn` for the confidence-weighted sum —
`timesWorn` stays the integer count of high-confidence wears so user-facing copy
stays honest.

### `PreferenceEvent`

Thin, high-signal interaction log. Separate from wears because these are
*choices*, not *behaviour*, and they carry the propensity needed for off-policy
evaluation.

```prisma
model PreferenceEvent {
  id         String   @id @default(cuid())
  userId     String
  kind       String   // "lock" | "reroll" | "save" | "dismiss" | "protect" | "accept"
  itemIds    String   // JSON: string[]
  contextJson String?
  policyId   String?  // which ranker produced the thing being reacted to
  propensity Float?   // P(this was shown | policy) — enables IPS/SNIPS offline eval
  createdAt  DateTime @default(now())

  @@index([userId, kind])
}
```

`policyId` and `propensity` cost one column each and are impossible to add
retroactively. Without them, every future ranker change requires a live A/B test.

### `ItemEmbedding`

Computed on-device (§3) and uploaded as a vector — the source image never leaves
the client for camera-roll photos. Cached server-side so other devices don't
re-embed.

**Not pgvector.** Choosing on-device inference removed the reason for it: all
scoring and similarity happen in the browser, so the server never computes a
distance and is purely a sync store. Raw little-endian float32 in a `BYTEA` is
2 KB per item, needs no extension, and needs no change to `docker-compose.yml`
(which runs stock `postgres:16`). If a server-side similarity need ever appears,
adding pgvector is its own migration rather than a dependency taken on spec.

```prisma
model ItemEmbedding {
  itemId    String   @id
  vector    Bytes    // little-endian float32, normalized on write
  dims      Int      @default(512)
  model     String   // "mobileclip-s2-int8" — for invalidation on upgrade
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### `WardrobeItem` additions

```prisma
effectiveWears Float     @default(0)  // confidence-weighted; timesWorn stays the integer count
protectedAt    DateTime?              // never surface in dormancy — field now, UI later
```

## 3. Where inference runs — on-device

**Decision: on-device.** This is a plain Next.js web app with no native wrapper,
so on-device means **in-browser** — ONNX Runtime Web or transformers.js, WebGPU
with a WASM fallback.

The driving reason is §7: wear inference works by scanning the user's camera roll,
which is the most privacy-sensitive operation in the product. Photos that are
never uploaded cannot leak, cannot be subpoenaed, and do not need a retention
policy. That is a real product claim, not a compromise. Note this diverges from
the *existing* camera-roll scan (`lib/camera-roll-scan-types.ts`), which uploads
batches to a server job — the wear scan must not reuse that path.

### What this constrains

| | Server-side (rejected) | On-device (chosen) |
| --- | --- | --- |
| Model | SigLIP so400m, ~1.6 GB | MobileCLIP-S2 / CLIP ViT-B/32, int8 |
| Dimension | 768 | **512** |
| First-run cost | none | ~40–90 MB model download |
| Per-item cost | GPU inference billed | free |
| Camera roll | uploaded | **never leaves the device** |
| Embedding quality | higher | capped |

### One model, both jobs

Camera-roll matching and closet-item embedding must share an embedding space, or
you cannot compare a garment cropped from a photo against a closet item. So the
small model is used for **both**, and the quality cap applies everywhere — not
just to the camera roll.

Compensate by leaning harder on the structured attributes already stored on
`WardrobeItem`: `colors`, `pattern`, `material`, `category`, `styleTags`, `season`.
Those are cheap, reliable, and fully populated. The embedding is one term in
Layer 1, not the whole of it. This is the right weighting anyway.

### Vectors still sync

Compute client-side, then upload **the vector, not the image**, and cache it in
Postgres. Without this, every device re-embeds the whole closet on first use and
server-side features (backup, redundancy analysis, restore) have nothing to work
with. Vectors going up preserves the privacy property, because the camera-roll
photos are still never transmitted.

### As built

transformers.js (`@huggingface/transformers`) running `Xenova/mobileclip_s2`,
**vision tower only** — text encoding is unused, and skipping it saves ~250 MB.

Everything is served from our own origin. `pnpm embedding:fetch`
(`scripts/fetch-embedding-model.ts`, wired into `build`) stages the weights into
`public/models/mobileclip-s2` and the ONNX runtime into `public/ort`. A CDN
fetch would leak that a user is scanning and when, which is the property this
whole decision exists to protect — and it would break under a strict CSP.
The artefacts are gitignored: 73 MB of binary in git history is permanent.

| Choice | Value | Why |
| --- | --- | --- |
| Weights | `vision_model_fp16.onnx`, 71.7 MB (fp32 fallback) | q8 scores 0.7% top-1 retrieval — chance. See §7. |
| Input | 256×256, `do_normalize: false` | MobileCLIP rescales to 0–1 without ImageNet mean/std. |
| Output | 512-d, unit-normalized on write | Verified, not assumed — `pnpm test:embedding`. |
| Threads | 1 | Multi-threaded WASM needs COOP/COEP, which would break the Stripe and third-party image embeds. |

**Correction:** an earlier draft recorded q8 as merely "quality-capped" on the
strength of a three-image separation check. That check was too weak — see §7 for
the retrieval benchmark that showed q8 at chance, and the fp16 numbers that
replaced it. `pnpm test:embedding` is now labelled a smoke test; the quality gate
is `pnpm benchmark:wear-retrieval`.

### Practical notes

- The encoder runs in a Web Worker (`lib/wear/embedding-worker.ts`). Embedding a
  closet is tens of seconds of solid compute; on the main thread that is a
  frozen UI and, on mobile, a tab the browser starts killing.
- Sync is **not** auto-started. First run costs ~73 MB, which is not something
  to spend on someone's cellular plan unasked. `runEmbeddingSync` refuses on a
  connection that looks metered unless explicitly overridden, and the surface
  that offers it owns the consent.
- Resumable by construction: `listItemsNeedingEmbedding` is the queue and an
  item leaves it only once stored, so an abort costs at most one batch of 25.
- iOS Safari WebGPU exists but has tight memory ceilings — the WASM fallback is
  mandatory, not optional. Budget for it being 5–10× slower.
- Bulk camera-roll scanning is thermally expensive on phones. Chunk it, make it
  interruptible and resumable, and default to running it while charging.
- Bradley-Terry fitting (§4, Layer 2) is a small convex problem over a few hundred
  parameters — it runs client-side in milliseconds. No server involvement.

## 4. Scoring

Four layers. Each is independently useful and independently testable.

### Layer 0 — Feasibility (hard constraints) — **already existed**

No new matroid was needed. The builder's `CategoryRule` system in
`lib/outfit-random.ts` *is* Layer 0, in user-authored form: rules declare how
many pieces of which categories a look needs, and `ColorRule`s add hard colour
requirements on top. Backtracking search enforces both.

That also settles the freeform override for free. "I don't care about outfits, I
want to see two jackets" is expressible today as a rule — the user writes the
constraint rather than toggling a mode, which is strictly more general than the
opt-in flag originally planned here.

Building a second, hardcoded matroid beside it would have fought the product.

### Layer 1 — Compatibility prior (needs no user data)

This is what makes island closets work. Fixed weights, shipped with the app.

- **Colour harmony** in CIELAB/LCh, not hex. ΔE for clash detection; hue-angle
  relations for analogous / complementary / triadic; neutral anchoring; value
  contrast. Groundwork exists in `lib/colors.ts` and `lib/packing/palette.ts`.
- **Formality ladder.** A 0–10 formality score per subcategory; penalize variance
  within an outfit. One static table, high value.
- **Pattern rules.** At most one bold pattern; if two, require scale separation.
- **Climate fit** against `bandForHigh` from `lib/services/weather.ts`.
- **Type-aware bilinear form** over the embeddings:
  `s(i,j) = xᵢᵀ W₍cᵢ,cⱼ₎ xⱼ`, with `W` low-rank per category pair.

That last one is the load-bearing research idea. Compatibility and *similarity*
are different metrics — a shared embedding space with per-type-pair projections
separates them. Skip it and the recommender returns monochrome outfits of
near-identical items, which is the canonical failure mode. Train `W` once offline
on Polyvore; ship as frozen weights.

Sizing for on-device: factorize `W = UVᵀ` with `U, V ∈ ℝ^(512×16)`. That's ~16k
parameters per category pair; at ~12 categories (66 pairs) it's ~1.1M parameters,
so roughly 1 MB int8. Lazy-load it as a static asset alongside the encoder.

Because the encoder is capped (§3), weight the rule-based terms — colour,
formality, pattern, climate — at least as heavily as the bilinear term. They run
on `WardrobeItem` fields that are already fully populated and cost nothing.

### Layer 1 as built

`lib/outfit/` — `color-harmony.ts`, `formality.ts`, `climate.ts`, `bilinear.ts`,
blended in `compatibility.ts`.

Weights follow the data, not the theory: colour 0.5, formality 0.3, climate 0.2.
Terms with no opinion are dropped and the rest renormalized, so an item missing
colour data is scored on what *is* known rather than penalised for the gap.
Pattern is a multiplier, not a weighted term — as a term it would drag every
untagged look toward the middle, which on a sparsely-tagged field means scoring
absence.

Two things worth recording:

- **The formality ladder has an honest ceiling.** Blazer-with-jeans and
  suit-with-running-trainers are the same spread on a one-dimensional scale, and
  only one is a mistake. So it is tuned to flag gross mismatches and merely nudge
  the middle. Pretending to finer resolution would produce confident wrong calls.
- **Climate uses a Gaussian falloff, not a linear ramp.** `garmentWarmth` spans
  0–3 and `DESIRED_WARMTH` reaches 2.6, so any usable linear tolerance saturates:
  in cold weather a shorts-and-tee look and a slightly-too-light look both floor
  at exactly 0, and the term stops ranking anything precisely when dressing for
  the weather matters most. Caught by a test, not by inspection.

Measured on a synthetic closet with known-good and known-bad pieces, 2000 spins:

| Sampling | Mean outfit score | Distinct outfits reached |
| --- | --- | --- |
| Uniform shuffle (before) | 0.728 | 60 / 60 |
| Scored, T = 0.125 (default) | **0.847** (+16.3%) | 59 / 60 |
| Scored, T = 0.05 | 0.910 | — |
| Scored, T = 1.0 | 0.751 | — |

Quality up 16% while losing one combination out of sixty — the point of sampling
rather than taking the argmax.

### Layer 2 — Personal residual (thin, regularized)

- **Style prompt (the cold-start half).** The user describes how they dress in
  plain English; the sentence is embedded with the CLIP *text* tower into the
  same space as their garment photos, so it ranks the whole closet with zero
  interactions. This is what makes Layer 2 useful on day one — see §9.
- **Item affinity θᵢ** — Bradley-Terry utilities from choice data, blended with
  the style prior by a **per-item** λ(n) = n/(n+6). Per item, not global: a
  jacket chosen between six times should be governed by that, while an untouched
  one still leans on the prompt.
- **Pairwise residual** — only instantiated for pairs with ≥ k co-observations
  (k ≈ 3). Otherwise exactly zero, deferring to Layer 1.
- **Context conditioning** — a small linear model over context features (climate
  band, occasion, day-of-week), shrunk hard toward the context-free estimate.

Fit by **Bradley-Terry** on choice data: every reroll is `chosen ≻ rejected`;
every saved outfit is `saved ≻ sampled alternatives from the same slots`.

Combine: `score = prior + λ(n)·residual`, with `λ(0) = 0` and λ rising with
evidence count. A user with no history sees pure Layer 1 and never knows the
personalization exists yet.

### Layer 2 as built — contextual Bradley-Terry

The identity model shipped first and `pnpm eval:ranker` found it memorizing:
86.8% in-sample against 53.8% leave-one-out. That is not a tuning problem, it is
the parameter count — one free θ per garment means 183 parameters against 59
comparisons touching 76 items, so 107 items could hold no opinion at all and the
ones that could were fit to themselves.

Strength is now a function of what a garment *is*:

    θᵢ = αᵢ + wᵀxᵢ

`w` is shared across every comparison, so one choice informs every similar
garment and an item nobody has compared still gets a strength. `x` is nine
dimensions from fields with 100% coverage (`lib/outfit/features.ts`): colour
geometry in LCh — lightness, chroma, hue as sin/cos, neutral share, colour count
— plus formality and two pattern flags. Nothing reads `season`, `styleTags` or
`material` at 0–7% populated.

**Measured, leave-one-out, 52 cases (± clustered by case):**

| | pairwise | top-1 | items with an opinion |
| --- | --- | --- | --- |
| identity BT | 62.9% ± 4.9% | 28.8% | 100 |
| contextual BT | 62.9% ± 5.3% | 32.7% | **180** |
| affinity only, identity | 54.4% ± 4.7% | 19.2% | |
| affinity only, contextual | **58.7% ± 5.6%** | 26.9% | |

Memorization gap: 7.9 → 5.7 points. Every reading is inside one standard error,
so nothing here is individually significant — but four independent ones move the
same way, and the coverage change is not a statistical claim at all.

**The blended ranker did not improve, and the reason is instructive.** The three
strongest coefficients are hueCos (+1.58), neutralShare (+1.56) and lightness
(+1.02) — Layer 2 is learning a *colour* preference, which is what Layer 1's
dominant term already encodes. The gain shows up in Layer 2 alone and washes out
in the blend because the two are largely the same signal. Features orthogonal to
colour — the MobileCLIP embedding dimensions, deliberately left out of this pass —
are where a blended gain would have to come from.

Two things that had to be got right, both of which measured worse when got wrong:

- **Unary rows do not fit `w`.** A like/pass against `NEUTRAL_ANCHOR` has no
  feature contrast — the anchor has no features, so the "difference" is just the
  outfit's own vector. Those rows still train the intercepts.
- **No garment-kind one-hot.** In a comparison between two outfits of the same
  shape, kind composition is identical on both sides and cancels, so a kind
  coefficient can only fit the artifact that `rejectedIds` is a deduplicated
  union — five items on the loser side against three on the winner's. With them
  in, the two largest coefficients were kindTop (−1.59) and neutralShare (+1.56),
  and like/pass AUC came out *below* using no affinity at all. They measured
  slightly better on blended pairwise, which is why they are worth revisiting —
  but only once per-arm logging makes them identifiable, since the evaluation
  reconstructs rivals from the same pooled union.

The λ ramp needed one addition. An uncompared item now has a utility but no
evidence of its own, and λ(0) = 0 would collapse its affinity to a flat 0.5 —
worse than absent, because `blend` drops absent terms and renormalizes while a
fabricated neutral dilutes the terms that work. `evidenceFor` credits the shared
model at comparisons/dimensions, an order-of-magnitude argument rather than a
derivation, which is why its effect is measured rather than assumed.

Posterior σ still reads *own* evidence only, so the explore slot and the dormancy
lens keep targeting genuinely untouched garments rather than ones the feature
model merely has an opinion about.

### Layer 3 — Slate construction

Not top-k. Greedy submodular maximization under the slot matroid — coverage plus
diversity plus pairwise compatibility, which gives the standard 1−1/e guarantee
and, more importantly, stops the system returning three near-identical outfits.

Produce exactly three, with an explicit risk budget:

| Slot | Strategy | Purpose |
| --- | --- | --- |
| 1 | Maximize posterior mean | Safe. The one they'll probably take. |
| 2 | Maximize subject to differing from #1 in ≥2 items | Genuine alternative. |
| 3 | Thompson sample, upweighting high posterior variance | Exploration. |

Slot 3 *is* the utilization engine. High posterior variance means little
evidence, which means the item is underworn. Surfacing uncertainty and surfacing
neglected clothes are the same operation, so there is no separate "wear this more"
feature to build.

### As built

`lib/outfit/posterior.ts` adds uncertainty to Layer 2's point estimate, and
`buildSlate` runs three labelled arms. Evidence combines **comparisons and
wears** — without wear counts the explore arm keeps "discovering" the user's
favourite jeans, which have never been in a slate but are hardly unknown.

Measured over 3000 slates on a fixture closet split into heavily-worn and
never-worn pieces:

| Arm | Neglected items per outfit | Favourites per outfit |
| --- | --- | --- |
| safe | 0.43 | 1.93 |
| alternative | 0.63 | 1.49 |
| **explore** | **0.97** | 0.96 |

The explore arm surfaces 2.3× more neglected clothes than the safe one, purely
as a consequence of being uncertain about them. No rule anywhere says "prefer
unworn items".

**One draw per slate, not per candidate.** An item that comes up optimistic stays
optimistic while the outfit is built around it, so the result is a coherent bet
on that piece rather than noise scattered across the slots.

**σ₀ and evidence decay are separate parameters.** The conjugate shortcut
τ = 1/σ₀² + n ties them together, and at σ₀ = 0.25 that silently makes the prior
worth *sixteen* observations — a garment worn fifty times still read as barely
known. σ₀ sets how wide a draw is; `EVIDENCE_HALF_LIFE` sets how fast evidence
shrinks it. Conflating them was a bug, caught by a test.

**Arms are labelled by intent** — "First pick", "Another option", "Something
different" — so a miss in the third reads as the feature working rather than as
a bad recommendation.

**Propensity on the explore arm is conditional on the draw**, not marginal over
draws. Segment by `strategy` before using these in an off-policy estimate;
mixing arms silently biases the result. `SLATE_POLICY_ID` is bumped to
`slate-thompson-v2` because rows from the old one-arm policy are not comparable.

## 5. Product surfaces

### A. Complete-the-outfit (anchor-driven)

User locks one or more items; the system fills the remaining slots. Roughly 80%
scaffolded already — `app/closet/outfits/random-outfit-builder.tsx` and
`lib/outfit-random.ts` already carry `lockedItemId` per slot. The change is
replacing uniform random sampling with scored sampling.

**This is the cheapest high-value change in the plan.** It works with zero user
data, because it runs entirely on Layer 1.

### B. Daily proposal (unprompted)

Morning surface. Context = today's weather at home (needs a today-at-location
variant of `getClimateSummary`, which is currently trip-shaped), day-of-week, and
occasion if calendar access is granted. Shows the three-outfit slate.

Actions: **wearing this** (→ confidence-1.0 `WearEvent`), **reroll** (→ negative
pair), **save** (→ compatibility positive).

Surface B is the data engine — it manufactures the contrastive choice data that
Layer 2 needs. Surface A is what makes the product feel smart immediately. Ship A
first, B second.

### Surface B as built — the Outfits page (`/closet/outfits`)

`lib/outfit/slate.ts` (pure) + `lib/actions/daily-outfit.ts` +
`app/closet/outfits/`. Three distinct proposals; accept writes a confidence-1
`WearEvent` with weather and occasion attached *plus* an `accept`
`PreferenceEvent` carrying the rejected sets; reroll writes the comparison
alone.

- **Rejected items are excluded outright**, not down-weighted. Re-proposing a
  piece somebody just turned down reads as not listening, and the cost of
  dropping it for one day is nil.
- **Fewer proposals beat padded ones.** If the closet can't produce three
  genuinely distinct looks it returns one or two. Three variants of the same
  outfit is a worse offer *and* teaches the preference model nothing — "picked A
  over two clones of A" carries no signal.
- **Weather comes from a stored home location**, not the browser: `next.config.mjs`
  denies geolocation at the Permissions-Policy header, and a typed city is a far
  smaller ask than reversing that. Absent → neutral climate term, everything
  still works.
- The slate does **not** reuse `pickRandomOutfit`. That function backtracks over
  user rules and its ordering is a sampled permutation with no clean probability
  attached; the slate samples slot by slot so the propensity is exact.

**A caveat on propensity magnitude.** Measured on the real closet, an accepted
outfit logged `propensity ≈ 7.9e-5` — the product of three per-slot softmax
probabilities over ~40–50 candidates each. That is the honest joint probability,
but it means importance weights around 12,000×, so **plain IPS will be unusable
noise**. Whoever builds the offline evaluation should use SNIPS with weight
clipping, or evaluate per-slot rather than per-outfit. Recording the true value
and fixing the estimator is right; inflating the propensity to make the
arithmetic comfortable would just hide the variance.

## 6. Dormancy and value — the observation surfaces

No sell recommendations. Four independent lenses, deliberately **never fused into
a single score** and never shown in the same card.

These now render as a section of the Sell page (`/closet/sell`) rather than their
own route. That raises the stakes on the rule above rather than relaxing it: the
surrounding page is about money, so the adjacency already implies an action the
lenses must not make. The section sits below a hard rule with its own standfirst
— "Observations only. What to do about any of it is yours to decide." — and
nothing inside it may grow a CTA, a combined score, or an ordering that reads as
a queue.

### Lens 1 — Dormancy

Discrete-time hazard model of time-to-next-wear. Features: category base rate,
per-item seasonality, recency, occasion rarity, weather-conditional availability.
Output: P(worn in next 90 days).

Clothing is pure *repeat* consumption, unlike almost every recommender domain —
jeans recur weekly, a ski jacket annually. Modelling item-specific recurrence is
what stops the system flagging a genuinely seasonal coat as dead.

Copy is descriptive: *"Last worn 14 months ago."* / *"Worn once since you added it."*

**The readiness gate comes first.** `dormancyReadiness` refuses to let the lens
speak until there are ≥25 wear events spanning ≥90 days. On a young closet every
garment is technically dormant — a statement true of everything, which is both
useless and accusatory. Both conditions are needed and neither implies the
other: fifty wears in a week is a burst, not a history.

**Suppression rules.** An item is never surfaced as dormant if:

- it is in-season-pending (a wool coat in July);
- it is occasion-tagged and the occasion hasn't come round;
- it has multiple wearers in the household (shared items are insulated);
- it is structurally load-bearing (Lens 3);
- it was acquired under 90 days ago;
- the user marked it protected.

The wardrobe-studies literature is the reason this list exists: roughly a fifth of
a typical wardrobe is dormant at any time, but of dormant items about 70% are
retained with genuine intent to wear again — around 20% specifically reserved for
an occasion. That 20% is the false-positive class, and it contains the items whose
misclassification costs the most trust.

### Lens 2 — Redundancy

Cosine similarity on embeddings plus colour distance, clustered within category.
*"You have four similar white tees."* Descriptive, no verb, no recommendation.

### Lens 3 — Marginal value (internal)

Counterfactual: remove item *i*, recompute the size and quality of the feasible
high-scoring outfit set, take the drop. A leave-one-out computation over the
outfit graph.

High-Δ items are load-bearing — the black blazer worn six times a year that is the
only thing making twelve outfits work. Cost-per-wear says sell it; marginal value
says it is one of the most important things in the closet. Marginal value is
therefore a **suppression input to Lens 1**, not a user-facing number.

### Lens 4 — Value awareness (positive framing)

From `ListingPlacement` history plus retail anchor plus brand: *"Pieces like this
are holding value — comparable ones sell around $X."* Shown on the item page as a
fact about the item, unattached to any dormancy claim. A user who keeps the item
should still enjoy knowing this.

### Composition rule

Dormancy and value live on different surfaces. The only place they are joined is
a user-initiated "I need to raise cash" mode, which the user opens deliberately.
Cost-per-wear may be displayed as an explanation because it is familiar, but it is
never a ranking signal.

## 7. Passive wear inference

**Camera roll is the primary source. Calendar integration is dropped** — the
permission ask is heavy and the camera roll carries enough.

1. **Photo matching (on-device).** Match garments in the user's own photos against
   closet embeddings; emit a `WearEvent` at confidence 0.2–0.6 with the EXIF date.
   Photos are never uploaded. `lib/image-dhash.ts` is useful as a cheap
   pre-filter, but perceptual hashing alone will not carry this — a garment worn
   on a body differs from a flat product shot in pose, occlusion, and lighting,
   which is exactly what dHash is not robust to. The embedding does the matching;
   dHash just narrows the candidate set first.
2. **Packing.** Items in a `PackingBag` over trip dates are weak positive
   evidence. Nearly free.

### Built — the wear-scan mode of `/closet/scan`

`lib/wear/exif.ts` → `lib/wear/photo-match.ts` → `lib/wear/photo-scan.ts`, with
cropping and embedding in the worker and `lib/actions/wear-scan.ts` as the only
server contact. Photos are selected, decoded, cropped, embedded and matched in
the browser; what crosses the wire is item ids, dates and scores.

**The encoder had to be fixed first.** Phase 0 shipped q8 on the reasoning that
one artefact should serve both backends. Measured on 136 real garments
(`pnpm benchmark:wear-retrieval`, query = ghost render, gallery = originals):

| dtype | top-1 | top-5 | mean margin (correct − best wrong) |
| --- | --- | --- | --- |
| q8 | **0.7%** | 6.6% | **−0.249** |
| fp16 | 69.9% | 85.3% | +0.056 |
| fp32 | 69.9% | 85.3% | +0.056 |

q8 was not quality-capped, it was destroyed — 1 correct match in 136 is chance,
and a negative margin means the right garment usually scores *below* the best
wrong one. fp16 is now primary, fp32 the fallback. The Phase 0 smoke test
("different garments still score apart") passed happily on the broken model;
only a ranking benchmark caught it.

**Thresholds are measured, not chosen** (`pnpm calibrate:wear-match`, fp16):
distinct items sit at a median cosine of 0.432, p99 at 0.841, and the mean
nearest-neighbour is 0.816. `MATCH_FLOOR = 0.841` follows from that. An
intuition-picked threshold would have matched everything.

**It returns a shortlist, not a verdict.** 69.9% top-1 is an upper bound — a
studio render against studio photos — and a worn, creased, half-occluded garment
in a kitchen will do worse. The closest confusions are two pairs of light-wash
baggy jeans at 0.96 and the same shorts in two colours at 0.95, which no matcher
resolves because the photos genuinely look alike. So confidence is capped at
`PHOTO_CONFIDENCE_CEILING` (0.7), discounted when a near-duplicate ties, and
every finding lands in the confirmation queue.

Verified end to end in the browser on the real 180-item closet: 183 items
embedded on-device, a test photo matched to the correct garment, written at
confidence 0.7 with `timesWorn` still 0, then confirmed to 1 with an occasion
attached. Re-scanning the same photo records nothing new — `commitScanFindings`
dedupes on (item, day) so a second pass can't inflate `effectiveWears`.

**Confirmation is elicitation, and it is the only source of occasion labels.**
Dropping the calendar means nothing else supplies `WearEvent.occasion`. So the
confirmation prompt does double duty:

> *"Looks like you wore these on Tuesday — right?"* → confirm / correct
> *"What was it for?"* → one tap from the fixed occasion enum

That turns a 0.3-confidence inference into a 1.0 wear **with** a context label, at
a cost of two taps. Design this flow as a first-class data source; it is where
essentially all high-quality training data comes from.

### Occasion enum

Fixed, small, and deliberately aligned with the existing `STYLE_OPTIONS` in
`lib/preferences.ts`:

| Occasion | Correlates with style tags |
| --- | --- |
| `work` | workwear, tailored, classic |
| `everyday` | casual, relaxed, minimal |
| `going_out` | going-out, romantic |
| `formal` | tailored, classic |
| `active` | athletic |
| `travel` | relaxed, cozy |
| `home` | cozy, relaxed |
| `outdoors` | — |

**Correction: this bridge is much weaker than first claimed.** The mapping was
described as making occasion-conditioned recommendation work on day one. It
doesn't. `styleTags` is 7.2% populated on the measured closet, so the bridge
fires for about one item in fourteen; for the rest it returns
`NEUTRAL_OCCASION_PRIOR` and carries no information.

It is kept because it costs nothing and starts working the moment those tags
exist — the same reasoning that keeps `seasonScore` in lib/packing/plan.ts
despite `season` being 0% populated. But it is not load-bearing, and nothing
downstream should be designed as though occasion conditioning works before the
wear log has occasion labels in it. What actually carries cold start is colour
and category (§4, Layer 1), which are the fields that are actually there.

## 8. Evaluation

- **Offline FITB** on the user's own saved outfits, hold-one-out: rank the removed
  item against 5 same-category distractors. Baseline is current uniform random.
  Run this before shipping anything.
- **Off-policy evaluation** (IPS/SNIPS) using logged `propensity`, so new rankers
  can be compared on historical data without a live test.
- **Dormancy precision** against confirmed "yes, I'd forgotten about this."
- **Guardrail: protect-rate.** If users increasingly mark items protected, the
  dormancy model is overreaching — back off automatically.

### Built — `pnpm eval:ranker`

`lib/eval/ranker.ts` (metrics, pure) + `scripts/eval-ranker.ts` (data + report).
Runs in about a second against the dev database.

**FITB is not runnable as specified, and the substitute is better.** Hold-one-out
over saved outfits needs saved outfits: there are zero `Outfit` rows, because
`acceptProposal` writes a `WearEvent` and a `PreferenceEvent` and only virtual
try-on ever creates an `Outfit`. The choice log is the better substrate anyway —
a `train_pick` *is* the task FITB approximates, with real alternatives instead of
synthetic distractors.

### Per-arm logging — recording what the user actually said

The first run exposed a write-time problem, not a model problem. A tap on one of
n outfits expresses n−1 pairwise preferences; `recordTrainingPick` stored one, with
`rejectedIds` as a deduplicated union of the passed-over pieces. At the
eight-outfit setting that discarded roughly six sevenths of the answer — and the
mode hint had been promising the stronger reading all along: *"your pick beat
every other outfit on screen"*.

It also corrupted what could be learned. The pooled loser side holds five items
where the winner has three once two arms share a piece, so its per-kind
proportions shift for reasons unrelated to taste, and a model with kind features
fits that shift as if it were preference (§4, Layer 2).

`PreferenceEvent` now carries `armsJson` (every outfit shown, in display order)
and `chosenArm`. `comparisonsFrom` in `lib/wear/signals.ts` is the single reader —
used by both the production fit and this harness, so the two cannot disagree about
what a row means. Verified end to end: an eight-arm round logs 7 comparisons where
it used to log 1, a three-arm round logs 2, and `chosenArm` records the arm that
was actually tapped rather than defaulting to the first.

Consequences worth stating:

- **Each comparison carries the row's full signal weight.** An eight-way choice
  genuinely is more informative than a three-way one, and all-pairs expansion of a
  ranked choice is the standard reading — but `evidence` counts, and therefore the
  λ ramp, now grow faster per answer than under pooled logging.
- **Rivals are read, not reconstructed.** `rivalsFor` prefers logged arms, so top-1
  on those rows is exact rather than a lower bound.
- **Old rows cannot be un-pooled.** The 53 pre-existing picks keep the fallback
  path: `reconstructRivals` enumerates every same-shape outfit from the pool, a
  superset of what was shown. The report prints how many cases fall in each group,
  because a number mixing them is only as precise as its weaker half.
- **`rejectedIds` is still written**, so anything reading the old shape keeps
  working.

**First run — 59 contrastive cases, 27 rated, 180 items.** Pairwise accuracy,
Layer 2 refit per case with that case held out, ± clustered by case:

| Ranker | pairwise | top-1 |
| --- | --- | --- |
| full (as shipped) | 62.4% ± 5.0% | 27.5% |
| layer 1 only (no affinity) | 62.6% ± 4.7% | 13.7% |
| affinity only (layer 2) | 53.8% ± 4.8% | 19.6% |
| colour only | 60.5% ± 5.0% | 19.6% |
| no colour | 54.3% ± 5.0% | 19.6% |
| formality only | 50.6% ± 1.9% | 0.0% |
| climate only | 51.7% ± 1.4% | 3.9% |
| chance (200 random rankers) | 50.6% ± 6.5% | — |

Read with the sample size in mind — one closet, one person, 51 scored cases, and
a noise floor of ±5 points. What it does support:

- **The ranker beats chance, by about a standard error and a half.** Suggestive,
  not established. It is the first evidence that any of this works at all.
- **Colour is the ranker.** Colour-only nearly matches the full model; removing
  colour costs 8 points and lands inside the noise floor. This confirms the
  weighting decision in §4 on outcome data rather than on coverage statistics.
- **Formality and climate are inert.** Formality-only is exactly chance. Their
  small ± is itself the tell: both produce mostly ties.
- **Layer 2 pays for itself only in tie-breaking.** Out of sample it adds −0.2
  points pairwise, but doubles top-1 (13.7% → 27.5%) by separating outfits Layer 1
  scores identically. Its 0.35 weight is not earning what the weight implies.
  *(This is what prompted the contextual model in §4; the identity-model figures
  in this list are the "before".)*
- **In-sample affinity reads 70.3% against 62.4% leave-one-out.** That 8-point gap
  is memorization, and it is why the ablation table refits per case. Any future
  number quoted from the production affinity map is inflated by roughly this much.
- **Like/pass AUC 0.753** (18 liked, 9 passed), affinity fit on picks only — an
  independent read that agrees with the pairwise result.

**SNIPS is plumbed, and now fed.** At first run two of 86 events carried a
propensity. The cause was not the write path — `rerollProposal` and `dismissSlate`
always forwarded one — but that `getTrainingRound` dropped `Proposal.propensity`
before returning, so the client had nothing to send back, and the training surface
is the only live producer (the daily-proposal actions in `lib/actions/daily-outfit.ts`
have had no caller since the outfits page was reorganized). Since fixed:
`TrainingOutfit` carries `propensity` and `strategy`, and all three answer paths —
pick, rate, swipe — echo it back. Verified end to end: a pick logs 1.7e-4, a like
1.0e-5, a dislike 2.3e-5.

Two things this pins down:

- **Client-supplied numbers are gated, not trusted.** `usablePropensity` in
  `lib/outfit/slate.ts` accepts only (0, 1] and stores null otherwise. Zero would
  divide by zero in an importance weight and anything above one is unreachable by
  multiplying softmax terms, so both mean the value is corrupt — and per §5B a
  wrong propensity is worse than a missing one, because nothing in the data shows
  it happened.
- **Training propensities are conditional on the Thompson draw**, since every
  training arm is `explore`. They are comparable with each other and not with a
  marginal propensity from some future non-explore surface, so `strategy` is
  written into `contextJson` to keep that boundary visible in the data.

Rows written before the fix carry null and cannot be backfilled — the sampler's
slot order and candidate pool were never recorded. The estimator refuses to print
below 30 usable rows rather than report a number dominated by one small
propensity, so off-policy evaluation switches on as new answers accumulate.

**Protect-rate baseline: 0% (0/180).** The guardrail has somewhere to write and
nothing to say yet; compare future runs against this.

## 9. Staging

| Phase | Contents | User-visible? |
| --- | --- | --- |
| 0 ✅ | `WearEvent`, `PreferenceEvent`, `protectedAt`, propensity logging, backfill from `timesWorn`; in-browser encoder + vector sync | No |
| 1 ✅ | Layer 1 scoring, swapped into the random-outfit builder via `scoredOrder` | Yes — immediately better |
| 2 ✅ | Daily proposal, reroll, camera-roll wear inference + confirmation | Yes — this is the data engine |
| 3 ✅ | Style prompt (cold start) + Bradley-Terry residual with per-item λ ramp | Yes — the prompt is visible and immediate |
| 4 ✅ | Three-arm slate with a Thompson explore slot | Yes |
| 5 ✅ | Dormancy, redundancy and value lenses — gated on wear history | Yes |

Phase 5 is last for a reason: it depends on Phase 0 having accumulated real wear
history *and* on Phase 4's marginal-value machinery. Shipping dormancy early, on
thin data, is the fastest way to burn the trust the whole feature depends on.

## References

- [Learning Type-Aware Embeddings for Fashion Compatibility](https://openaccess.thecvf.com/content_ECCV_2018/papers/Mariya_Vasileva_Learning_Type-Aware_Embeddings_ECCV_2018_paper.pdf) — Vasileva et al., ECCV 2018
- [Dressing as a Whole: Node-wise GNN outfit compatibility](https://arxiv.org/abs/1902.08009) — Cui et al., WWW 2019
- [Hybrid-Hierarchical Fashion Graph Attention Network](https://arxiv.org/abs/2508.11105) — 2025
- [Polyvore Outfits dataset](https://github.com/xthan/polyvore-dataset)
- [The Dynamics of Repeat Consumption](https://cs.stanford.edu/people/ashton/pubs/repeat-consumption-www2014.pdf) — Anderson et al., WWW 2014
- [Modeling Item-Specific Temporal Dynamics of Repeat Consumption](https://dl.acm.org/doi/10.1145/3308558.3313594) — WWW 2019
- [A Tutorial on Thompson Sampling](https://web.stanford.edu/~bvr/pubs/TS_Tutorial.pdf) — Russo et al.
- [Cold-start via Contextual-bandit Algorithms](https://arxiv.org/abs/1405.7544)
- [Bradley–Terry model](https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model)
- [Unravelling the service lifespan of garments](https://www.sciencedirect.com/science/article/pii/S2666784326000124) — dormancy base rates


## 9. Styling notes

One-off tips, in the user's own words, captured against the outfit they are
about:

> *"don't put that hat with that shirt"*

### Why not a global "describe your style" prompt

There was one, briefly, and it was the wrong shape for two reasons.

**Blanket statements are mostly redundant.** "Relaxed streetwear, mostly
neutrals" is largely already encoded in *which garments the closet contains* —
ranking a closet by its own description adds little. The earlier demo only
looked convincing because the prompt deliberately contradicted the closet.

**And CLIP cannot represent the useful case.** Embedded as a vector, "don't put
that hat with that shirt" scores *close* to outfits containing that hat and that
shirt — CLIP has no negation, so the similarity signal is real and points
exactly backwards. Notes are logical constraints over specific items; the only
faithful representation is a structured rule.

What the closet can't tell you is the situational knowledge in the user's head.
That is what notes capture.

### Notes are captured in context

A note is written *about a proposal that is on screen*, so "that hat" resolves
to an item id with no pronoun resolution. `lib/services/styleNoteParser.ts` is
handed the visible garments and only has to decide which of them the sentence is
about; anything it names outside that set is discarded. That single design
choice is what makes the feature tractable.

The parser follows the `USE_REAL_*` + stub convention from `tripParser.ts`:
Opus 5 with structured outputs at `effort: low`, and a real keyword matcher as
the keyless path *and* the fallback on any failure.

### Five rule kinds

`avoid_pair`, `prefer_pair`, `avoid_item`, `avoid_item_context`,
`prefer_item_context` — the last two conditioned on climate band or occasion.

**Avoidances are hard, preferences are soft.** The user said "don't"; a scorer
that merely down-weights a "don't" surfaces it eventually and reads as not
listening. Preferences only tilt the ranking — otherwise two or three notes
collapse the closet onto one outfit.

**A conditional rule with no conditions is rejected**, and a conditional rule
whose condition can't be evaluated does not fire. "Too warm above 20°C" must not
silently become an unconditional ban on a day with no forecast.

**Silence is a valid parse.** A vague note stores its text and no rules — a
wrong hard constraint quietly removes outfits the user never asked to lose. The
text is kept regardless, so a better parser can revisit it without asking anyone
to retype anything.

### Verified end to end

On the live closet, the note *"don't put that sweater with those shorts"*
resolved to an `avoid_pair` over the two correct garments. Across **75
subsequent outfits spanning 43 distinct tops**: the sweater appeared 2×, the
shorts 7×, and the pair together **0×**. The rule binds the combination, not the
garments.


## 10. Training rounds

"Train your stylist", a tab on `/closet/outfits`.

### Why this is the highest-leverage surface in the system

Layer 2 learns from choice data, and until now the only source was the daily
proposal: **one comparison per day**, because you only get dressed once. A
training round produces one every few seconds. It decouples how fast the model
learns from how often the user gets dressed — which was the binding constraint
on the entire personalization layer.

Two shapes, reducing to the same thing:

| Mode | Interaction | Becomes |
| --- | --- | --- |
| Pick a favourite | n outfits, tap one | `chosen ≻ each of the other n−1` |
| One at a time | one outfit, love/pass | a comparison against `NEUTRAL_ANCHOR` |
| Rate pieces | one **garment**, like/pass | `train_item`, against `NEUTRAL_ANCHOR` |

### Rate pieces — the affinity question, asked directly

The first three modes all ask about outfits, which is compatibility evidence with
item taste tangled into it. §1 is explicit that affinity and compatibility are
different quantities that must not be conflated, and nothing was collecting the
first one: a three-piece pick spreads its 0.55 across three garments and no answer
can say which piece earned it. The measured consequence is in §4 — Layer 2's
coefficients came out as a *colour* preference, duplicating Layer 1's dominant
term, because outfit-level colour averages were the clearest thing in the data.

`train_item` fixes that at the source. Weight `{ affinity: 0.6, compatibility: 0 }`
— compatibility is zero, not small, because one garment on its own says nothing
whatever about what goes with what, and that is the point of having it. Affinity
sits above `train_pick` since there is no attribution to undo, and below a wear
since it is still an opinion about a photo.

Three things make it the cleanest evidence in the log:

- **It trains the shared coefficients, unlike an outfit rating.** Features are
  centred on the closet mean, so a single garment against the anchor reads as "how
  this piece differs from an average garment" — a real contrast. A three-piece
  look is *not* a fair draw from a closet that is 40% hats, so its offset from the
  mean is compositional rather than personal, which is why those rows are excluded
  from the `w` gradient. `isFeatureContrast` in `lib/outfit/bradley-terry.ts` draws
  the line at set size.
- **The queue is self-clearing.** Pieces are ordered by posterior uncertainty —
  `noveltyScore`, the same quantity the explore slot and the dormancy lens read —
  so it leads with what the model knows least about, and rating a piece drops it
  out. Deliberately deterministic: there is no slate whose composition could be
  varied, and a sampled order would re-show a garment just judged.
- **No propensity.** The logged decision is a judgement about one garment, not a
  choice among alternatives, so there is no ranking policy whose value an
  off-policy estimator could recover. Logging a number would invite exactly the
  error §5B warns about.

Verified end to end: a like records the garment as winner against the anchor, a
pass reverses it, and `featureCredit` rose from 7.222 to 7.444 as the two ratings
joined the coefficient fit. `pnpm eval:ranker` reports item-level AUC for these
rows, held out against a map fit on picks only — and refuses to print a number
below five of each class, because one like against one pass is exactly 1.000 and
that is the figure most likely to get quoted without its sample size.

**The anchor is what makes swiping usable.** Bradley-Terry only consumes
comparisons, and a swipe is a unary judgement. Pairing it against a fixed
pseudo-item — liked ≻ anchor, anchor ≻ passed — converts one into the other
without inventing a comparison between two outfits the user never saw together.
The fit is then centred on the anchor rather than the mean, so θ = 0 keeps
meaning "neutral": otherwise a session of mostly-likes shifts the scale until
the least-liked of five liked outfits scores below neutral, which is not what
anybody said.

**Rounds use Thompson on every arm**, not the usual safe/alternative/explore
split. The goal here is an *informative* comparison rather than a good outfit,
and Thompson over-samples the garments we know least about. Asking someone to
choose between three things you already knew they liked teaches you nothing.

### Observed

18 real rounds produced a fit over **76 items**, spread 0.482–0.517 around
neutral — deliberately small, because λ ramps slowly and the regularizer is
strong on thin data. Posterior σ separates items that have been compared (0.151)
from untouched ones (0.250, the prior), which is exactly the signal the explore
slot and the dormancy lens both read.
