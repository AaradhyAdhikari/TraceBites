# Handoff: get Crop Story onto GitHub and running

You are picking up a Next.js + Postgres project that has been **written but never
executed** — the machine it was authored on had no access to the npm registry, so
`npm install` has never run and no build has ever succeeded. Treat first-run
errors as expected work, not as evidence the repo is broken.

Two jobs, in order: **push it**, then **make it run**.

Owner: Aaradhy Adhikari (`AaradhyAdhikari` on GitHub).
Project: SIH25045 — blockchain-based supply chain transparency for agricultural produce.

---

## Job 1 — Push to GitHub

The repo already has history on `main`. Do not re-init it and do not squash it.

```bash
cd crop-story
git log --oneline          # expect 6 commits, oldest: "Phase 1: the ledger, ..."
```

Create an **empty** repository at `github.com/AaradhyAdhikari/crop-story` — no
README, no .gitignore, no licence, because any of those create a commit that
makes the first push non-fast-forward. Then:

```bash
git remote add origin https://github.com/AaradhyAdhikari/crop-story.git
git push -u origin main
```

If `gh` is authenticated, `gh repo create AaradhyAdhikari/crop-story --public --source=. --remote=origin --push` does both steps.

**Before pushing, confirm `.env` is not tracked:**

```bash
git ls-files | grep -c '^\.env$'    # must print 0
```

`.env.example` is tracked and `.env` is not. Keep it that way — `LEDGER_SALT`
is a real secret in anything but local development.

---

## Job 2 — Make it run

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres 16 in Docker on port 5433
npm run db:migrate   # applies sql/*.sql in order
npm run db:seed      # one FPO, three farmers, two example batches
npm run dev
```

### Verify it actually works

Start with the ledger self-test — it needs no database and no Docker, so run it
the moment `npm install` finishes:

```bash
npm run verify             # expect: PASS 28, then PASS 40
```

These are the only parts of the repo that have been executed and are known green:
the hash chain and batch codes (28 assertions), and the sowing/irrigation rules
and earnings arithmetic (40). They assert that key order does not change a digest,
that altering a price or timestamp or GPS position is detected, that rehashing a
tampered event still breaks the following link, that a mistyped batch code is
rejected, that sowing windows wrap correctly across the year end, and that
unpriced batches never leak into a money total. **If either fails, stop and fix it
before anything else** — nothing downstream is meaningful if these are wrong.

Then the five app checks. The app is only correct if the last one passes.

1. <http://localhost:3000/login> — sign in with `9876500001` and any six digits.
2. `/farmer` lists two seeded batches.
3. Register a new harvest. It should redirect to a batch page showing a QR code.
4. Scan or open that batch's public URL `/v/<CODE>` in a private window — it must
   render **without a login**.
5. Corrupt one event and confirm the page notices:
   ```sql
   -- in psql: docker exec -it crop-story-db psql -U cropstory
   UPDATE custody_events SET payload = '{"tampered":true}' WHERE seq = 1;
   ```
   This **must fail** with `custody_events is append-only`. That trigger is the
   product working as designed. If the UPDATE succeeds, `sql/0001_ledger_guards.sql`
   did not apply — re-run `npm run db:migrate` and investigate before going further.

---

## Errors you are likely to hit, and what they mean

The code was type-checked without dependencies installed, so import-level and
version-boundary problems are the ones that survived.

| Symptom | Cause and fix |
|---|---|
| Peer-dependency conflicts on install | React 19 + Next 15.1. Prefer bumping `next` to latest 15.x over `--legacy-peer-deps`. |
| `Type 'PgTransaction' is not assignable to 'NodePgDatabase'` | Should already be fixed by the `Db` union in `src/lib/ledger.ts`. If a new call site trips it, widen at the call site — do **not** cast to `any`, because losing the transaction type is how partial writes get introduced. |
| `index(...).where(...)` rejected in `src/db/schema.ts` | Partial-index syntax differs across drizzle-orm minors. `schema.ts` is only used for queries — `sql/0000_init.sql` is what actually creates the tables — so it is safe to drop the `.where()` from the Drizzle definition and leave the SQL alone. |
| `Cannot find module '@/...'` when running `db:seed` or `db:migrate` | tsx resolves path aliases from `tsconfig.json`. Confirm `paths` is intact; if tsx still misses it, add `tsconfig-paths`. |
| `ECONNREFUSED ... :5433` | Postgres container not up yet. `docker compose ps`, then retry. Port is **5433**, not 5432, to avoid colliding with a local Postgres. |
| `LEDGER_SALT is not set` | `.env` missing. Copy `.env.example`. |
| Weather page shows "Could not reach the weather service" | Expected until verified. `src/lib/weather.ts` maps Open-Meteo's documented `daily` block but has never seen a real response. Call the endpoint by hand, compare the JSON, and fix `toDailyForecast` only. Do **not** substitute mock forecast data — the advisory correctly refuses to advise without a real forecast, and that refusal is the designed behaviour. |
| Tailwind classes not applying | `@apply` of custom component classes requires them in the same `@layer components` block — they are, in `src/app/globals.css`. Check the file was not reformatted. |

Fix these by correcting the code. If you find yourself deleting a check to make
an error go away, stop and leave a note instead.

---

## Rules for changing this code

These are not style preferences. Each one protects a property the product claims.

**Never alter `CanonicalEvent` in `src/lib/ledger-core.ts`.** It defines the
exact bytes that get hashed. Adding a field to that envelope silently invalidates every
event ever written. New data goes inside `payload`, which is already hashed.

**Never weaken the triggers in `sql/0001_ledger_guards.sql`.** They make
`custody_events` reject UPDATE and DELETE at the database level, so immutability
survives a careless migration. Correct a mistake by appending a compensating
event — that is what an audit trail is for.

**Money is integer paise everywhere.** Never a float. Format only at the edge,
via `src/lib/format.ts`.

**Do not make the local chain adapter look real.** `src/lib/chain/local.ts`
returns `local:` prefixed hashes with `onPublicChain: false`, and no screen
renders those as verified. A demo that shows a fabricated transaction hash is
exactly what this project exists to eliminate.

**Do not put personal data on chain.** Names, phone numbers, plot coordinates and
photos stay in Postgres; only salted hashes are anchored. This is what lets a
DPDP Act erasure request be satisfied by deleting a salt.

**`sql/` is the source of truth for the database.** `src/db/schema.ts` is the
Drizzle mirror used for queries. Change both together, or queries drift from
reality.

---

## What exists, and what comes next

Built (Phase 1): schema with append-only ledger · canonical hashing and
independent chain verification · batch codes with a check character · phone-OTP
sessions · field management · farmer harvest registration with photo, GPS and an
IndexedDB offline queue · my-batches and batch detail with printable QR · weather
and sowing advisory · earnings summary · public `/v/[code]` verification page ·
chain adapter interface · `contracts/src/CropStoryRegistry.sol`.

Deliberately absent, not forgotten: **price advisory** (needs the Agmarknet
pipeline) and the **schemes assistant** (needs a RAG index). Do not fill these
with mock data to make the dashboard look complete — a fabricated price forecast
is precisely what this rebuild exists to remove.

Not built: the Polygon adapter throws by design until the contract is deployed ·
no Foundry tests yet · no service worker (the harvest queue survives offline, the
app shell does not) · SMS OTP is a console log · i18n exists only in crop data.

Next after this runs: Foundry tests and an Amoy deployment, then wiring
`src/lib/chain/polygon.ts` with viem and serial nonce management, then the
distributor console — scan to receive, custody transfer, and batch splitting.

`README.md` has the architecture. Read it before making structural changes.
