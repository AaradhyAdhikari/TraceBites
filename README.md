# TraceBites

**Scan a product. See its journey. Verify its story.**

A multi-role food traceability platform. A farmer registers a harvest and the system
mints a batch identity with a QR code. Each participant down the chain — packhouse,
distributor, retailer — records only the events they are responsible for. A consumer
scans the code and sees the whole history, including the parts nobody has proven.

---

## The idea in one diagram

```
FARMER            PACKHOUSE         DISTRIBUTOR        RETAILER          CONSUMER
registers  ──▶    packs      ──▶    ships       ──▶    receives   ──▶    scans
harvest           and grades        and stores         and shelves       the QR
   │                  │                  │                  │               │
   └──────────────────┴──────────────────┴──────────────────┘               │
                      append-only event ledger                              │
                                  │                                         │
                      event hashes ─▶ public chain                          │
                                                                            ▼
                                                                  product passport
```

Every event is hashed when it is written and linked to the event before it. Changing
event 3 after the fact invalidates 4 and everything after. That is what lets a
stranger check the record without trusting whoever runs the database — including us.

## What makes this different

Most traceability projects stop at a green tick. This one refuses to, because the
tick is dishonest: **a blockchain proves a record has not been altered, never that
the record was true when written.** A farmer who types "organic" into a form has
created a tamper-resistant record of a claim, and nothing more.

So a fact on the passport is never just a value. It is a **claim**, optionally
supported by **evidence**, from which a **status** is derived:

| | Status | Meaning |
|---|---|---|
| `✓` | Independently verified | A third party with no stake attested to it |
| `◆` | Evidence on file | A document or sensor reading supports it; issuer named |
| `△` | Self-declared | The party who benefits is the only source |
| `○` | Not provided | Nothing was claimed — shown anyway, because absence is information |

Two consequences that matter more than they look. **Absence is displayed**, so a
seller cannot look complete by saying less. And **status is derived at read time**,
so a withdrawn certificate changes every passport that depended on it the next time
one is opened, instead of going quietly stale.

## Design decisions worth defending

**Polygon, not Hyperledger Fabric.** Fabric is permissioned — only consortium members
can read it. The entire product is a consumer checking a record without trusting any
business in the chain, and a consumer cannot query a Fabric channel. Anchoring there
would mean asking the shopper to trust our word about what the ledger says, which is
the exact position this project exists to escape.

**Hashes on chain, never documents.** The database holds detail; the chain holds proof
that a record existed in that form. Personal data never touches it — names and phone
numbers are anchored as salted hashes, so an erasure request under the DPDP Act 2023
can be honoured by deleting the salt. The on-chain value survives, permanently
unlinkable to anyone.

**Only the current custodian may write to a batch.** QR codes are public by design, so
the code cannot also be the authorisation — otherwise anyone who photographs a code in
a shop could inject events into a stranger's batch. Custody moves by a two-step
transfer: the holder offers, the receiver accepts. Every write checks both the actor's
role and current custody, server-side.

**Immutability is enforced by the database, not by convention.** Triggers reject
`UPDATE` and `DELETE` on the event table, so the guarantee survives a careless
migration. A mistake is corrected by appending a compensating event.

**The batch code is a label, not a key.** `RS1234-WH5432-T` is legible on a crate and
typeable on a phone, but it collides between two farmers with the same initials and it
leaks a name. The row's UUID is the key. The trailing check character means a mistyped
code fails loudly instead of quietly resolving to someone else's harvest.

**The hash format has no dependencies.** `src/lib/ledger-core.ts` imports nothing but
`node:crypto`. It is the part a third party must be able to reimplement to check our
arithmetic — about forty lines someone can port to Python and get identical digests.
Coupling it to the ORM is how hash formats accidentally change.

**Money is integer paise.** Never a float, anywhere. Formatted only at the edge.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15, TypeScript, Tailwind | Server components render the passport instantly on a weak connection — the consumer is standing in a shop |
| Backend | Next.js route handlers | One primary backend. A separate Express server would be a second deployment for no capability gained |
| Database | PostgreSQL + Drizzle | Keeps SQL visible instead of hiding the query behind an ORM |
| Auth | Phone OTP, role-scoped sessions | Farmers have phone numbers more reliably than email |
| Chain | Polygon Amoy + Solidity | Public, free, and a consumer can verify it |
| OCR | FastAPI service *(Phase 11)* | The one place Python genuinely wins. No database access, one job |

## Running it

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
npm run verify        # 28 assertions — no database or network needed
npm run db:up         # Postgres on :5433
npm run db:migrate    # applies sql/*.sql in order
npm run db:seed
npm run dev
```

Sign in at `/login` with `9876500001`. The seeded wheat batch carries a retail price,
so its passport shows a real farmer-share figure.

## Tests

`npm run verify` runs 28 assertions against the pure modules — no database, no network,
no build step. They cover:

- **Canonical encoding** — key order cannot change a digest, arrays are order-sensitive
- **Six tamper scenarios** — altering a price, back-dating an event, relocating a GPS
  capture, deleting an event, and rehashing a tampered event hoping later links absorb it
- **GPS float tolerance** — sub-centimetre noise from different chips must not break a chain
- **Batch codes** — a single-digit typo and a transposition are both rejected

Every one passes. Running them is the fastest way to confirm the core is sound.

## Status

Honest accounting, because the parts that are proven and the parts that are written
are not the same parts.

**Verified by running it:** the hash chain, chain verification, and batch codes.

**Written but never executed:** the Next.js app itself. The machine this was developed
on could not reach the npm registry, so no install, no database, and no browser run has
happened yet. Expect to fix import and version-boundary errors on first run.

**Known defects, scheduled:** the OTP is generated but never checked, so any six digits
sign you in *(Phase 4)*. The session key reuses the ledger salt, and those two secrets
have opposite rotation requirements *(Phase 4)*. Farmer-facing queries scope by
organisation rather than by farmer, so co-op members see each other's batches *(fixed)*.

**Mid-rename:** the project is TraceBites; internal identifiers still say `tracebites`
until Phase 3.

## Layout

```
sql/                      migrations, applied in lexical order
  0000_init.sql           the schema
  0001_ledger_guards.sql  append-only triggers, re-run on every migrate
src/
  db/schema.ts            Drizzle mirror of the SQL
  lib/ledger-core.ts      the hash format — zero dependencies, frozen
  lib/ledger.ts           append and verify a chain
  lib/harvest.ts          the only place a batch comes into existence
  lib/chain/              adapter interface, local dev adapter, Polygon
  app/farmer/             the farmer app
  app/v/[code]/           the public passport — no auth, works on 2G
scripts/                  verify-ledger
contracts/src/            the registry contract
```

## Roadmap

Fourteen phases, each ending on a gate that passes or does not. Phase 3 is done —
renamed, pruned to traceability only, and farm ownership added so a farmer sees
their own fields. Next is Phase 4: real OTP verification and a separate session secret.

Architecture and full roadmap live in the project's architecture document.

---

Built by [Aaradhy Adhikari](https://github.com/AaradhyAdhikari). Originally submitted
as SIH25045 under the name TraceBites, then rebuilt from scratch around an
event-sourced ledger and an explicit verification model.
