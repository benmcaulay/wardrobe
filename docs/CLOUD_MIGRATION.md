# Getting your data off this laptop

Everything currently lives in two places on this machine and nowhere else:

| What | Where | Survives a stolen laptop? |
| ---- | ----- | ------------------------- |
| Database (items, outfits, trips, ledger) | local Postgres 16, `wardrobe` DB | **No** |
| Images (originals, cutouts, ghost renders) | `./uploads/<userId>/` | **No** |

Target: **Supabase** for both — one account, one bill, one dashboard. The app
code needs no changes; `lib/storage.ts` already speaks S3 and Prisma already has
the `directUrl` the Supabase pooler requires.

## Right now, before anything else

```bash
pnpm db:backup
```

Writes `backups/wardrobe-full-<timestamp>.zip` containing the database dump and
`uploads/`. Copy it somewhere that is not this laptop. This is a stopgap, not the
fix — a backup from Tuesday does not help with Wednesday's photos — but it closes
the window while you set the rest up.

## Step 1 — Create the project

<https://supabase.com/dashboard> → New project. Note the **project ref** (the
subdomain in your project URL, e.g. `abcdefghijklm`) and the **region** you
picked; both are needed below.

## Step 2 — Database

Supabase gives you two connection strings, and this app needs **both**. That is
not redundancy: the transaction pooler (Supavisor, port 6543) does not support
prepared statements or DDL, so runtime queries go there while migrations need a
session-mode connection on 5432.

From Project Settings → Database → Connection string:

```
# Transaction pooler (6543) — normal app queries. Note the ?pgbouncer=true.
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Session pooler (5432) — migrations only.
DIRECT_DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Use the **session pooler** on 5432 for `DIRECT_DATABASE_URL`, not the
`db.<ref>.supabase.co` host the dashboard also offers. That direct host is
**IPv6-only** on current projects — verified for this project: it has an AAAA
record and no A record. It resolves fine from a machine with IPv6 egress and
fails everywhere without one, which includes GitHub Actions, so migrations run
from CI would break in a way that looks like a credentials problem. The session
pooler is IPv4 and supports DDL and prepared statements, so it satisfies
everything `directUrl` needs.

Both are already wired: [prisma/schema.prisma](../prisma/schema.prisma) declares
`url` and `directUrl`, so `prisma migrate` picks the direct one automatically.

Create the schema:

```bash
pnpm prisma migrate deploy
```

To carry your existing rows over rather than starting empty, dump locally and
restore into Supabase first, then run `migrate deploy` to confirm the migration
history lines up:

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_dump \
  "postgresql://wardrobe:wardrobe@localhost:5432/wardrobe" \
  --no-owner --no-acl -Fc -f /tmp/wardrobe.dump

/opt/homebrew/opt/postgresql@16/bin/pg_restore \
  --no-owner --no-acl -d "<your DIRECT_DATABASE_URL>" /tmp/wardrobe.dump
```

Restore through `DIRECT_DATABASE_URL` (the session pooler on 5432), not the
transaction pooler on 6543 — `pg_restore` issues DDL, which 6543 refuses.

## Step 3 — Images

Dashboard → Storage → create a bucket, e.g. `wardrobe-images`. Keep it
**private**; the app hands out short-lived signed URLs and does its own
authorization first.

Then Storage → S3 Access Keys → New access key. This is a distinct credential
from the `anon` and `service_role` API keys — those will not work here.

```
STORAGE_DRIVER="s3"
S3_BUCKET="wardrobe-images"
S3_ENDPOINT="https://<project-ref>.supabase.co/storage/v1/s3"
S3_REGION="<your project region, e.g. us-east-1>"
S3_ACCESS_KEY_ID="<from S3 Access Keys>"
S3_SECRET_ACCESS_KEY="<from S3 Access Keys>"
S3_FORCE_PATH_STYLE="true"
```

Three of these are easy to get wrong:

- **`S3_FORCE_PATH_STYLE` must be `"true"`.** Supabase does not do
  virtual-host-style addressing; without it every request 404s.
- **`S3_REGION` must be your real project region.** R2 accepts `auto`; Supabase
  signs against the region and rejects a mismatch.
- **Use the S3 access key, not the service_role key.**

Verify before trusting it:

```bash
pnpm test:s3
```

Real round trip against a local S3 server: put, exists, get, signed-URL fetch,
prefix delete, path-traversal rejection — then the whole suite again under the
legacy `R2_*` names. It runs under a throwaway key prefix and clears any real
credentials from the environment first, so it cannot touch your bucket.

Copy the existing images up, keeping the `<userId>/<file>` layout — the database
stores those relative paths and they are used unchanged as object keys:

```bash
rclone copy ./uploads supabase:wardrobe-images --progress
```

## What changes in the app

Nothing you have to write. With the `s3` driver, `/api/images/[...path]` returns
a 302 to a 5-minute signed URL instead of streaming bytes
([storage.ts](../lib/storage.ts)). Authorization still happens first and keys are
still scoped to the requesting user, so a signed URL can only ever be obtained
for your own files.

The env vars are named `S3_*` rather than `SUPABASE_*` on purpose: the driver is
plain S3, and the same names work if you ever move to R2 or AWS. The older `R2_*`
spelling is still read as a fallback, so an existing `.env` keeps working.

## Worth knowing

- **Egress is metered.** This is the one real argument for R2 over Supabase for
  this app: R2 charges nothing for egress, Supabase bills bandwidth past its
  tier, and a closet full of 200–400KB renders is exactly that workload. If the
  bill starts to sting, `S3_PUBLIC_BASE_URL` in front of a CDN is the first
  lever, and moving just the bucket to R2 later is a config change plus an
  `rclone copy` — the database can stay on Supabase.
- **Latency.** A hosted database is 20–80ms away instead of 0.2ms. Pages that do
  several sequential queries will feel it.
- **Free tier pauses.** An idle Supabase project suspends after a week of
  inactivity; the first request after that wakes it and takes a moment.
- **`.env` is still local-only.** It is gitignored, so it will not travel to your
  next machine either. Put the connection strings and S3 keys in a password
  manager — that is the piece that stops a lost laptop from costing you the setup
  a second time.
- **Deleting `uploads/` afterwards.** Only once `pnpm test:s3` passes *and* a page
  renders images from Supabase. Until then it is your only copy.
