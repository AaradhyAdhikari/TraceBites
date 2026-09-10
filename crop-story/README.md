# Crop Story

Verifiable provenance for agricultural produce, from field to shelf.

**SIH25045** — Blockchain-Based Supply Chain Transparency for Agricultural Produce · Team Orians

This is the rebuild. The earlier prototype (`farm-to-table-trust-64`) demonstrated
the idea with mock data and `localStorage`; this repository is the working system.

---

## The one idea

A batch and its custody events are the product. Every dashboard, QR code and
price chart is a read-model over one append-only, hash-chained log.

```
farmer registers harvest
  └─ batch row  +  HARVESTED event      seq 1   hash = sha256(canonical(event))
                   PHOTO_ATTACHED       seq 2   hash = sha256(canonical(event) + prev)
                   PRICE_SET            seq 3   hash = sha256(canonical(event) + prev)
                        ↓
                   QR code → /v/RS1234-WH5432-7 → public verification
```

Changing event 2 after the fact invalidates 3 and everything after it. That is
what makes the record checkable by someone who trusts none of the parties in
it — including whoever runs this database.

## What is in this build (Phase 1)

- Postgres schema for the whole chain, with `custody_events` protected by a
  database trigger that rejects `UPDATE` and `DELETE`
- Canonical hashing and chain append (`src/lib/ledger.ts`)
- Batch codes with a check character (`src/lib/batch-code.ts`)
- Phone-OTP sessions, no email required
- Farmer flow: register harvest with photo + GPS, offline queue, my batches,
  batch detail with printable QR
- Public verification page, server-rendered, no login, recomputes the whole chain
- Chain adapter interface with a local development adapter
- `CropStoryRegistry.sol` — the Polygon contract surface (not yet deployed)

Distributor, retailer and consumer flows, the Polygon adapter, and the price and
advisory models follow in Phases 2–4.

## Running it

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres on :5433
npm run db:migrate   # applies sql/*.sql in order
npm run db:seed      # one FPO, three farmers, two worked example batches
npm run dev
```

Then sign in at <http://localhost:3000/login> with **9876500001** and any
six-digit code. The seeded wheat batch already carries a retail price, so its
verification page shows a real farmer-share bar.

`npm run db:reset` tears the database down and rebuilds it from scratch.

## Layout

```
sql/                     migrations, applied in lexical order
  0000_init.sql          the schema
  0001_ledger_guards.sql append-only triggers — re-run on every migrate
src/db/schema.ts         Drizzle mirror of the SQL, used for queries
src/lib/ledger.ts        canonical serialisation, hash chain, verification
src/lib/harvest.ts       the only place a batch comes into existence
src/lib/chain/           adapter interface + local dev adapter + Polygon stub
src/app/farmer/          the farmer PWA
src/app/v/[code]/        public verification — no auth, works on 2G
contracts/src/           CropStoryRegistry.sol
```

## Decisions worth knowing before you change anything

**Money is integer paise.** Never a float, anywhere. Format at the edge only.

**The batch code is a label, not a key.** `RS1234-WH5432-7` is legible on a crate
and typeable on a phone, but it collides across two farmers with the same
initials and it leaks a name. The row's UUID is the key. The trailing check
character means a mistyped code fails rather than quietly resolving to a
stranger's harvest.

**Personal data never goes on chain.** Names, phone numbers, plot coordinates and
photos live in Postgres; only salted hashes are anchored. The DPDP Act 2023
grants a right to erasure that an immutable ledger cannot honour — deleting a
person's salt makes the on-chain value permanently unlinkable, satisfying the
obligation while leaving the chain intact. `LEDGER_SALT` is therefore not a
throwaway secret; losing it breaks verification for every past event.

**The canonical event shape is frozen.** `CanonicalEvent` in `src/lib/ledger.ts`
defines the exact bytes that get hashed. Changing its shape invalidates every
event ever written. Add fields inside `payload`, never to the envelope.

**Never make a user wait on a block.** Writes commit to Postgres and enqueue in
`outbox`; a worker carries them to the chain and writes the tx hash back. If the
chain is unreachable the product keeps working and the backlog drains later.

**The local chain adapter is honest about being fake.** It returns `local:…`
hashes with `onPublicChain: false`, and no screen renders those as verified. A
demo that shows a fabricated transaction hash is precisely what this project
exists to eliminate.

**Correct a mistake by appending, never by editing.** The database will refuse
the edit. Write a compensating event instead — that is what an audit trail is.

## Not done yet

- Polygon adapter (`src/lib/chain/polygon.ts` throws by design until the
  contract is reviewed, fuzz-tested and deployed)
- Foundry tests for `CropStoryRegistry.sol`
- Service worker for offline page loads — the harvest queue already survives
  offline via IndexedDB, but the app shell does not yet
- Real SMS for OTP (`sendOtp` logs to the console; any six digits are accepted)
- i18n — Hindi and Marathi strings exist in the crop master data only
