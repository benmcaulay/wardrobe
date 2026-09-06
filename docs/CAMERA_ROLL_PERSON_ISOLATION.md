# Camera Roll Person Isolation

A brainstorm on turning a real camera roll — thousands of photos of family,
friends, strangers, screenshots and scenery — into closet items belonging to one
named person. Nothing here is built. This document is the research, the surviving
options, the dead ones, and a staged path that starts with a day of work whose
only job is to tell us whether the rest is worth doing.

Companion to `docs/OUTFIT_INTELLIGENCE.md` §7, which covers the *wear* half of
the same camera roll. That path is shipped and never uploads a photo. This
document is about the *import* half, which does.

---

## 0. Deployment posture — read this before §4 or §5

**Settled 2026-08-28, in two steps.** First: this is a personal deployment for
two people, Ben and his partner. Then: *"i do want the app to be enterprise
eventually, just testing for now"* — and face enrolment of the partner is
agreed.

Those two facts pull in opposite directions and the combination is the most
failure-prone posture available. Read this section as the resolution.

### The rule this posture implies

**You have the permissions of a personal deployment and must make the choices of
a product.**

Testing today genuinely does permit non-commercial and AGPL models. The trap is
that "use them now, swap them at commercialisation" does not work here, and the
research corpus says so from three directions:

- Immich's own docs: *"Changing machine learning models loses existing learned
  data."*
- The self-hosted photo threads on model upgrades: *"You'd need to re-download,
  decrypt, and run inference on all your past media."*
- This repo already proves it locally. `lib/wear/photo-match.ts` hardcodes
  `BACKGROUND_SIMILARITY = 0.432`, `MATCH_FLOOR = 0.841` and a 0.05 clarity
  margin, each measured against one specific encoder, with the file's own header
  warning that they are *"meaningless against a different embedding space."*

A model choice here does not stay a model choice. It becomes calibrated
constants, a backfilled vector corpus, and cluster assignments derived from
both. Swapping the encoder later means re-embedding everything and re-deriving
every threshold. **Pick the licence-clean option now, accept that it is slightly
worse, and never pay the migration.**

### The licence-clean stack (verified 2026-08-28)

| Role | Use | Licence | Do NOT use |
| --- | --- | --- | --- |
| Face detect | **YuNet** (opencv_zoo) | MIT | — |
| Face embed | **SFace** (opencv_zoo) | Apache-2.0 | `buffalo_l` / InsightFace models |
| Human parsing | **`pirocheto/schp-atr-18`** | MIT | `mattmdjaga/segformer_b2_clothes` (NVIDIA non-commercial) |
| Background removal | **BiRefNet** | MIT | RMBG-1.4 (non-commercial), `@imgly` (AGPL-3.0) |
| Garment embedding | **Marqo-FashionSigLIP** | Apache-2.0 | — |
| Pose / occlusion | **MediaPipe** or RTMPose | Apache-2.0 | Ultralytics YOLO-pose (AGPL) |

The one that catches people: **InsightFace's *code* is MIT — "no limitation for
both academic and commercial usage" — but its *pretrained models* are
"available for non-commercial research purposes only,"** and `buffalo_l`
specifically directs you to `recognition-oss-pack@insightface.ai` for licensing.
Every "just use buffalo_l, Immich does" recommendation, including the ones
earlier in this document, walks into that.

**The cost of going clean is real and should be stated.** SFace is a lighter,
less accurate recogniser than ArcFace/`buffalo_l` — DeepFace's tuned thresholds
put SFace at cosine 0.593 against ArcFace's 99.83% LFW. For separating two
cohabiting adults that gap is very unlikely to matter. For a future enterprise
roster of hundreds it might, and that is the moment to buy an InsightFace
licence deliberately rather than discover you need one.

### What "enterprise" adds that consumer did not

Face enrolment being agreed between two partners does not transfer. An
enterprise deployment means face templates for *employees*, which is a
materially worse biometric posture than a couple's own photos:

- **The architecture rule is now load-bearing, not advisory.** §2.14's analysis
  holds: *G.T. v. Samsung* (7th Cir., Aug 2026) turned on **control** — on-device
  templates for "friends, family, and other passersby" did not trigger BIPA
  because Samsung could not reach them. *Zellmer v. Meta* (9th Cir. 2024) turned
  on transience and non-reversibility. Cloud persistence is a hard requirement
  here, so the only defensible design is: **garment vectors, dHashes, owner
  labels and wear records persist server-side; face templates never come to rest
  in a form the server can use.** That is a schema decision, and schema
  decisions are the expensive kind to reverse.
- Enterprise buyers will ask for a DPA, SOC 2, data residency, and BIPA
  indemnification. None of that is buildable retroactively onto a design that
  stored face templates in Postgres.
- Illinois and Texas stop being someone else's problem. Google's revealed answer
  after paying twice was to geo-fence Face Groups and Ask Photos out of both
  states rather than build consent.

### What is still true from the personal-deployment read

- The scale objection stands for **now**: for two cohabiting adults already
  clustered and named in Apple Photos, a Me/Her/Both/Neither toggle beats a
  trained face gate on cost/benefit. Build the toggle first regardless — it is
  the labelling surface a face model would need for calibration anyway, and it
  is the enterprise fallback when recognition is refused or wrong.
- The ~100 MB iOS Safari budget still does not bind the **import** path, which
  runs server-side. It still binds the shipped **wear** path, which runs in a
  browser.
- `onnxruntime-web@1.26.0-dev` ships only threaded variants, so the
  transformers.js #1242 remedy remains unavailable for the browser path.

### Five repo facts found while re-adjudicating, all verified in the tree

These change the plan more than either deployment decision does.

| Fact | Where | Consequence |
| --- | --- | --- |
| `MAX_SCAN_PHOTOS = 50` | `lib/camera-roll-scan-limits.ts` | Every per-1000-photo cost in this document is hypothetical. The shipped cap is 50 per scan, and `scripts/mac-photos-scan.ts` chunks both the export and the `enqueueJob` payload by it. |
| Ghosting is **already** deferred to commit | `lib/server/camera-roll-scan.ts:92` | §3.7's C4 is shipped. The $26.80/400-items figure assumes every reviewed item is kept; the real number is (kept) × $0.067. |
| `claimNextJob()` has **no job-type affinity** | `lib/jobs/queue.ts:143` — `WHERE status = 'queued'`, `FOR UPDATE SKIP LOCKED` | Any worker claims any job. A cloud worker will claim a `camera_roll_scan` job it cannot execute if the models live on one machine. This must be fixed before any host-specific ML enters the queue — and it is squarely an enterprise-scale bug, not a personal one. |
| **fal is still wired in and load-bearing** | `package.json`, `lib/services/ghostMannequin.ts:119` — "Everything is gemini except footwear, which stays on fal Seedream v4 edit" | "Gemini is the only paid API" is not true today. The exception is measured, not lazy: Gemini won't pose shoes upright. A local cutout is the best answer for footwear specifically. |
| **Cloud persistence is not implemented** | No `Dockerfile`, `fly.toml`, `vercel.json` or `render.yaml`; `docker-compose.yml` is Postgres + MinIO for local dev; README's production section is `pnpm start` on localhost | The stolen-laptop requirement that justifies this architecture is currently unmet, and it is also the first thing an enterprise conversation asks about. It outranks everything below. |
---

## 1. What the camera roll actually is

### The three sub-problems

| | Question | Where it is answered today |
| --- | --- | --- |
| **A. Identity** | Is this garment worn by the person we are cataloguing? | Nowhere. `lib/services/garmentClassifier.ts` discards worn photos outright. |
| **B. Visibility** | Is the garment legible enough to become a catalogue entry? | Nowhere for in-the-wild photos. `lib/eval/catalog-image.ts` measures this for *renders*. |
| **C. Dedupe** | Is this the same shirt as the other 199 photos of it? | Partially — `lib/image-dhash.ts` catches identical frames only. |

### Six facts about the current pipeline that shape everything below

1. **The import path throws away exactly the photos this feature needs.**
   `CLASSIFIER_PROMPT` line 101 reads "Skip selfies where a person is the
   subject." Flat-lays and hauls are the happy path. Worn photos — the only
   abundant class in a real roll, and the only one that carries an identity
   signal at all — are rejected before anything else runs.

2. **The owner roster exists and the scan pipeline ignores it.** `lib/owners.ts`
   has `DEFAULT_OWNERS = [{me}, {her}]` and `SHARED_OWNER_FILTER`. But
   `CameraRollScanPayload` is `{ photoPaths: string[] }`,
   `lib/server/camera-roll-scan.ts:218` writes `owners: encode([primaryOwnerId])`
   unconditionally, and `grep -rn "owner" app/closet/scan/` returns nothing. Every
   scanned item in the database is attributed to the primary owner whether or not
   anyone looked.

3. **Dedupe runs after the money is spent.** `lib/jobs/runner.ts` executes the
   concurrency pool of `processScanPhotoForReview` (which calls
   `detectGarmentsInPhoto`) and only *then* calls `assignDuplicateGroups`. Worse,
   `garmentsLikelyDuplicate` merges on `garmentSignature` = `category|colors|pattern`,
   which is Gemini output. Dedupe is structurally incapable of saving a single
   Gemini call today.

4. **The pre-Gemini dHash gate cannot fire on the input class we want.**
   `processScanPhotoForReview` hashes the *whole photo* — person, room, lighting —
   against closet hashes of flat garments on white. Those two distributions barely
   overlap. It is a re-import guard, not a garment matcher.

5. **Camera-roll Gemini spend is unmetered.** `checkAiQuota` counts only
   `TryOnGeneration` and `VirtualTryOn` rows. The scan path calls it and writes
   neither. Every cost figure in this document is arithmetic, not measurement.

6. **Classification is not the dominant cost. Ghosting is.** `commitScanReview`
   enqueues one `ghost_view` job per imported item. `lib/ai-costs.ts` prices
   `gemini-3.1-flash-image` at $0.067 and `gemini-3-pro-image` at $0.134.
   Importing 400 items costs **$26.80** of ghosting against roughly $1 of
   classification even at today's untuned config. Every clustering design in the
   research optimises the smaller number.

### Which sub-problem is actually hardest

**Identity, and not because the models are bad.** It is hardest for four reasons
that compound:

