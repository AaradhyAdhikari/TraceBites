-- Farm ownership.
--
-- Fixes a data leak: farmer-facing queries scoped by organisation, and in an FPO
-- every member shares one organisation. So "My batches" showed every member's
-- harvests, and the earnings screen added up their money.
--
-- The schema had no way to express "this farmer's field" — only "this org's
-- field" — so the query could not be corrected on its own. This adds the missing
-- ownership edge.
--
-- Deliberately nullable. Rows predating this migration have no owner and are
-- therefore invisible to every farmer, which fails closed. Re-seed (npm run
-- db:reset) to repopulate with owners.

ALTER TABLE farms ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS farms_owner_idx ON farms (owner_user_id);
