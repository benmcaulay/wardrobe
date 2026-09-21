# Decisions

Durable memory for this repo: one short entry per non-obvious decision or
gotcha, append-only. **Read it before re-deriving why something is the way it
is**, and add to it when something costs real time.

Format is `**YYYY-MM-DD · area · One-line claim.**` followed by a short
paragraph. The one-line claim is the part that gets read, so make it a claim
and not a topic. graphify indexes this file alongside the code, and
`startup-rig`'s Memory page graphs every repo's copy together.

Seeded 2026-09-19 from facts already recorded elsewhere in the estate --
mostly in `startup-rig`'s own `DECISIONS.md`, its `config/projects.yaml`
comments, and its audit notes. It is deliberately short: entries here were all
paid for once. Nothing was invented to fill it out, because a file full of
decisions nobody made stops being read.

**2026-09-19 · deploy · This repo deploys on Vercel as `makingspace`, not as
`wardrobe`.** The repo name and the Vercel project name differ, and the live
site is `makingspace.cloud`. Anything that maps repo to deployment by name
gets this one wrong; `startup-rig` carries an explicit `vercel_project:
makingspace` override for exactly this reason.

**2026-09-19 · scope · What this is: a wardrobe cataloguing web app.** Log the
clothes you own, get outfit suggestions. Recorded because the name is
ambiguous enough that a model asked to propose features will invent a different
product.

**2026-09-19 · size · The largest graph in the estate: ~4,100 nodes over 553
files and 513k words.** Roughly three times the next repo. Consequences: a
local model cannot hold meaningful context over it, and it is the repo where
consulting the graph before reading files matters most.

**2026-09-20 · jobs · On Vercel Hobby nothing reliably drains the job queue, so
a render can sit untouched for hours.** `kickJobDrain` is fire-and-forget after
the response and serverless freezes the instant it responds, so inline draining
is luck. The backstop is `/api/cron/drain`, and Hobby rejects any cron more
frequent than daily — the deployed schedule is `0 3 * * *`. A ghost generation
started at noon can therefore genuinely do nothing until 3am. The UI used to
show a spinner and "generating in the background" throughout, which is why this
read as a hang rather than a queue. Fixing the wait properly means minute-level
cron (Pro) or keeping the function alive past the response; until then the UI
says which of the two it is.

**2026-09-20 · jobs · `status` alone is two words for five situations; poll
`describeJobProgress` instead.** Queued-and-unclaimed, queued-and-retrying
(`markJobFailed` puts a retryable job back to `queued` *with the error still
set*), running-with-a-live-lease, running-but-the-worker-died, and out of
retries all used to render the same spinner. The distinctions are already in
the row — `attempts`, `updatedAt` vs `JOB_LEASE_MINUTES`, `error` — they just
were not being read.

**2026-09-20 · db · Writing job timestamps with raw SQL puts them hours off;
Prisma is the only writer that agrees with the readers.** The datetime columns
are `timestamp without time zone`. Prisma writes naive UTC; the pg driver
serialises a JS `Date` as naive *local*, so a seeded row read back 7h wrong on a
US West machine and a 30-minute-old job displayed as 7h30m. `claimNextJob`
already carries the same warning for `NOW() AT TIME ZONE 'UTC'` — the rule
generalises to any hand-written insert.

**2026-09-20 · ai · Every vision/text call goes through `vision-text.ts`, which
can answer from Gemini or from a local Ollama model.** The six callers (garment
classifier, garment bounding boxes, directive/trip/style-note parsers, product
identification) previously imported `gemini-text` directly. `VISION_PROVIDER`
picks; Gemini stays the default because the deployed app has no laptop to call,
so a local default would work in dev and fail in production. Measured on a real
closet photo: `qwen3-vl:8b` classified it correctly in 4.2s, free, offline.

**2026-09-20 · ai · Ollama cannot replace ghost-mannequin rendering, only the
cheap calls.** Qwen3-VL is vision-*language*: it reads images, it does not make
them, and Ollama serves no diffusion models at all. So the local option saves
the ~$0.0001 classification calls and leaves the $0.067/render generation
exactly where it was. Worth stating because "run the vision model locally"
sounds like it should kill the big line item.

