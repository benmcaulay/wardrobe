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
