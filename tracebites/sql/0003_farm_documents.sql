-- Farm-scoped documents.
--
-- Documents could only attach to a batch. A certificate supplied at sign-up —
-- an organic certification, a land record, a registration — is about the FARM,
-- and outlives every batch grown on it. Re-uploading it per harvest would be
-- both tedious and wrong: revoking it should invalidate the claim everywhere at
-- once, which is impossible if twenty copies exist as twenty rows.
--
-- A document now attaches to exactly one of a batch or a farm.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS farm_id uuid REFERENCES farms(id);

-- Issuer and validity are what let the passport say who vouched for this and
-- until when, rather than showing an undated file.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS issuer text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_from date;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_until date;

CREATE INDEX IF NOT EXISTS documents_farm_idx ON documents (farm_id);
CREATE INDEX IF NOT EXISTS documents_batch_idx ON documents (batch_id);

-- Exactly one owner. A document belonging to both, or to neither, is a bug.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_one_owner;
ALTER TABLE documents ADD CONSTRAINT documents_one_owner
  CHECK ((batch_id IS NULL) <> (farm_id IS NULL));