- The roster is literally two cohabiting adults who are photographed together
  constantly and whose clothes are the two classes to be separated. This is the
  documented worst case: Immich has open issues for merged siblings
  ([#27995](https://github.com/immich-app/immich/issues/27995)) and identical
  twins ([#7672](https://github.com/immich-app/immich/discussions/7672)).
- Every cheap appearance signal is circular. A person-crop embedding is
  dominated by clothing — which is the output we are computing. Detail in §2.3.
- The only accurate mechanism on iOS/web requires enrolling a face template, and
  the second person in the roster has `linkedUserId: null`. She has no login, no
  notice, no consent path, and no way to exercise deletion.
- macOS has a free, curated, already-corrected answer (`osxphotos --person`) and
  iOS/web has none. There is no public `PHPerson`, no People smart-album
  subtype, and `VNGenerateFaceprintRequest` is not public.

**But identity is also the sub-problem with a 100%-accurate escape hatch:** ask
the human. One tap on a cluster card labels 47 photos. Dedupe has no such hatch —
the repo has already measured that no cosine threshold separates same-garment
from same-category, and the user cannot tap their way out of a representation
problem at scale. So the honest ranking is: **identity is hardest to *automate*,
dedupe is hardest to *solve*, visibility is nearly free and is currently unserved
by the entire market.**

### One structural fact nobody in the research corpus states plainly

**The web path cannot receive a camera roll.** `<input type="file" multiple>`
requires manual selection; the iOS Photos picker has no cross-library select-all;
Safari holding tens of thousands of `File` handles is its own problem. In
practice every browser-side design here operates on the few hundred photos a
person is willing to tap. `scripts/mac-photos-scan.ts` is not one option among
many — it is the only path that can address a 40,000-photo library at all. Any
plan that assumes otherwise is planning for a scenario that cannot occur.

---

## 2. What the internet says

Twelve findings, chosen for how much they change a decision. Numbers are as
reported; where a source gave none, it says so.

### 2.1 Nobody does bulk camera-roll import, and the cap is a product decision

Every shipping wardrobe app caps multi-select at a small batch of deliberately
shot flat-lays. GetWardrobe: "you can select up to 30 images at once"
([help.getwardrobe.com](https://help.getwardrobe.com/latest/items/digitize-wardrobe/)).
Clozit — the closest analogue to this design, camera-roll-first and
Gemini-backed — allows "up to 25 photos on the free tier"
([clozit.co](https://clozit.co/)). Stylebook, Whering, Acloset, Fits and Vesta
all allow multi-select with the mental model "I laid out 20 garments and
photographed them."

The cap keeps the review queue human-sized. It is not a technical wall. **The
white space is the funnel that turns 4,000 roll photos into the 30 worth a Gemini
call.** `MAX_SCAN_PHOTOS = 50` is the same lever everyone else pulls; nothing
upstream of it exists.

### 2.2 One app does worn-photo → per-garment extraction, and users call it the killer feature

Alta Daily. A power user: "In Alta I usually upload real photos of complete looks
that I have worn, the application analyzes the photo and recognizes each garment"
([r/capsulewardrobe](https://www.reddit.com/r/capsulewardrobe/comments/1onp0dk/)).
A Fits reviewer defects over it. Meta's engineering write-up says Alta has
"processed more than 20 million images" with Segment Anything and chose to
self-host because external APIs "cost a few cents per image"
([ai.meta.com](https://ai.meta.com/blog/alta-daily-fashion-app-segment-anything/)).

This is direct validation of the local-prefilter economics **and** a direct
indictment of `CLASSIFIER_PROMPT` line 101.

### 2.3 Person-appearance embeddings are clothing matchers — using one for identity is circular

Asked "Does OSNet rely heavily on clothing appearance?", the answer on the
torchreid tracker was: "It is standard behavior. Since clothes make up the
majority of the person's visual data then it is expected for matching to be
affected by it"
([deep-person-reid#598](https://github.com/KaiyangZhou/deep-person-reid/issues/598)).
Quantitatively, on PRCC rank-1 is **100** under Same-Clothes and **66.2** under
Cloth-Changing — a 33.8-point collapse ([arXiv:2507.07230](https://arxiv.org/abs/2507.07230)).
CLIP-ReID loses **38.09% mAP** under an attire distribution shift
([arXiv:2412.18874](https://arxiv.org/abs/2412.18874)).

If ReID says "same person" it is more likely saying "same shirt", which is the
answer we are trying to compute. **This kills an entire family of otherwise
appealing proposals** (§3.3) and it is the reason Apple fenced their own torso
embedding.

### 2.4 Apple already solved the circularity trap, with a temporal fence

Apple Photos runs a face embedding *and* an upper-body embedding, combines them
as `D_ij = min(F_ij, α·F_ij + β·T_ij)`, and restricts torso matching: "upper body
embeddings are less robust than face embeddings because they rely on a person's
temporary appearance — for example their clothing on a specific day … during this
first pass, we're careful to compare upper body embeddings only from the same
moment." Stage 2 re-merges across moments using **face embeddings only**.
Incremental cost 3.5s vs 205.8s for standard average-linkage
([machinelearning.apple.com](https://machinelearning.apple.com/research/recognizing-people-photos)).

Invert it for a wardrobe app: within a moment, clothing is constant, so the torso
crop *is* the garment fingerprint. Cross a moment boundary with it and you are
clustering outfits and calling it a person — which would merge "me in my black
puffer" with "my partner in my black puffer" and attribute the puffer to both.

### 2.5 The self-hosted photo world converged on one pipeline and one doctrine: over-split, never over-merge

Immich's shipped defaults are the concrete anchor: `maxDistance: 0.5`,
`minFaces: 3`, `minScore: 0.7`, `modelName: buffalo_l`. The docs are explicit —
"it is easier to merge two people than to split one person in two, so err on the
side of a lower threshold when possible", and max recognition distance is
"strongly recommended not to go below 0.3 or above 0.7"
([docs.immich.app](https://docs.immich.app/features/facial-recognition/),
[tuning guide](https://docs.immich.app/guides/better-facial-clusters/)). A user
with two children merged into one person fixed it by moving 0.6 → 0.4
([#7672](https://github.com/immich-app/immich/discussions/7672)).

Two corollaries the same corpus supplies. **Alignment is not optional**: Immich's
maintainer measured cosine distances of **0.3–0.94** between a hand-cropped and a
landmark-aligned crop of the *same* face — wider than the entire decision margin
([#7301](https://github.com/immich-app/immich/discussions/7301)). And
**clustering is the wrong frame here**: Immich's own DBSCAN refuses to create a
person without `minFaces` neighbours, which is why users report "only one out of
three faces is recognized". With one known identity you run 1:N verification
against an enrolled gallery instead, and strangers fall out for free.

### 2.6 Google shipped this exact feature and gated it three ways — then geo-fenced it

Google Photos' wardrobe feature requires you to "Turn on Face Groups", "Select
which face is yours", scans "photos of you from the last 4 years", and requires
"more than 1,000 photos of yourself, unless you have an AI Pro or AI Ultra
subscription" ([support.google.com](https://support.google.com/photos/answer/17125315)).
It also concedes the coverage problem: the AI "will think you still own wardrobe
items you wore in pics but have since donated."

And after paying $100M in Illinois
([Engadget](https://www.engadget.com/google-photos-bipa-lawsuit-settlement-161237789.html))
and $1.375B in Texas
([Biometric Update](https://www.biometricupdate.com/202505/texas-ag-secures-record-breaking-privacy-settlement-with-google)),
Google's answer was not a better consent flow — Face Groups and Ask Photos are
simply not available in Illinois and Texas.

### 2.7 A VLM cannot do identity, and Google says so in its own docs

FaceXBench: GeminiPro-1.5 scores **70.00%** on face recognition against a 26.88%
random baseline, and "performance drops significantly on low-resolution face
recognition" ([arXiv:2501.10360](https://arxiv.org/html/2501.10360v2)). A
dedicated verification benchmark: the best MLLM reaches 93.28% on LFW against
**99.83%** for IResNet-50/ArcFace, and only **66.03%** on AgeDB-30 (age-gap
pairs) against 98.28% ([arXiv:2510.14866](https://arxiv.org/html/2510.14866v1)).
AgeDB-30 is literally the three-year-camera-roll case.

Google's own limitations list: "The models aren't meant to be used to identify
people who aren't celebrities in images"
([firebase.google.com](https://firebase.google.com/docs/ai-logic/input-file-requirements)),
and the Prohibited Use Policy bars processing "personal data or biometrics
without legally-required consent"
([policies.google.com](https://policies.google.com/terms/generative-ai/use-policy)).
Note the failure mode: Gemini does **not** refuse. Max Woolf found "Google Gemini
showed no hesitation identifying public figures across all test cases"
([minimaxir.com](https://minimaxir.com/2025/07/llms-identify-people/)). You get a
confident wrong answer, not an error.

### 2.8 Perceptual hashing is provably random under mirroring

The million-image study is unambiguous. Unrelated pairs: pHash mean normalized
distance **0.4904** (31.4 of 64 bits, sd 4.15). Same image under **mirror**: mean
**0.4904**, median 0.5000, **0.0000% exact matches** — statistically identical to
the unrelated distribution. Under crop the tail reaches 42/64 bits. It survives
only as an exact-frame gate: 94.0% exact match under rescaling, 83.9% under
recompression ([arXiv:2212.08035](https://arxiv.org/abs/2212.08035)).

Mirror selfies are a primary input class here. And `photosLikelyDuplicate`
defaults to `maxDistance: 14` and loosens to 24 and 28 bits — against a 31.4-bit
unrelated mean, that is 1.78σ and 0.82σ, admitting roughly **3.8%** and **21%**
of all unrelated pairs. Krawetz's original rule is that "a value greater than 10
is likely a different image"
([hackerfactor.com](https://hackerfactor.com/blog/?%2Farchives%2F529-Kind-of-Like-That.html=));
imagededup defaults to 10
([idealo.github.io](https://idealo.github.io/imagededup/user_guide/benchmarks/)).

### 2.9 Dedupe is the openly-unsolved problem in this category

The Springus founder, asked directly whether his app can group identical articles
of clothing: "this remains to be seen. Currently clothing aggregation (Grouping
together two segmentations of the same shirt) is manual. I'm doing some studies
on tuning cosign-sim thresholds but I think long term there may need to be a more
robust approach" ([HN 43796048](https://news.ycombinator.com/item?id=43796048)).
Only Clozit claims to ship it, as a suggestion: "Same jumper in four photos?
Clozit offers the items it might already be, and merges instead of duplicating."

Immich's duplicate detection is pure CLIP cosine and a maintainer concedes it:
"Immich has no concept of different types of duplicates; it's all just based on
semantic similarity through the CLIP embedding"
([#25831](https://github.com/immich-app/immich/discussions/25831)). Users bounce
`maxDistance` between 0.001 and 0.05 without satisfaction. Its *face* clustering,
by contrast — core points, minimum support, preserved clusters
([PR #5598](https://github.com/immich-app/immich/pull/5598)) — works. **Copy the
face design, not the duplicate design.**

The repo's own calibration says why: distinct items sit at median 0.432, p99
**0.841**, while mean nearest-neighbour for the *same* item is **0.816**. The p99
of wrong pairs is above the mean of right pairs. Two pairs of light-wash baggy
jeans score 0.96.

### 2.10 Time-bucket before you embed

A shipping iOS dedupe app clusters by a 10-minute capture-time gap first: a
35,000-photo library collapses to **5,300** time clusters (median 2–3 photos,
largest 379 for a wedding), cutting "~600 million comparisons" to "a few hundred
thousand." Their similarity threshold was 0.35, tuned empirically: "At 0.2, I was
missing real duplicates. At 0.5, unrelated photos of the same general scene
started grouping together." (ShutterSlim, "Too many kid photos, the Apple Vision
Framework and the #2 spot in the German App Store", 2026-01 — no stable URL in
the corpus.)

The moment bucket is simultaneously the dedupe unit and Apple's temporal fence
(§2.4). One variable, two jobs.

### 2.11 Licence, not accuracy, is the binding constraint on every off-the-shelf model

This is where three of the research proposals died, and where the corpus already
had the pattern.

| Model | Status |
| --- | --- |
| `mattmdjaga/segformer_b2_clothes` (332k downloads/mo, the de-facto default) | Fine-tune of `nvidia/mit-b2` — **NVIDIA Source Code License, non-commercial**. Author changed the tag to `other` after [HF discussion #30](https://huggingface.co/mattmdjaga/segformer_b2_clothes/discussions/30); [NVlabs LICENSE](https://github.com/NVlabs/SegFormer/blob/master/LICENSE) |
| InsightFace `buffalo_l` / `buffalo_s` (what Immich ships) | InsightFace's own README: pretrained models "available for non-commercial research purposes only". Immich can use them because Immich is AGPL self-hosted software |
| Ultralytics YOLOv8-pose | AGPL-3.0 |
| `@imgly/background-removal` | AGPL-3.0 — dropped for exactly this reason in [leecy.me's war story](https://leecy.me/four-models-to-remove-one-background-a-browser-ml-war-story/) |
| RMBG-1.4 | Best measured result in that same war story, removed: non-commercial |
| **`GoGoDuck912/Self-Correction-Human-Parsing` / `pirocheto/schp-atr-18`** | **MIT.** int8-static 69.1 MB, 99.94% pixel agreement with fp32, ~229 ms/photo on a 16-core CPU ([HF](https://huggingface.co/pirocheto/schp-atr-18), [repo](https://github.com/GoGoDuck912/Self-Correction-Human-Parsing)) |
| **OpenCV Zoo YuNet** | **MIT**, ~232 KB ONNX, emits the 5 landmarks ArcFace alignment requires |
| **facex** | **Apache-2.0**, own-trained MobileFaceNet+ArcFace, 0.8/1.8/3.9/8.4 MB, LFW 95.62–99.07% ([github.com/facex-engine/facex](https://github.com/facex-engine/facex)). Caveat: weights ship AES-256-GCM encrypted against a key endpoint |

**Whether this matters at all depends on one unanswered question** (§6): is this
a personal deployment or a distributed product? A personal deployment can use
`buffalo_l` today. A Stripe-billed product cannot.

### 2.12 The browser is a 100 MB box and architecture, not file size, predicts survival

Measured on iOS 26.2: Mobile Safari's per-page ceiling is around **100 MB** on an
iPhone SE (3rd gen) and **200 MB** on an iPad (8th gen), and "using try {} catch
{} blocks in JavaScript doesn't help at all; there's no JavaScript exception to
catch" ([lapcatsoftware.com](https://lapcatsoftware.com/articles/2026/1/7.html)).
transformers.js v3 crashed on iPadOS 18.3.2 at **3.5 GB** and macOS Safari at
**10+ GB**, isolated to the ORT WASM build
([#1242](https://github.com/huggingface/transformers.js/issues/1242)). And
BiRefNet — MIT, ONNX, transformers.js-ready — died with `std::bad_alloc` inside
`encoder_forward` despite a three-rung fallback ladder; the author's conclusion:
"For in-browser image segmentation, architecture matters more than file size.
Prefer CNN-style models over transformer-heavy models."

MobileCLIP-S2 fp16 already takes 37 MB of that budget.

### 2.13 The reported abandonment cause is manual volume, not model accuracy

FITPOP: "nearly 80% of users abandon these apps entirely. Why? Because the manual
uploading and data entry process is an absolute nightmare"
([r/alphaandbetausers](https://www.reddit.com/r/alphaandbetausers/comments/1uqhj57/)).
A solo dev: "Filling it is our single biggest drop-off point … week-1 retention
bleeds out right here"
([r/SideProject](https://www.reddit.com/r/SideProject/comments/1umpd0m/)). Across
12,121 sampled App Store + Play reviews, time-sink complaints (93, of which 73 in
1–3★) outnumber AI-mistagging complaints (4) by more than 20×. The canonical
photograph-your-wardrobe tutorial budgets **4 hours for 200 items**
([r/femalefashionadvice](https://www.reddit.com/r/femalefashionadvice/comments/5zgbt5/)).
The market's actual answer is a human: Indyx sells a concierge service
([myindyx.com](https://myindyx.com/blog/the-best-wardrobe-apps)), and users
discuss hiring a TaskRabbit.

**Implication for thresholds:** users forgive a wrong category (one tap) and do
not forgive 700 taps. Review throughput — items per minute — decides whether this
feature succeeds, more than top-1 accuracy does.

### 2.14 The legal line is control, and it moved recently

- **G.T. v. Samsung** (7th Cir., No. 25-1120, Aug 7 2026): BIPA's verbs
  possess/collect/capture/obtain all require **control**. On-device face
  templates Samsung could not reach did not trigger BIPA
  ([opinion](https://law.justia.com/cases/federal/appellate-courts/ca7/25-1120/25-1120-2026-08-07.html)).
  Mayer Brown's caveat is the one that binds us: "Where the allegations or
  underlying facts establish that biometric data is transmitted to company or
  third-party servers … defendants will likely need a different defense strategy"
  ([analysis](https://www.mayerbrown.com/en/insights/publications/2026/08/seventh-circuit-holds-that-bipa-does-not-reach-biometric-data-that-remains-on-a-users-device)).
  Cloud persistence is a hard constraint here, so this defence is not available
  for free.
- **Zellmer v. Meta** (9th Cir., 104 F.4th 1117, 2024): face vectors are not
  biometric identifiers when transient, non-reversible and unable to identify on
  their own; the vectors were "simply numbers", deleted immediately after
  matching ([opinion](https://cdn.ca9.uscourts.gov/datastore/opinions/2024/06/17/22-16925.pdf)).
  The panel **rejected** the district court's holding that §15(b) reaches only
  users. Non-users in your photos have the same standing as you do.
- EDPB Opinion 11/2024 names the one central-storage architecture it considers
  compatible: the template may sit in a central database only if "the encryption
  key is kept solely in the individual's hands." (No stable URL in the corpus.)
- Texas CUBI has no private right of action and produced the two largest
  single-state settlements ever — $1.4B from Meta
  ([Texas AG](https://www.texasattorneygeneral.gov/news/releases/attorney-general-ken-paxton-secures-14-billion-settlement-meta-over-its-unauthorized-capture)).

### 2.15 Gemini cost is dominated by two parameters, and one repo line fights the model

- On Gemini 3.x an image costs a **flat** token count set by `media_resolution`:
  1120 default/high, 560 medium, 280 low, 2240 ultra_high
  ([media-resolution docs](https://ai.google.dev/gemini-api/docs/media-resolution)).
  **Pre-downscaling saves nothing on Gemini 3** — only the parameter does.
- Thinking tokens are billed as output. `gemini-3.7-flash` defaults to `medium`
  thinking; output is $3.75/M against $1.50/M on `gemini-3.1-flash-lite`, which
  defaults to `minimal` ([pricing](https://ai.google.dev/gemini-api/docs/pricing),
  [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)).
- Batch is a flat **50%** on both directions with a 24h SLA
  ([batch-api](https://ai.google.dev/gemini-api/docs/batch-api)).
- Google explicitly counter-recommends `temperature` below 1.0 on Gemini 3
  ("may lead to unexpected behavior, such as looping or degraded performance"),
  and it never bought determinism. `lib/services/gemini-text.ts` hardcodes
  `temperature: 0`.
- Bounding boxes are trained on `[ymin, xmin, ymax, xmax]` normalized 0–1000
  ([image-understanding](https://ai.google.dev/gemini-api/docs/image-understanding)).
  `detectGarmentBounds` instructs "Do not use … a 0-1000 grid" and parses the
  opposite axis order.
- Free tier is marked "Used to improve our products: Yes" on every row. Not an
  option for family photos.

**Arithmetic.** Current config (3.7-flash, 1120 image tokens, medium thinking,
~330-token prompt): ~$0.0026 per call. Tuned (3.1-flash-lite +
`media_resolution_low` + `thinking_level: minimal` + Batch): ~$0.00017. That is a
**~15×** swing from a roughly 20-line diff, before any architecture changes.

---

## 3. The solution space

Grouped by mechanism. Every group below survived at least one adversarial pass;
the ones that did not are in §4.

### 3.1 Source-side filters — cut the input before a pixel is decoded

**S1. `osxphotos --person` + Apple's own scores.** `scripts/mac-photos-scan.ts`
already shells out to `osxphotos query --json` and parses three fields
(`uuid`, `original_filename`, `filename`). The JSON already contains `persons`
(Apple's user-curated named face clusters), `face_info[]` (`quality`, `size`,
`roll`/`pitch`/`yaw`, `mwg_rs_area`), `score` (Apple's 27 on-device technical and
aesthetic scores including `sharply_focused_subject`, `low_light`, `noise`,
`intrusive_object_presence`, `failure`), `labels` (~4,500-class scene
classification), and the `screenshot`/`burst`/`panorama` booleans
([osxphotos CLI](https://rhettbull.github.io/osxphotos/cli.html)).

- *Mechanism:* add `--person` to the args, widen the `OsxPhoto` type, filter in
  TypeScript. Identity comes from a model the user trained by correcting Photos
  for years. Visibility comes from Apple's scores. Nothing is uploaded for the
  ~96% rejected.
- *Cost:* zero marginal inference, zero Gemini, zero download. The filter runs
  inside osxphotos' SQLite query, so it is **sublinear in library size** — the
  only design here with that property.
- *Breaks on:* macOS only. Silent zero if the user never named themselves in
  Photos. Inherits Apple's clustering biases, including the documented
  child-recognition failures. `ScoreInfo` semantics are reverse-engineered and
  undocumented, so every threshold must be a within-library percentile.
  `face_info[].size` has no documented units. And **`person_info` is a
  non-shallow key — it is not in `query --json`**, so the "harvest a face gallery
  from Apple's crops" idea needs the Python API, not JSON parsing.
- *Effort:* S for the query and filter. M once owner routing through
  `CameraRollScanPayload` is counted — that is not the "one line" the proposal
  claimed.

**S2. The OS picker as the identity filter.** `scan-client.tsx` already uses
`<input type="file" multiple>`, which opens the OS picker with no permission
prompt and no library authorization — the exact design HN keeps asking for.
Instruct the user to search their own name in Photos and select the results.

- *Mechanism:* two sentences of copy. Apple's People model does the identity work
  and the app never touches face data.
- *Cost:* nothing.
- *Breaks on:* the friction cliff. PHPicker has a search field but no select-all,
  so a 200-photo selection is 200 taps. It silently requires the user to have
  named *themselves*, which most people have not. And instructions get skipped —
  it must be a step with its own screen, not a hint.
- *Effort:* XS. **Unmeasured** and cheap to measure.
- *Durable variant nobody proposed:* ask the user to create an album once and add
  to it over time from the Photos share sheet. Same manual curation, but it
  persists between sessions and composes with `osxphotos --album`, which the
  script already supports.

**S3. Provenance scoring from the first 128 KB.** `lib/wear/exif.ts` already
reads `EXIF_HEAD_BYTES = 131072`. Score each file without decoding it: absent
camera Make/Model, PNG container, bytes-per-pixel < 0.5, dimensions matching a
screen-resolution table, `Software` containing "Instagram"/"Screenshot", front-vs-rear
lens from `LensModel`, GPS quantised to a home cell, time-of-day.

- *Mechanism:* pure scoring, then upload only the top N. **Redefines
  `MAX_SCAN_PHOTOS` from a selection cap to a spend cap** — a 5,000-photo roll
  costs exactly what a 500-photo one does. This is the only bounded-cost design
  in the set.
- *Cost:* I/O only. At 40,000 files × 128 KB that is 5.1 GB of reads, so budget
  5–20 minutes, not "milliseconds".
- *Breaks on:* absent EXIF must never reject alone (HEIC→JPEG transcode strips
  it). Cropped screenshots lose the resolution match, the strongest signal. GPS
  needs a `TYPE_RATIONAL` branch and a sub-IFD walk that `exif.ts` does not have,
  and none of it fires on real HEIC because `readExifDate` bails on the JPEG SOI
  check. The weights are hand-set heuristics with no ground truth.
- *Effort:* S for the scorer, M once the EXIF extension is counted.

**S4. Receipts, forwarded not OAuth'd.** A per-user `receipts+<token>@` address;
one Gemini **text** call per forwarded order confirmation (~$0.0008, no image
token charge at all); creates an item with brand, retailer, price, purchase date
and a merchant PDP image.

- *Mechanism:* inverts the query. Ownership is a fact, not an inference. And a
  garment bought 2025-06-14 cannot appear in a photo dated earlier — a **hard
  temporal fence** no visual model can be talked out of.
- *Cost:* $0.00 per 1,000 roll photos. And it is the **only** design that skips
  ghost-mannequin generation entirely, because the catalogue image is the
  merchant's — at 300 items that is $20.10 never spent, larger than the total
  classification bill of most other designs combined.
- *Breaks on:* coverage. Thrifted, gifted, vintage, in-store-cash and
  pre-inbox purchases are invisible. A public inbound address is an
  attacker-controlled path into a Gemini call with a write path and an outbound
  image fetch — prompt injection with consequences. Order confirmations carry
  shipping addresses, partial card digits and often the partner's name, a larger
  plaintext PII footprint than the face vectors this whole exercise avoids.
  Forwarding is tolerated where OAuth mailbox scope is not — Save Your Wardrobe
  lost signups over the latter.
- *Effort:* M for the parser and transposed query; the inbound-email
  infrastructure is its own project.

### 3.2 Local identity models — the only path for iOS/web

**I1. 1:N verification against one enrolled gallery.** Detect with YuNet (MIT,
232 KB, native 5-point landmarks), apply the 5-point similarity transform
(mandatory — §2.5), embed with facex (Apache-2.0, 0.8–8.4 MB), score
max-over-gallery cosine against 5–20 vectors of exactly one person, require
agreement from ≥2 gallery vectors. Exact in-memory comparison — no DBSCAN, no
People page, no vector index, no recall cliff.

- *Mechanism:* the partner, friends, strangers and the models inside screenshotted
  shopping pages all fail the *same* test — they are not in the gallery. One
  mechanism, four rejection classes.
- *Cost:* ~4–7 MB of models. ~180–250 ms/photo in a WASM worker, so 40,000
  photos is 2–3 hours of foreground device time. Must be gated behind a source-side
  filter and must be resumable.
- *Breaks on:*
  - **The roster.** Two cohabiting adults is the worst case for over-merge.
  - **Consent.** Per-user calibration "against the partner as hard negative"
    templates a non-consenting third party. Compute negatives transiently and
    persist only the resulting scalar threshold — that transience is what won
    Zellmer and it costs nothing.
  - **Key management.** The stated mitigation everywhere in the research is
    "envelope-encrypt under a key derived from the user's passphrase." **There is
    no passphrase** — auth is a magic link only. Either accept a device-local
    gallery with explicit re-enroll on a new device, or introduce a real recovery
    code and own the lost-code UX.
  - **Aging.** Enrolling from today's face and verifying against a three-year roll
    silently returns almost nothing from the early years for anyone who
    transitioned, changed weight, or grew a beard. Enroll time-stratified, and
    report found-count per year so the hole is visible.
  - **Minors.** Kids are the most-requested roster feature in the competitor
    corpus, and PhotoPrism shipped a special baby-face exclusion after "90% of the
    photos are the wrong person". Hard-block enrollment for any owner flagged as a
    minor.
- *Effort:* XL once alignment, per-user calibration, key management, a
  retention/destruction cron, an IL/TX gate and the enrollment UI are counted.

**I2. Best-face-per-track (moment tracks).** Bucket by 10-minute EXIF gap; link
person instances into tracks *within* a moment using Apple's
`min(F, αF + βT)`; verify each track **once**, using the single best face across
all its frames (argmax of embedding L2 norm × face area × cos yaw); propagate the
verdict to every frame in the track, including ones where the face is turned away
or absent.

- *Mechanism:* the single largest accuracy gain available without changing the
  model. You are never verifying a blurry 40 px three-quarter face because a
  better one exists three frames later. ~100 ArcFace calls per 1,000 photos
  instead of ~2,400.
- *Cost:* detection and pose still run on every frame, so the per-photo floor
  barely moves. Real wall clock 2–4 hours at 40k.
- *Breaks on:* two cohabiting adults in similar-coloured tops inside one moment —
  the torso term merges them and a single face anchor then labels her garments as
  his. Requires every track to contain one face above the carry threshold and to
  split on internal face distance. Also: a 379-photo wedding moment with five
  people is ~3.5M candidate edges; cap frames per moment first.
- *Surviving idea worth stealing regardless of which design wins:* **make the
  temporal fence a database invariant.** A torso-similarity edge table with a
  `NOT NULL momentId` and a CHECK constraint that both endpoints share it. This is
  the only place in the entire research where anyone enforces §2.4 in the schema
  rather than in a comment.
- *Effort:* XL. `Moment` + `PersonTrack` + a constrained edge table + restructuring
  `runCameraRollScan` from a flat pool into ordered multi-pass.

### 3.3 Appearance-derived priors — the circular family, and how to use it anyway

The critics and the designers disagreed here, and the critics are right on the
narrow point while the designers are right on the use.

**P1. Ownership prior from the closet.** Fit `Linear(512 → 1)` on the
`ItemEmbedding` vectors already in the database, labelled by
`WardrobeItem.owners`. 513 floats, ~40 lines of TypeScript, no download, no
Gemini, no biometric surface, and — per GDPR Recital 51's technique test — a
garment-appearance prior is not Article 9 data.

- *The designers' claim:* the property that makes ReID a bad person-matcher makes
  it a good garment-ownership classifier. This is true.
- *The critics' correction, which is fatal to it as specified:* `owners` is
  **hardcoded** to `primaryOwnerId` by `commitScanReview` and there is no owner UI
  in `app/closet/scan/`. A probe trained on that column learns "anything that
  arrived by scan is me" and will report a healthy cross-validated AUC while doing
  it. The honesty gate (AUC ≥ 0.75) cannot detect systematic label bias.
- *Adjudication:* the mechanism survives, the training set does not. It needs an
  `ownersConfirmedAt` column so it can train only on rows a human edited. Then
  it is legitimate for exactly two uses — **a veto** (flag for review when the
  prior strongly disagrees with the attribution) and **a default checkbox state** —
  and never for attribution. Enforce that at the type level: return
  `OwnerPrior` (a probability), never `OwnerId`.
- *Also correct in that proposal, and worth copying:* refuse to activate below an
  AUC floor, and surface it as "we can tell your clothes apart X% of the time."
  That is the most honest UI copy anywhere in the research.
- *Also correct in the critique:* the camera-facing signal is backwards for the
  case that matters most. Outfit mirror shots — the highest-value photo class in
  a roll — are taken with the **rear** camera pointed at a mirror, and the front
  camera is how you photograph your partner in the passenger seat. Demote it to a
  small weight or drop it.

**P2. Anchor propagation from confirmed garments.** Run the existing on-device
wear scan; any crop clearing `MATCH_FLOOR = 0.841` against a closet item is
*explained*, and its owner is known. Unexplained crops **in the same frame, in
the same body column** inherit that owner.

- *Mechanism:* Apple's fence at its strictest — one frame, not one moment. It
  answers a question a face model cannot: whose garment is this when the face is
  cropped out. Zero biometric surface. Zero cost for the identity stage.
- *Breaks on:* the same `owners`-is-hardcoded problem (anchors must be
  user-confirmed, enforced by a nullable `confirmedAt`, not by convention); the
  borrowed jacket, which is common in a cohabiting household and must resolve to
  SHARED rather than a winner; and recall — 69.9% top-1 is the studio→studio
  ceiling, so the explained set on household photos is smaller than it looks.
- *Kill test, runnable before any code:* on a hand-labelled roll slice, if fewer
  than ~30% of unexplained clusters have ≥3 day-edges to a confirmed anchor,
  there is no graph to propagate on.
- *Effort:* L, plus an unbudgeted owner-confirmation backfill over ~180 existing
  items.

**P3. Recurrence as ownership.** *Retained here because it is the most
interesting wrong answer in the set.* A garment worn on ≥5 separate days spanning
≥2 seasons, mostly at the home GPS cell, is probably yours; a model in a
screenshotted shopping page appears once and dies to a ≥2-moments core rule.

- *Why it fails as identity:* it is blind to the one rejection class that
  matters. The partner also recurs, for three years, at the same home GPS cell.
- *Why it fails as coverage:* it discards the wedding suit, the interview blazer,
  the coat worn twice in a mild winter — exactly the pieces a user most wants
  catalogued. Inverting the value of a wardrobe catalogue is a steep price for a
  stranger filter.
- *What survives:* the ≥2-distinct-moments core-point rule as a **stranger and
  screenshot-model filter**, clearly labelled as such so nobody later mistakes it
  for an owner filter.

### 3.4 Visibility and quality — the cheap, unserved requirement

**V1. Pure pixel statistics, already written.** `lib/eval/catalog-image.ts` has
zero imports — it is dependency-free pure functions over an `RgbImage` and an
arbitrary mask, so it runs unchanged in a Web Worker or in the Node job runner.
`wrinkleEnergy` (mean and p90 |Laplacian| over interior mask pixels, with a
`samples` reliability count), `exposureStats` (meanLuma, p95Luma, clippedRatio at
clipLevel 252, meanSaturation), `framingStats` (fillRatio, centerOffset). Roughly
60% of requirement (B) is already implemented and unit-tested. It needs a
different mask than its white-background flood fill; everything else transfers.

- *The one thing to get right:* threshold by **percentile within the user's own
  roll**, never absolutely. The famous variance-of-Laplacian cutoff of 100.0 is
  disclaimed by its own author, whose examples span 83.17 blurry against 189.43
  sharp — a 2.3× gap — and whose documented failure is content, not resolution: a
  sharp photo of a blank wall scores low
  ([pyimagesearch](https://pyimagesearch.com/2015/09/07/blur-detection-with-opencv/)).
- *Effort:* S.

**V2. A parse mask to feed it.** `pirocheto/schp-atr-18` int8 (MIT, 69.1 MB,
~229 ms/photo on 16 cores) gives per-class pixel maps. Trust only ATR classes 4
upper-clothes (IoU 0.78), 5 skirt (0.65), 6 pants (0.84), 7 dress (0.55), 16 bag
(0.84). **Never** gate on belt (0.30) or scarf (0.29). Three free signals fall
out: per-class pixel fraction (tiny-in-frame), mask fragmentation (occluded by a
table), and bbox touching a frame edge (truncation).

- *Breaks on:* memory. 69 MB is a Node-side gate, not a browser one, and the 229
  ms figure is 16 cores at 8 ORT threads — on a 2-vCPU box it is 1–2 s/photo.
  Also, the training data is known-broken for multi-person scenes: iMaterialist
  annotates one person while "more than 10% of the dataset" contains other
  visible people ([FASHN audit](https://fashn.ai/blog/fashion-segmentation-datasets-and-their-common-problems)),
  so a parser will silently drop the second person **with no signal**. Garment →
  person association must be geometric, never learned.

**V3. Within-cluster ranking instead of absolute thresholds.** Once §3.5 has
collapsed 200 photos into one cluster, (B) stops being "reject bad samples" and
becomes "choose the best sample." That is a within-user, within-cluster
comparison where miscalibration cancels — which is the only defensible way to use
a CLIP-derived score, since prompt wording alone destabilizes the probability
even when the ranking stays fine. **This is the single best idea in the
visibility group and it is free once clustering exists.**

**V4. A linear probe on embeddings you already compute.** `Linear(520 → 1)` —
the 512-d MobileCLIP vector concatenated with 8 z-scored scalars from V1 —
trained on the user's own keep/discard taps. This is the LAION-Aesthetics recipe
adapted; there is no off-the-shelf option, because NIMA, MUSIQ, BRISQUE and
CLIP-IQA have no ONNX or transformers.js builds at all.

- *Blocked on one thing, and it is a one-line fix:* `commitScanReviewItems`
  receives `{reviewId, name, category, include}` and discards it. **Log the
  discard, with a reason.** A bare discard conflates "bad photo", "not mine", "I
  already own this" and "I don't want it" — four causes in one binary teaches a
  probe nothing coherent.
- *Also blocked on:* `ItemEmbedding.itemId` is `@id`, so it physically cannot
  hold per-crop vectors.
- *Statistical caveat:* 513 parameters on ~180 examples is p ≫ n. Gate on a
  repeated-CV lower bound, not a point estimate, or the probe will switch itself
  on and off between retrains.

**V5. Graded evidence from Gemini, thresholded in TypeScript.** Never ask "is
this clearly visible?" — a VLM will sycophantically confirm whatever the prompt
implies, and CVPR 2025's NegBench found VLMs handle negation at chance level.
Recast `CLASSIFIER_PROMPT`'s negative rules as a required positive enum
(`sceneType: flatlay|worn|screenshot|receipt|scenery|other`) plus graded fields
(`visibleRegions`, `occlusionFraction`, `colorTrustworthy`) emitted **before** any
keep/reject token via `responseSchema` with `propertyOrdering` — the ordering
doubles as forced chain-of-thought — and threshold outside the model.

### 3.5 Dedupe and clustering

**D1. Two nested tiers, on two different mechanisms.** Within a moment, dHash at
Hamming ≤ 10 collapses bursts and re-uploads — the one job perceptual hashing is
genuinely good at. Across moments, embedding similarity merges "that shirt in
2023" with "that shirt in 2025." These are different problems and must not share
a threshold.

**D2. Mutual-kNN + core points + cannot-link, replacing union-find.**
`lib/server/scan-duplicate-groups.ts` builds a transitive closure over
`garmentsLikelyDuplicate`. The entity-resolution literature abandoned that because
it "disregards negative classifications" — one weak bridging pair collapses two
real entities, worst case everything into one cluster. Replace with: block by
`garmentSignature` (**partition**, never merge — "top|black|solid" is every black
tee the user owns), reciprocal top-k edges only, ≥2 mutual neighbours to form a
core, and hard cannot-link on (a) two crops from the same source photo, (b) two
crops with different categories, (c) two crops in overlapping moments. PCA to
64–128 dims before any density work; HDBSCAN degrades past ~50–100 dimensions.

**D3. Two towers.** MobileCLIP-S2 is a *category* encoder and the repo has
already measured it: p99-between-distinct 0.841 above mean-nearest-neighbour
0.816. That is a representation problem, not a threshold problem. On DISC21 copy
detection DINOv2 reaches ~64% against CLIP's 28.45% — a 2.2× gap on precisely the
"same physical thing" question. But the ordering **inverts** on fashion
attributes: LookBench fine Recall@1 puts Marqo-FashionCLIP at 63.24% and
Marqo-FashionSigLIP at 62.77% against DINOv3-ViT-L's 43.97%
([arXiv:2601.14706](https://arxiv.org/html/2601.14706v1)). That inversion is the
entire justification for running both: DINO for instance, fashion-CLIP for
attributes.

- *Sizing correction from the critics:* `Marqo/marqo-fashionSigLIP`
  `vision_model_fp16.onnx` is **185,947,013 B** — five times MobileCLIP-S2, not
  "2–4×", and a browser non-starter. Server-only, fp16, never quantized: this
  repo measured int8 taking MobileCLIP-S2 from 69.9% to **0.7%** top-1 with a
  negative margin, and the smoke test passed on the broken model. Only
  `pnpm benchmark:wear-retrieval` caught it.
- *Storage:* keep the vector table **append-only** over crops and hold crop →
  item assignment in ordinary Postgres rows, so a merge or split touches only the
  assignment table. HNSW indexes cannot delete. At ~3,000 vectors per user,
  brute-force over a `userId`-filtered set is around a millisecond — **do not
  build an index yet.** When you do, pgvector ≥ 0.8.0 with
  `hnsw.iterative_scan = relaxed_order` is mandatory because every query here is
  filtered by `userId`, and the failure is silent: with default `ef_search = 40` a
  filter matching 10% of rows leaves roughly four usable results
  ([pgvector#721](https://github.com/pgvector/pgvector/issues/721)). On a
  transaction-mode pooler those are `SET LOCAL` GUCs inside each transaction, not
  a connect-time setting. And Prisma has no native vector type — `Unsupported(...)`
  means every read and write becomes `$queryRaw`.
- *Scale correction:* the crop table is per-**photo**, not per-item. A
  40,000-photo roll produces on the order of 240,000 crop vectors, and mutual-kNN
  needs a query per vector. That is hours of Postgres CPU unless blocking bounds
  every bucket first.

**D4. A Gemini decider on the boundary, not on every photo.** Trendyol's
production pattern over 13M products: cheap embedding retrieval, then a separate
classifier on each candidate pair — macro-F1 0.90 against 0.83, +12pp recall on
duplicates. The striking number is that only **~12% of true positives overlap**
between image-embedding and text-embedding retrieval, so combining near-orthogonal
evidence beats improving either. Adapted here: ~10 genuinely ambiguous pairs per
1,000 photos get one "same physical garment, yes/no" call each. **Unvalidated** —
Roboflow scores even Gemini 3.7 Flash at 77.0% on object counting, and nothing in
the corpus measures fine-grained same-instance judgement. A/B it against raw
cosine before routing merges through it.

**D5. Ship a split affordance on day one.** Two pairs of light-wash baggy jeans
sit at 0.96 in this embedding space and two pairs of the same shorts in different
colours at 0.95. No threshold fixes that, because the photos really do look the
same. Over-merging is guaranteed; the question is only whether the user can undo
it.

### 3.6 Review surfaces — where the human is cheapest

**R1. The owner control.** A segmented control on the review grid — **Me / Her /
Both / Neither** — defaulting to the enrolled owner, with a per-card override
chip, plumbed to `CommitScanReviewSelection` and into the `owners` field that
`camera-roll-scan.ts:218` currently hardcodes. One day of work, 100% accurate by
construction, zero legal surface, zero download, zero memory risk. **Nobody in
the research proposed shipping only this and measuring how often it gets
flipped**, which is the number that decides whether any face model is worth its
licence, memory and legal cost.

**R2. The cluster deck.** Once clustering exists, the unit of review is a card
saying "this shirt, 34 photos, Oct 2023 – Mar 2026" with a 3×3 grid of the
cluster's most **diverse** members by farthest-point sampling (diverse, not
top-9-by-similarity — diverse members make over-merges visible). Actions: Mine /
Hers / Both / Not a garment / Split. `app/closet/sell/triage/sell-swiper.tsx`
already has the drag math, undo stack, stack depth and commit threshold; the
existing `DuplicateGroupReview` in `scan-client.tsx` already has radio-pick-one,
"Not the same" and "Separate this one". This is the highest-throughput correction
mechanism in the entire set: her whole wardrobe is five taps.

- *Guard:* a wrong "Mine" on a 47-photo cluster writes 47 `WearEvent` rows. Make
  cluster confirmation reversible as a unit.

**R3. The funnel receipt.** "4,812 photos → 1,203 with you in them → 340 not
screenshots or documents → 188 sharp with your face large enough → 61 moments →
44 candidate garments", every stage expandable to see what fell out and why.
This is the only artifact anywhere in the research that makes a multi-stage
cascade debuggable by the user, and it is what converts a filter that ran without
them into something they trust. It must render even when the funnel returns zero,
with the reason.

- *Extension nobody proposed:* show projected **cost** too, from a stratified
  300-photo sample, before committing the roll.

**R4. Rejection copy as a designed surface.** Every rejection carries a reason
string ("skipped: motion blur"), surfaced and overridable. Silent loss is what
generates the 1★ reviews. Two rules: never write "not you" about a photo of
someone's own past self — use "couldn't confirm this is you"; and never render a
grid of the partner's, friends' or strangers' faces back to the account holder as
"not you" cards.

**R5. Provisional import with one-tap undo.** Import optimistically into a
live-but-provisional shelf; long-press any tile for "Not mine → Her", "Not a real
item", "Same as →". Changes the economics so an over-eager filter costs a tap
rather than a wrong permanent record.

- *Three corrections that are not optional:* provisional items must be excluded
  from **sell/triage and listings** (a misattributed garment could otherwise be
  listed for sale before the owner ever sees it), from stylist training, and from
  `effectiveWears`. Hardening must require an active "these are right", never 14
  days of silence — the design's own kill criterion concedes it may be measuring
  inattention. And **do not ghost provisional items**: at a 30% correction rate
  that burns 30% of the dominant cost line on items the user deletes, and
  `ghost_view` is the one path that actually consumes `checkAiQuota`, so
  auto-importing 400 items would exhaust `AI_DAILY_LIMIT_GLOBAL` for every user.

**R6. Uncertainty sampling.** An online logistic model over ~12 free local
features predicts the user's own keep/drop call; confident tails are auto-handled
behind collapsed strips with reasons; only maximally-uncertain cards are dealt,
in descending entropy order with a diversity term so twenty questions each teach
something different.

- *Breaks on:* cold start — the first ~40 answers are unfiltered, which is
  exactly the window where trust is decided. And the auto-drop lane is the
  dangerous one: a 2% wrong-drop rate on a three-year roll is unrecoverable and
  invisible.
- *Privacy note the proposal missed:* do not persist per-photo feature rows
  (including `faceCount`) for photos that were rejected client-side and never
  uploaded. That breaks the promise the wear path already makes.

### 3.7 Cost plumbing

**C1. The config diff.** Drop `temperature: 0`; set `mediaResolution` low; set
`thinkingLevel` minimal or route triage to `gemini-3.1-flash-lite`. Roughly 20
lines in `lib/services/gemini-text.ts` for a ~7–15× cut on the pipeline that
exists today. **This is the only change in the entire document that helps right
now, at `MAX_SCAN_PHOTOS = 50`, with zero new models, zero schema changes and
zero legal surface.**

**C2. Batch.** Flat 50%, 24h SLA. This is a background job queue with no
interactive latency requirement, so it fits — but it is a *different endpoint*
(`batches.create`), needs JSONL or Files API above the 20 MB inline cap, and a
polling state machine. `gemini-text.ts` has exactly one code path. Budget it
separately or the 50% never lands.

**C3. Contact sheets.** Because Gemini 3 charges a flat per-image-part budget, a
2×2 sheet at `high` costs 1120 tokens for four crops — identical per-crop pixel
budget to four separate images at `low`. The saving is amortising the prompt and
the thinking tokens and cutting request count, roughly 2–3× on input, not 9×.
Grid scaffolding measurably helps: with partitions and labels, GPT-4o counting
went 10.50% → 32.33% and visual search 49.41% → 80.62%, and Gemini-2.5-Pro
object hallucination CHAIRs dropped 44.20 → 37.40
([arXiv:2509.24072](https://arxiv.org/html/2509.24072)). Separate images degrade
hard with count: 79.0% → 66.5% from 1 to 34 distractors
([arXiv:2601.07812](https://arxiv.org/html/2601.07812)).

- *Two hard requirements:* compose sheets from **garment crops, not whole
  photos** — a 3×3 sheet of worn photos ships nine faces to Google in one
  request, the largest third-party-disclosure step any design creates, and it is
  avoidable for free. And require the model to echo the cell id in every JSON row,
  with one known-bad crop in a fixed cell as a canary, or off-by-one mis-indexing
  silently attaches the wrong colour to the wrong garment.
- *Unmeasured for Gemini:* the stitching study used 0.5B–8B open models.

**C4. Defer ghosting.** Use the source crop as the item image and generate the
ghost lazily on first view or on request. Worth more than every clustering design
combined (§1, fact 6). Add a dHash/embedding check against already-ghosted items
before enqueuing, so three near-identical crops of one shirt do not trigger three
$0.067 generations.

**C5. Meter the spend.** A `ScanClassification` row per Gemini call recording
`promptTokenCount` / `candidatesTokenCount` / `thoughtsTokenCount`, plus a scan
limit in `checkAiQuota`. Without it every number in this document is a model with
no ground truth behind it.

### Comparison

Effort is engineering days-equivalent, not calendar. "Solves" marks the
sub-problem each mechanism actually addresses.

| # | Mechanism | Solves | Marginal cost | Breaks on | Effort |
| --- | --- | --- | --- | --- | --- |
| R1 | Owner control in review grid | **A** (100%) | 0 | Nothing. Costs taps | **XS** |
| C1 | Gemini config diff | cost | 0 | Nothing | **XS** |
| C5 | Spend meter | measurement | 0 | Nothing | XS |
| S2 | Picker + People-search instruction | A | 0 | Selection friction; unmeasured | XS |
| S1 | `osxphotos --person` + scores | A, B | 0 | macOS only; unnamed People | S–M |
| V1 | Pixel stats (already written) | **B** | 0 | Needs a mask; percentile thresholds | S |
| C4 | Defer ghost-mannequin | cost (dominant) | 0 | Item tiles show raw crops | S |
| S3 | Provenance scoring, bounded spend | A(weak), junk | I/O only | HEIC; no GPS parser; hand-set weights | S–M |
| D1 | Moment bucket + tight dHash | **C** (within) | 0 | EXIF survival | S |
| D2 | Mutual-kNN + core points | **C** (across) | 0 | Over-merge; needs split UI | M |
| R2 | Cluster deck | A, B, C review | 0 | Needs D2 first | M |
| R3 | Funnel receipt | trust | 0 | Nothing | S |
| P1 | Ownership prior (veto only) | A(prior) | 0 | Needs `ownersConfirmedAt` | S |
| V5 | Graded-evidence prompt | B | 0 | Non-determinism downstream | S |
| C3 | Contact sheets | cost | 0 | Unmeasured on Gemini; cell mis-indexing | M |
| P2 | Anchor propagation | A | 0 | Anchor rate unmeasured; borrowed garments | L |
| V4 | Linear probe | B | ~0 | Cold start; needs discard reasons | M |
| D3 | Instance tower (DINOv2, server) | C | 44 MB, ~90 ms/crop | Unproven transfer from DISC21 | M–L |
| C2 | Batch API | cost (50%) | 0 | New endpoint + state machine | M |
| S4 | Receipts | A, B, cost | ~$0.0008/receipt | Coverage; injection; PII | M + infra |
| V2 | SCHP parse mask (server) | B | 69 MB, 0.2–2 s/photo | Memory; multi-person data bias | L |
| I1 | 1:N face gate | A | 4–7 MB, 0.2 s/photo | Consent, keys, {me,her}, aging, minors | XL |
| I2 | Moment tracks | A (best) | as I1 + pose | Within-moment merge; schema weight | XL |

---

## 4. What died, and why

Stated plainly. This section is worth as much as §3.

**Three named model stacks cannot legally ship in a paid product.** Two research
designs specified InsightFace `buffalo_s`/`buffalo_l` as the recognizer and
Ultralytics YOLOv8-pose as the pose model. InsightFace's own README: pretrained
models are "available for non-commercial research purposes only." Ultralytics is
AGPL-3.0. Immich can use buffalo because Immich is AGPL self-hosted software.
`mattmdjaga/segformer_b2_clothes`, the de-facto default clothing segmenter with
332k monthly downloads, inherits NVIDIA's non-commercial licence. The corpus
already caught this exact class of error for `@imgly` and RMBG-1.4 and the
designs walked into it anyway. **Substitutes exist and are clean:** YuNet (MIT),
facex (Apache-2.0), SCHP/`pirocheto/schp-atr-18` (MIT), MediaPipe or RTMPose pose
(Apache-2.0). *This whole verdict is conditional on the deployment question in
§6.*

**"Pin ORT to the plain `ort-wasm-simd` build" — the file does not exist.** Three
designs made this their stated hard prerequisite, quoting transformers.js #1242.
The installed `onnxruntime-web@1.26.0-dev` ships only
`ort-wasm-simd-threaded.{wasm,mjs}`, `.asyncify`, `.jsep` and `.jspi`, and
`@huggingface/transformers@4.2.0` hard-imports `onnxruntime-web/webgpu`, whose
dist contains exactly one artifact: `ort-wasm-simd-threaded.jsep.mjs`. Excluding
jsep from `ORT_FILE_PATTERN` produces "no available backend found", not a fix.
**The achievable version of this fix is different and more urgent — see §5,
Phase 0.**

**Unsupervised face clustering as the enrollment mechanism.** One design's
enrollment deck detects every face across ~200 photos, embeds them, dedupes at
cosine 0.55 and deals them as cards to be labelled. That is 1:N enrollment of
everyone in the user's life, performed by an account holder who cannot consent
for any of them — the Facebook Tag Suggestions and Google Face Groups fact
pattern, which produced $650M, $100M, $1.4B and $1.375B. The "not someone I
track" bucket does not save it: the faces were detected, embedded and displayed
before the user could decline. The same design appends corrected crops to a
*second* owner's gallery, growing a persistent template for the partner from the
primary user's taps.

**Harvesting an ArcFace gallery from Apple's People clusters "with no
user-facing enrollment step at all", and scoring it against "the Apple-labelled
partner faces."** Presented as the safest proposal in the set; it is the only one
that templates a non-consenting third party without her ever being asked or
present. The query-side half of that design is the best idea in the corpus. The
harvest half is deleted.

**Writing the partner's real name into the cloud.** Two designs add
`applePersonName` to the `Owner` record. Today the roster is deliberately
pseudonymous ("Me", "Her"). Keep the Apple-name → owner-id mapping in local
script config.

**Envelope encryption under a user passphrase.** Cited as the mitigation that
reconciles cloud persistence with biometric minimisation, and it is the right
architecture per EDPB Opinion 11/2024. **There is no passphrase.** Auth is
GoogleProvider only. Either accept a device-local gallery with explicit
re-enroll, or introduce a real recovery secret and own the lost-code UX. Do not
plan around a key that does not exist.

**`WardrobeItem.owners` as a training label.** Three designs treat it as a
hand-labelled ownership dataset. `commitScanReview` hardcodes it and
`app/closet/scan/` has no owner UI. Any model trained on it learns "default = me"
and reports a healthy AUC while doing so. Fixed by one nullable timestamp
(`ownersConfirmedAt`) — which is why that column appears in Phase 0.

**Whole-roll embedding in the browser.** Four designs run the existing wear scan
(7 crop windows per photo, one MobileCLIP pass each) over the entire roll. At
40,000 photos that is ~320,000 WASM forward passes — 13 to 62 hours of foreground
Safari — producing 655 MB of vectors against a ~100 MB page ceiling. One of them
describes this as "costs nothing at all — it runs in the browser worker on
hardware the user already owns." It costs no dollars and roughly a day and a half
of the user's phone. Salvageable only by moving the embedding stage behind moment
bucketing and dHash collapse, or server-side.

**`HTMLVideoElement` + `requestVideoFrameCallback` in a Web Worker.** No DOM, no
`HTMLVideoElement`. The film-your-closet design's decode step must move to the
main thread (seek, `drawImage`, `createImageBitmap`, transfer) or to WebCodecs
`VideoDecoder` with a container demuxer. *The premise survives and is strong* —
it is the only approach where identity, visibility and dedupe are all solved by
construction, and the shot-boundary-in-embedding-space trick reuses an encoder
that is already staged. But its 0.93/0.85 thresholds are guesses, and a shared
rail still produces mixed ownership.

**Gemini as the identity oracle.** ~70% on FaceXBench, 66.03% on age-gap pairs,
no refusal to warn you, and a Prohibited Use Policy that puts the project's
single API key at suspension risk. Identity language must never cross the API
boundary; the safe framing is positional ("describe the clothing on the person
inside this box").

**Gemini segmentation masks.** Google removed the capability: "Image segmentation
capabilities … are not supported in Gemini 3 Pro or Gemini 3 Flash." Even on 2.5,
a person/hat/jacket prompt returned a degenerate all-`true` mask in an
unterminated array.

**`temperature: 0` for reproducible classification.** Counter-recommended by
Google on Gemini 3, and it never delivered determinism anyway. Consequence:
nothing downstream may key on the generated `name` string — which `dedupeGarments`
and `titlesLikelySame` both currently do.

**Perceptual hashing as a same-garment matcher.** §2.8. It survives as an
exact-frame gate at Hamming ≤ 10 and nothing more. wHash and colourhash are ruled
out entirely: at 1M images colourhash produced three zero-distance equivalence
classes of over 20,000 images each.

**Union-find transitive closure over thresholded pairs** — the current
`scan-duplicate-groups.ts`. Abandoned in the literature for disregarding negative
classifications.

**`persons.length === 1` as the identity rule.** It structurally deletes the
shared-garment case, which is why `SHARED_OWNER_FILTER` exists. A jumper both
people wear gets imported as single-owner and vanishes from the other's filtered
view. Same verdict for any owner cannot-link in clustering.

**Continuous background camera-roll scanning.** Meta shipped it in June 2025 and
produced two 500+ point HN threads despite being opt-in. One design identifies
this and proposes it anyway as its top autonomy rung. Cap the ladder below it.

**"Our privacy engineering is good enough that we don't need to ask."** Apple ran
this experiment with Enhanced Visual Search — homomorphic encryption, private
information retrieval, an OHTTP relay — and ate a multi-week news cycle in
January 2025 purely for shipping it default-on.

**Grounded-SAM / Grounding DINO in the browser.** The smallest ONNX build is 151
MB at q4f16 and 719 MB at fp32. SAM emits no labels; practitioners report the
returned mask oscillating between the shirt and the whole person.

**Free-tier Gemini.** Every free-tier row is marked "Used to improve our
products: Yes." Not an option for family photos. Worth a comment in
`.env.example` so a future contributor does not "save money."

---
## 5. Recommendation — testing now, product later

§0 sets the posture: personal permissions, product-grade choices. This section
is written against that. Phase ordering is driven by what is expensive to
reverse, not by what is interesting.

The shape of the revision: **almost everything expensive got cheaper to *permit*
and harder to *justify*.** Licences and compliance stopped mattering. Scale
never started. What survives is a short list of fixes to things that are already
broken, one genuine capability addition, and a deliberate refusal to build the
face gate.

### Phase −1 — cloud persistence (before anything in this document)

The stolen laptop is why this app must not be local-only, and there is no
deployment target in the repo: no `Dockerfile`, no `fly.toml`, no `vercel.json`,
no `render.yaml`. `docker-compose.yml` is Postgres 16 plus a MinIO profile
described in its own comment as a "stand-in for Cloudflare R2," and the README's
production section is `pnpm build && pnpm start` on localhost with a tip about
LAN access from a phone.

Every phase below assumes this is solved. It is not. Neon Postgres + Cloudflare
R2 was the stated target; until data actually lives there, importing *more*
data onto the Mac increases what a second theft costs.

This is not a camera-roll task, which is exactly why it keeps not getting done.

### Phase 0 — fix what is already broken (one day)

Five verified defects, none of which are about person isolation, all of which
corrupt the data that person isolation would produce. This phase has no research
component and no kill criterion; it is maintenance that happens to be blocking.

| File | Change |
| --- | --- |
| `lib/uploads.ts:65` | Add `.withMetadata()` and an explicit `.toColourspace('srgb')`. Display P3 iPhone photos are currently written as untagged sRGB, so the hue is shifted before the classifier maps it onto `FAVORITE_COLOR_OPTIONS`. Colour is the field every dedupe signature, blocking key and stylist rule depends on, and it is wrong by an unmeasured amount. **Measure the shift before and after** — this is the one change here with a number attached. |
| `lib/wear/encoder.ts:74` | Force `device: "wasm"`. `hasWebGPU()` now returns true on iOS 26 Safari, so the shipped wear path selects the WebGPU/JSEP provider and hits ORT #26827 and #27584. `numThreads = 1` does nothing when the device is webgpu. If she uses this on her phone, it is failing there today. |
| `lib/services/garmentClassifier.ts:340` | `detectGarmentBounds` demands 0–1 floats and explicitly forbids "a 0-1000 grid" — which is the exact format Gemini was post-trained on, with the axis order flipped. Ask for `box_2d: [ymin, xmin, ymax, xmax]` at 0–1000 and convert in TypeScript. |
| `lib/services/garmentClassifier.ts:101` | Delete "Skip selfies where a person is the subject." It discards the only input class that carries identity, and NegBench found VLMs handle exactly this negation framing at chance. Replace with a required positive `sceneType` enum, filter server-side. |
| `lib/services/gemini-text.ts:19` | Drop `temperature: 0` — Google's Gemini 3 migration guide says to remove it, and it never bought determinism anyway. |
| `lib/server/camera-roll-scan.ts:218` | `owners: encode(sel.ownerIds ?? [primaryOwnerId])`, plumbed from a **Me / Her / Both / Neither** control on the review grid. Add `WardrobeItem.ownersConfirmedAt`. |

That last row is the entire person-isolation feature for a two-person household,
and it is a segmented control. Ship it before considering anything below it.

### Phase 1 — the Apple funnel (2–3 days)

The Mac path, kept deliberately small. Upstream's own position is that the 27
`score.*` fields are reverse-engineered and only `overall` is dependable, so
percentile machinery over 26 uninterpretable floats is not worth building for
two people.

Use exactly: `--person`, `overall`, `screenshot`, `selfie`, `panorama`,
`ismissing`, `persons`.

Four traps, all of which bite before `--person` helps:

1. **`osxphotos` may not install.** Upstream #2175 (open, filed 2026-07-18) kills
   every osxphotos command — including `osxphotos version` — on macOS 26.5.x
   Apple Silicon in an unsigned venv, via AMFI rejecting pyobjc/wrapt `.so`
   files. This machine is macOS 26.5.1. Budget this as "unknown, possibly
   blocked," not twenty minutes. **Do this first**; it gates the phase.
2. **`queryPhotos()` will overflow.** `scripts/mac-photos-scan.ts:90` runs
   `osxphotos query --json` over the whole library into `execFileSync` with a
   64 MB `maxBuffer`. `--json` serialises full `asdict()` including all 27 score
   fields and every `face_info` entry. Use `--field` templates or stream.
3. **`_UNKNOWN_`.** An unnamed Apple cluster arrives as that literal string, and
   `ownerIdFromName` will happily slug it into a third owner. Every distinct
   unnamed cluster collapses to the same string, so you cannot even count them.
   Handle it explicitly or it reproduces the hardcoded-owner defect through a
   new path.
4. **iCloud optimised storage.** With it on, most assets are `ismissing` with
   `path = None`. Gate on `not photo.ismissing and photo.path`, or an import can
   silently do nothing while reporting success.

*Kill criterion:* hand-label 200 photos returned by
`osxphotos query --json --person "<owner>"`. If under ~40% are usable, demote
`--person` from a filter to a ranking signal. If `persons` is empty on more than
half the photos that visibly contain her, the Apple clusters are too sparse and
Phase 1 is the whole feature — stop here.

### Phase 2 — local cutout, replacing paid ghosting (3–5 days)

The one genuine capability addition, and the only place the deployment decision
buys something real rather than removing an objection.

**BiRefNet (MIT)**, and only BiRefNet. RMBG-1.4 is non-commercial and `@imgly`
is AGPL-3.0; both were unblocked by the personal-deployment read and are
re-blocked by the enterprise one. BiRefNet was never a licence problem — it was
a browser-memory problem, and the import path no longer runs in a browser. Run
it in `onnxruntime-node` in-process; do not build the FastAPI sidecar until
something actually needs Python.

Three corrections to the enthusiastic version of this:

- **It does not make ghosting cost zero.** The ghost is not only a tile.
  `lib/actions/embeddings.ts:54` builds the MobileCLIP wear-retrieval corpus from
  `ghostImagePath ?? originalImagePath`; `app/closet/try-on/page.tsx:74` uses it;
  `whiten-background.ts` describes the cutout as feed for try-on compositing;
  `lib/item-tile-meta.ts` reads mirror/thumbZoom off the `ghostViews` row. A
  cutout of a worn photo — arms across the garment, perspective, occlusion — is
  not a drop-in for a studio ghost. It is *a worse tile and a truthful one*.
- **It is the right answer for footwear specifically**, and that is the one place
  it settles an open question. `ghostMannequin.ts:119` keeps footwear on fal
  Seedream because Gemini won't pose shoes upright — a measured exception that
  contradicts "Gemini is the only paid API." A local cutout kills the last fal
  dependency without regressing to a known-bad Gemini output.
- **Re-run the calibration afterwards.** `lib/wear/photo-match.ts` hardcodes
  `BACKGROUND_SIMILARITY = 0.432`, `MATCH_FLOOR = 0.841` and a 0.05 clarity
  margin, all measured on a corpus of Gemini ghosts. Mixing cutouts into it
  invalidates them. `pnpm benchmark:wear-retrieval` and `pnpm calibrate:wear-match`
  both already exist. Either backfill or consciously accept a mixed corpus.

### Phase 3 — dedupe (1–2 weeks, and only if Phase 0–2 have shipped)

Dedupe is the one sub-problem the deployment decision does not help with at all,
and §2.9 is unforgiving: p99-between-distinct (0.841) sits *above*
mean-nearest-neighbour-for-same (0.816). That is a representation failure, not a
threshold to tune.

Cheapest attack first, in order:

1. **Fix the union-find.** `scan-duplicate-groups.ts` is transitive closure over
   every pair passing a threshold, with no negative-edge handling — one weak
   bridging pair merges two real garments. Mutual-kNN edges plus core-point
   support. This is a contained change to one file.
2. **Ship manual split.** At roughly 3,000 vectors with two users, a split
   affordance is cheaper than any clustering improvement and is required anyway.
3. **Reorder `runCameraRollScan`.** `lib/jobs/runner.ts:241` runs
   `assignDuplicateGroups` *after* the Gemini pool drains, so dedupe can never
   save a call. Cluster before classify.
4. *Only then* consider a second embedding tower. DINOv2's DISC21 evidence (~64%
   vs CLIP's 28.45% on "same physical thing") is the only lever that attacks
   representation — but embeddings are computed **client-side** today
   (`lib/actions/embeddings.ts` hands paths to a browser worker), so a
   server-side 768-d tower needs a new ingest path, a second vector column and a
   full backfill. Not an afternoon.

### Phase 4 — two upload modes, and an ephemeral reference set (1–2 weeks)

This supersedes S2 and I1 in §3, which proposed the two halves separately. The
combination, plus one architectural change neither made, is the design.

**Mode A — "these are photos of me" (ship alone, first).** The existing
`<input type="file" multiple>` in `scan-client.tsx` already opens the OS picker
with no permission prompt and no library authorization. Make the instruction a
step with its own screen rather than a hint. No model, no faces, no legal
surface, and no recall problem, because the user selected the photos.

This is also the industry-validated path: every shipping bulk import in §2.1 is
capped at 25–30 deliberately-selected photos. Nobody ingests an unfiltered roll.
Mode A is not a lesser fallback, it is what the category actually does.

**Mode B — whole roll, gated on a hand-picked reference set.** If the user
explicitly wants the whole roll, require them to pick a handful of photos of
*just themselves* first. Detect faces with YuNet, apply the mandatory 5-point
similarity transform (§2.5), embed with SFace, and average into a centroid.
Score every candidate photo's faces against it. **Then discard every vector.**

**The architectural change: the reference set is ephemeral.** I1 assumed a
persisted enrolled gallery and died on two objections that this kills outright:

- *Key management.* I1's blocker was "envelope-encrypt under a passphrase — but
  auth is a magic link and there is no passphrase." Nothing is stored, so there
  is nothing to encrypt and no recovery-code UX to own.
- *Biometric retention.* This is precisely the *Zellmer v. Meta* fact pattern —
  face signatures that are "simply numbers," deleted immediately after matching,
  never retained. Combined with *G.T. v. Samsung* on control, an ephemeral
  reference set is the strongest posture available to a product that must also
  persist data in the cloud. Persist the *scalar threshold* if you like; never
  the vectors.

**What this does not buy.** Two honest corrections, because "no face DB" is
narrower than it sounds:

1. *You still ship a face model.* YuNet + SFace are still built, shipped and
   maintained. The saving is legal and operational, not ML effort.
2. *Third parties are still processed, just not retained.* Deciding "is the owner
   in this photo" requires detecting and embedding **every** face in every
   candidate — the partner, friends, strangers in backgrounds. That is defensible
   because it is transient, which is exactly what Zellmer turned on. It is not
   "no biometric processing," and an enterprise DPA will ask. Document it as a
   deliberate design property, not an omission.

**The real cost is recall, and it is severe.** Face-gating systematically
rejects the photos that are *best* for cataloguing clothes. Roughly a third of a
roll has a detectable face at all, and the correlation runs the wrong way: the
full-length outfit shot taken at distance, the mirror selfie with the phone over
the face, the back-turned shot, the cropped-off head — these are the highest-value
garment photos and the lowest-value face photos. §2.4's Immich user says it
directly: *"Sometimes you want to tag someone whose face isn't visible, but you
recognize them due to their clothes in other pictures."*

**Recover it with Apple's temporal fence, which the reference set makes free.**
A hand-picked reference photo carries an EXIF timestamp, so it anchors an entire
*moment*. Within a 10-minute bucket, propagate identity by torso/appearance
similarity — Apple's `D = min(F, α·F + β·T)` with T compared only inside a
moment (§2.4). Across moments, use the face only. This is the one place clothing
appearance is a legitimate identity signal rather than a circular one, and it
recovers exactly the face-not-visible photos the gate would otherwise drop.

**Two-person calibration is a genuine free win.** §2.5's doctrine is per-user
thresholds, and this repo's own history (`MATCH_FLOOR`) says absolute cosine
means nothing. With exactly two enrolled people, the threshold is not a guessed
global constant — it is the midpoint between two centroids, measured. That is far
more robust than anything a single-enrollee design can do, and it degrades
gracefully as the roster grows.

**On macOS this whole mode is redundant.** `osxphotos --person` already has the
answer, computed by Apple, for free, with no model and no biometric processing
by this app at all (§3.1, Phase 1). Mode B is the **web/iOS path**. Do not build
it for the Mac.

*Kill criterion:* hand-pick 8 references, then score 200 held-out roll photos
containing both people. If no threshold reaches ≥95% precision on "is the owner"
at ≥40% recall — measured with the **partner as the hard negative class**, not
strangers — ship Mode A only and let the §5 Phase 0 toggle carry Mode B's cases.

### What this plan deliberately does not build

- **A persisted face gallery, a People page, or any 1:N clustering over everyone
  in the roll.** Phase 4 replaces all three with an ephemeral reference set. The
  thing that was legally toxic was never "running a face model" — it was
  *retaining templates for people who never consented*, which is the Facebook
  Tag Suggestions fact pattern behind the $650M/$100M/$1.4B/$1.375B outcomes.
  Compute, compare, discard.
- **The Python sidecar.** Everything actually recommended runs in
  `onnxruntime-node` in-process. Build it if and when something needs it.
- **Batch API, contact sheets, token-accounted quota.** All are optimisations of
  a line item that is ~$0.12 per scan against a $0.067-per-item ghost bill. The
  arithmetic does not support the ceremony *at two users*. Revisit every one of
  them the moment there is a third tenant — and note that scan spend is
  currently unmetered (`checkAiQuota` counts only `tryOnGeneration` and
  `virtualTryOn`), which is bounded today only by `MAX_SCAN_PHOTOS = 50`. That
  is a personal-scale accident, not a design.
- **Nightly launchd import.** Attractive, and the reputational objections that
  killed it are gone. But it does not run on a sleeping laptop, needs the Mac
  unlocked for Full Disk Access on the Photos bundle, and silently imports
  nothing under iCloud optimised storage. Revisit after Phase 1 proves the
  funnel works when run by hand.
- **Receipts, film-your-closet, provenance auction.** All still interesting, all
  still orthogonal, none of them one day of work. §3 keeps them.

---

## 6. Open questions

Q1 is answered (§0). Q3 (children) and the BIPA-shaped parts of Q2 are moot.
What remains:

**1. Does she use this on her phone?** "Personal deployment" fixes where import
runs; it does not say where daily use happens. If she browses the closet, logs
wears or gets outfit proposals on iOS, the web path still matters and the
WebGPU defect in `encoder.ts:74` is failing on her device right now. This also
decides whether Phase −1's cloud target needs to serve two phones or one Mac.

**2. Where do face templates live?** Enrolment is agreed, so the open question
is architectural and it is the one with the longest reversal cost. The only
posture that survives an enterprise deployment with mandatory cloud persistence
is: templates derived on the client, compared, and discarded — never at rest in
a form the server can use. Decide this before the first schema migration, not
after.

**3. Will "Her" ever have a login?** `linkedUserId: null` in `lib/owners.ts`
means she is currently a data subject with no controls and no deletion path.
Ethically this matters more once her clothes are in a cloud database than it did
when everything was on one laptop.

**4. How much of the existing 180-item closet has hand-set owners?** Ten minutes
of looking, and it decides whether `ownersConfirmedAt` is a prompt or a
migration.

**5. Ghost-mannequin — keep, defer, or replace?** Phase 2 argues replace, for
footwear at minimum. It is the dominant cost line, it is the last thing holding
the fal dependency, and your own notes record that Gemini disobeys the pose
instruction. But a local cutout is genuinely a worse tile for anything shot on a
body, and the try-on and embedding paths both consume ghosts.

**6. Date range, and does "past self" need excluding?** A three-year roll
contains clothes you no longer own, and no visual signal distinguishes "wore it"
from "owns it." Google chose four years. The alternatives are a date window, a
"still own this?" step, or accepting the noise.

**7. What is an acceptable wall clock for one scan?** For a personal deployment
the honest answer is probably "overnight, unattended," which re-admits most of
what a 60-second budget excluded. Worth stating explicitly, because it changes
which designs in §3 are even candidates.