**2026-09-20 · ai · Pull the `-instruct` tag of a Qwen3-VL model, not the bare
one.** The bare `qwen3-vl:8b` is the *thinking* variant, and it ignores
Ollama's `think: false`: the whole answer lands in `message.thinking` while
`message.content` comes back empty, so a naive reader sees "no text" on a
perfectly good reply. `ollama-text.ts` falls back to `thinking` for exactly
this, but the instruct tag is the right default — the calls all want one JSON
object, not reasoning.

**2026-09-20 · ai · ComfyUI autogrow inputs take DOTTED keys over the HTTP
API: `images.image_1`, not `images` or `image_1`.** This cost hours.
`/object_info` advertises `TextEncodeQwenImage21`'s reference input as `images`
with a template naming `image_1`…`image_16`, which invites three wrong guesses.
A bare `images` list and a list of `{image: link}` both queue with no
`node_errors` and are then **silently ignored** — the render succeeds having
never seen the photo. A plain `image_1` sibling dies at execution with
"unexpected keyword argument". The answer is in `_io.py`: `parse_class_inputs`
prefixes an autogrow input with its own id before expanding the template
(`finalize_prefix(["images"], "image_1")`), and `build_nested_inputs` splits
that dotted path back into the `{images: {image_1: tensor}}` the node wants.

**2026-09-20 · ai · To test whether a generator is actually reading its
reference image, render two different inputs at one seed and compare hashes.**
Eyeballing failed here: the first local render was a flawless studio photo of
black chinos from a photo of grey sweat shorts, and it took three more
plausible-looking wrong renders before the A/B made it unambiguous
(byte-identical output = the reference is not bound). Downstream would have
cached any of them into the closet as that item. Cheap, decisive, and it
distinguishes "bad at the task" from "never saw the input".

**2026-09-20 · ai · Local ghost renders cost ~3 minutes each on an M5 Pro, vs
~15s on Gemini.** Measured: 25 steps at ~5.6 s/step, 184s wall clock, with the
int8 DiT (7.3GB) + int8 text encoder (9.3GB) + VAE on 24GB unified memory. Free
per image, but not interactive — if this ever works it belongs on the job
queue, never in a request.

**2026-09-21 · ai · The renderer is chosen per request, and that choice is part
of the cache key.** `GHOST_PROVIDER` remains the deployment default, but
`GhostMannequinInput.provider` overrides it and rides the job payload, so the
Generate menu can offer cloud vs local per render. It had to reach
`deterministicHash` — the key already hashed `modelLabelFor(...)` precisely
because the endpoint is part of a render's identity — or asking for a local
render after a Gemini one would silently return the Gemini image. The option
list comes from `availableGhostRenderers()` on the server, never hardcoded in
the client: a laptop running ComfyUI has a local option and makingspace.cloud
never will.

**2026-09-21 · ai · Telling the local model that printed type is *set type*
fixes wavy lettering, but not wrong lettering.** A Stanford crewneck came back
with the wordmark rippling along the drape of the body it was photographed on:
the model had copied distortion that belonged to the photograph, not to the
artwork. `PRINTED_TEXT_RULE` in `ghost-provider-qwen.ts` names that distinction
— keep the design's own arc, drop the fold — and the letterforms came back
clean and evenly set. The letters were still wrong ("STALFORD NNIVERSITY"), and
40 steps did not help ("STAIFORD MNIVERSITY"). Glyph accuracy is a limit of
this model at int8, not a prompting problem.

**2026-09-21 · ai · A revision is a re-render that is told what to preserve,
not a surgical edit — img2img does not work on this pipeline.**
`TextEncodeQwenImage21` returns an *empty* latent and passes the reference as
conditioning only. VAEEncoding the reference and sampling at denoise 0.62 (the
standard way to anchor an edit) produced a dark, noisy image with the white
background destroyed. Reverted. So revisions fix what you ask for and can drift
on what you don't: the first one corrected the misspelled wordmark perfectly
and turned the red sweater taupe. `buildRevisionPrompt` lists what must
survive, and the UI tells the user to name anything they care about.

**2026-09-21 · ai · 1536px references are not usable on 24GB.** Raising
QWEN_GHOST_RESOLUTION to 1536 to give small print more pixels took the sampler
from ~5.6 s/step to ~149 s/step — memory thrashing, ~100 minutes projected for
one image. The knob exists for a machine with more RAM; leave it at 0 here.
