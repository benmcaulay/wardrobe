# Ghost bakeoff fixtures

Drop garment photos here, then run:

```bash
pnpm ghost:bakeoff -- --fixtures=./fixtures/ghost --config=./scripts/ghost-bakeoff.variants.example.json
```

## Naming

- Any `.jpg` / `.jpeg` / `.png` / `.webp` file is a fixture.
- **Default is untyped (`full`)** — the prompt asks the model to identify the item from the image.
- Optional category override via prefix: `upperbody__hoodie.jpg`, `footwear__sneakers.png`.
- Or a sidecar meta file, e.g. `hoodie.meta.json`:

```json
{
  "category": "upperbody",
  "compositionHint": "default",
  "instructions": ""
}
```

Only set a category when you want to force a specialized pose (e.g. footwear pair angle). For bakeoffs, leave images untyped.
