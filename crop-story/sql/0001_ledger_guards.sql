-- Ledger guards.
--
-- "The record is immutable" cannot be a convention held in application code —
-- one careless migration or one psql session undoes it. So the database itself
-- refuses to alter a custody event, and the app has no path around it.

CREATE OR REPLACE FUNCTION custody_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'custody_events is append-only: % on event % rejected. Correct a mistake by appending a compensating event, never by editing history.',
    TG_OP, COALESCE(OLD.id::text, '?');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS custody_events_no_update ON custody_events;
CREATE TRIGGER custody_events_no_update
  BEFORE UPDATE ON custody_events
  FOR EACH ROW
  -- anchor_id is the one field a later process fills in; it is not part of the hash.
  WHEN (
    OLD.id IS DISTINCT FROM NEW.id OR OLD.batch_id IS DISTINCT FROM NEW.batch_id OR
    OLD.seq IS DISTINCT FROM NEW.seq OR OLD.kind IS DISTINCT FROM NEW.kind OR
    OLD.actor_org_id IS DISTINCT FROM NEW.actor_org_id OR OLD.payload IS DISTINCT FROM NEW.payload OR
    OLD.occurred_at IS DISTINCT FROM NEW.occurred_at OR OLD.prev_hash IS DISTINCT FROM NEW.prev_hash OR
    OLD.hash IS DISTINCT FROM NEW.hash OR OLD.lat IS DISTINCT FROM NEW.lat OR
    OLD.lng IS DISTINCT FROM NEW.lng
  )
  EXECUTE FUNCTION custody_events_append_only();

DROP TRIGGER IF EXISTS custody_events_no_delete ON custody_events;
CREATE TRIGGER custody_events_no_delete
  BEFORE DELETE ON custody_events
  FOR EACH ROW EXECUTE FUNCTION custody_events_append_only();

-- Same protection for lineage: a recall walks this tree, so a deleted edge is a
-- batch that silently escapes the recall.
CREATE OR REPLACE FUNCTION batch_lineage_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'batch_lineage is append-only: provenance edges cannot be removed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batch_lineage_no_delete_trg ON batch_lineage;
CREATE TRIGGER batch_lineage_no_delete_trg
  BEFORE DELETE ON batch_lineage
  FOR EACH ROW EXECUTE FUNCTION batch_lineage_no_delete();
