-- Crop Story — initial schema.
--
-- Hand-written rather than generated, so a fresh clone can migrate with no
-- codegen step. src/db/schema.ts is the Drizzle mirror of this file and the two
-- must be kept in step; from here on, `npm run db:generate` produces the diffs.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE org_kind AS ENUM ('farm','fpo','distributor','retailer','inspectorate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('farmer','distributor','retailer','inspector','admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE event_kind AS ENUM (
    'HARVESTED','PHOTO_ATTACHED','CERT_LINKED','QUALITY_GRADED','PRICE_SET',
    'CUSTODY_TRANSFERRED','BATCH_SPLIT','COLD_CHAIN_PING','IN_TRANSIT',
    'LISTED','SOLD','RATED','INSPECTED','RECALLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE batch_status AS ENUM ('registered','in_custody','in_transit','split','listed','sold','recalled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE anchor_status AS ENUM ('pending','submitted','confirmed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             text NOT NULL,
  display_name      text NOT NULL,
  preferred_locale  text NOT NULL DEFAULT 'en',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_idx ON users (phone);

CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        org_kind NOT NULL,
  name        text NOT NULL,
  district    text,
  state       text,
  org_ref     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role     member_role NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_org_role_idx ON memberships (user_id, org_id, role);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS farms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  farm_code        text NOT NULL,
  survey_number    text,
  area_hectares    double precision,
  lat              double precision,
  lng              double precision,
  geofence_metres  integer NOT NULL DEFAULT 750,
  certification    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS farms_org_code_idx ON farms (org_id, farm_code);

CREATE TABLE IF NOT EXISTS crop_varieties (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_code        text NOT NULL,
  common_name      text NOT NULL,
  name_hi          text,
  name_mr          text,
  category         text NOT NULL,
  default_unit     text NOT NULL,
  shelf_life_days  integer NOT NULL,
  season           text NOT NULL,
  agmarknet_name   text
);
CREATE UNIQUE INDEX IF NOT EXISTS crop_varieties_code_idx ON crop_varieties (crop_code);

CREATE TABLE IF NOT EXISTS batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL,
  farm_id                uuid NOT NULL REFERENCES farms(id),
  crop_variety_id        uuid NOT NULL REFERENCES crop_varieties(id),
  custodian_org_id       uuid NOT NULL REFERENCES organizations(id),
  quantity               double precision NOT NULL,
  unit                   text NOT NULL,
  harvested_on           timestamptz NOT NULL,
  status                 batch_status NOT NULL DEFAULT 'registered',
  farm_gate_price_paise  integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS batches_code_idx ON batches (code);
CREATE INDEX IF NOT EXISTS batches_farm_idx ON batches (farm_id);
CREATE INDEX IF NOT EXISTS batches_custodian_idx ON batches (custodian_org_id);

CREATE TABLE IF NOT EXISTS batch_lineage (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_batch_id  uuid NOT NULL REFERENCES batches(id),
  child_batch_id   uuid NOT NULL REFERENCES batches(id),
  quantity         double precision NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS batch_lineage_pair_idx ON batch_lineage (parent_batch_id, child_batch_id);
CREATE INDEX IF NOT EXISTS batch_lineage_child_idx ON batch_lineage (child_batch_id);

-- The ledger.
CREATE TABLE IF NOT EXISTS custody_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES batches(id),
  seq              integer NOT NULL,
  kind             event_kind NOT NULL,
  actor_org_id     uuid NOT NULL REFERENCES organizations(id),
  actor_user_id    uuid REFERENCES users(id),
  lat              double precision,
  lng              double precision,
  accuracy_metres  double precision,
  within_geofence  boolean,
  payload          jsonb NOT NULL,
  occurred_at      timestamptz NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  prev_hash        text,
  hash             text NOT NULL,
  anchor_id        uuid
);
-- Two writers cannot fork one batch's chain.
CREATE UNIQUE INDEX IF NOT EXISTS custody_events_batch_seq_idx ON custody_events (batch_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS custody_events_hash_idx ON custody_events (hash);
CREATE INDEX IF NOT EXISTS custody_events_batch_idx ON custody_events (batch_id);
CREATE INDEX IF NOT EXISTS custody_events_unanchored_idx ON custody_events (anchor_id) WHERE anchor_id IS NULL;

CREATE TABLE IF NOT EXISTS chain_anchors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode           text NOT NULL,
  merkle_root    text,
  event_count    integer NOT NULL DEFAULT 1,
  status         anchor_status NOT NULL DEFAULT 'pending',
  tx_hash        text,
  block_number   integer,
  confirmations  integer NOT NULL DEFAULT 0,
  chain_id       integer,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at   timestamptz
);

CREATE TABLE IF NOT EXISTS outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES custody_events(id),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  done_at          timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (next_attempt_at) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid REFERENCES batches(id),
  kind          text NOT NULL,
  storage_path  text NOT NULL,
  mime_type     text NOT NULL,
  byte_size     integer NOT NULL,
  sha256        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_points (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id               uuid NOT NULL REFERENCES batches(id),
  event_id               uuid NOT NULL REFERENCES custody_events(id),
  stage                  text NOT NULL,
  set_by_org_id          uuid NOT NULL REFERENCES organizations(id),
  price_per_unit_paise   integer NOT NULL,
  transport_cost_paise   integer NOT NULL DEFAULT 0,
  storage_cost_paise     integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_points_batch_idx ON price_points (batch_id);
