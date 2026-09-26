/**
 * TraceBites — data model.
 *
 * The centre of gravity is `custodyEvents`: an append-only, hash-chained log of
 * who held which batch, when, where, at what price, with what evidence.
 * Every other table is either input to an event or a read-model over the log.
 *
 * Two rules are enforced in the database rather than in application code,
 * because "the ledger is immutable" has to survive a careless migration:
 *   1. custody_events rejects UPDATE and DELETE (trigger, see 0001_ledger_guards.sql)
 *   2. (batch_id, seq) is unique, so a concurrent write cannot fork the chain
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const orgKind = pgEnum("org_kind", [
  "farm",
  "fpo", // farmer producer organisation — how smallholders actually onboard
  "distributor",
  "retailer",
  "inspectorate",
]);

export const memberRole = pgEnum("member_role", [
  "farmer",
  "distributor",
  "retailer",
  "inspector",
  "admin",
]);

/**
 * Event kinds. The five marked ANCHORED_KINDS below are written to Polygon
 * individually; the rest are hash-chained here and swept into a Merkle root.
 */
export const eventKind = pgEnum("event_kind", [
  "HARVESTED",
  "PHOTO_ATTACHED",
  "CERT_LINKED",
  "QUALITY_GRADED",
  "PRICE_SET",
  "CUSTODY_TRANSFERRED",
  "BATCH_SPLIT",
  "COLD_CHAIN_PING",
  "IN_TRANSIT",
  "LISTED",
  "SOLD",
  "RATED",
  "INSPECTED",
  "RECALLED",
]);

export const batchStatus = pgEnum("batch_status", [
  "registered",
  "in_custody",
  "in_transit",
  "split",
  "listed",
  "sold",
  "recalled",
]);

export const anchorStatus = pgEnum("anchor_status", [
  "pending",
  "submitted",
  "confirmed",
  "failed",
]);

/* ------------------------------------------------------------- identities */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Phone, not email. Many farmers have no email address.
    phone: text("phone").notNull(),
    displayName: text("display_name").notNull(),
    preferredLocale: text("preferred_locale").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ phoneIdx: uniqueIndex("users_phone_idx").on(t.phone) }),
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: orgKind("kind").notNull(),
  name: text("name").notNull(),
  district: text("district"),
  state: text("state"),
  /**
   * Stable public reference for this org, written on chain in place of its name.
   * sha256(LEDGER_SALT || org.id) — see lib/ledger.ts#orgRef.
   */
  orgRef: text("org_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("memberships_user_org_role_idx").on(t.userId, t.orgId, t.role),
    byUser: index("memberships_user_idx").on(t.userId),
  }),
);

/* ------------------------------------------------------------------ farms */

export const farms = pgTable(
  "farms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * The farmer who works this field. Org membership alone is not ownership:
     * in an FPO every member shares one organisation, so scoping a farmer's view
     * by org shows them everyone else's harvests. Nullable only so the migration
     * can be applied to existing rows; those rows are then visible to nobody,
     * which is the safe direction to fail.
     */
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    name: text("name").notNull(),
    /** Four digits, printed in the batch code. Unique within an org. */
    farmCode: text("farm_code").notNull(),
    /** Revenue survey / khasra number — the reference a lender will ask for. */
    surveyNumber: text("survey_number"),
    areaHectares: doublePrecision("area_hectares"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Harvest capture is geo-fenced to this radius around (lat,lng). */
    geofenceMetres: integer("geofence_metres").notNull().default(750),
    certification: text("certification"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("farms_org_code_idx").on(t.orgId, t.farmCode),
    owner: index("farms_owner_idx").on(t.ownerUserId),
  }),
);

/** Master data, seeded from ICAR crop lists. Never free text on a harvest form. */
export const cropVarieties = pgTable(
  "crop_varieties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Two letters, printed in the batch code: WH, TO, RI, ON, SP, PO. */
    cropCode: text("crop_code").notNull(),
    commonName: text("common_name").notNull(),
    nameHi: text("name_hi"),
    nameMr: text("name_mr"),
    category: text("category").notNull(), // cereal | vegetable | pulse | fruit
    defaultUnit: text("default_unit").notNull(), // kg | quintal
    shelfLifeDays: integer("shelf_life_days").notNull(),
    season: text("season").notNull(), // Kharif | Rabi | Zaid | Year-round
    /** Agmarknet commodity name, so price series join cleanly. */
    agmarknetName: text("agmarknet_name"),
  },
  (t) => ({ uniq: uniqueIndex("crop_varieties_code_idx").on(t.cropCode) }),
);

/* ---------------------------------------------------------------- batches */

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Printed, human-legible label: RS1234-WH5432-K
     * The trailing character is a check character — a mistyped code fails loudly
     * instead of silently resolving to someone else's harvest.
     * This is a LABEL. `id` is the key. See lib/batch-code.ts.
     */
    code: text("code").notNull(),
    farmId: uuid("farm_id")
      .notNull()
      .references(() => farms.id),
    cropVarietyId: uuid("crop_variety_id")
      .notNull()
      .references(() => cropVarieties.id),
    /** Org currently holding physical custody. Moves on CUSTODY_TRANSFERRED. */
    custodianOrgId: uuid("custodian_org_id")
      .notNull()
      .references(() => organizations.id),
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit").notNull(),
    harvestedOn: timestamp("harvested_on", { withTimezone: true }).notNull(),
    status: batchStatus("status").notNull().default("registered"),
    /** Price the farmer was paid, per unit, in paise. Populated by PRICE_SET. */
    farmGatePricePaise: integer("farm_gate_price_paise"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("batches_code_idx").on(t.code),
    farmIdx: index("batches_farm_idx").on(t.farmId),
    custodianIdx: index("batches_custodian_idx").on(t.custodianOrgId),
  }),
);

/**
 * Splits and merges. A 500-quintal wheat batch does not reach one consumer —
 * it becomes eleven retail lots, each of which must still resolve back to the
 * field it came from. Without this table there is no targeted recall.
 */
export const batchLineage = pgTable(
  "batch_lineage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentBatchId: uuid("parent_batch_id")
      .notNull()
      .references(() => batches.id),
    childBatchId: uuid("child_batch_id")
      .notNull()
      .references(() => batches.id),
    quantity: doublePrecision("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("batch_lineage_pair_idx").on(t.parentBatchId, t.childBatchId),
    childIdx: index("batch_lineage_child_idx").on(t.childBatchId),
  }),
);

/* ----------------------------------------------------------- THE LEDGER -- */

export const custodyEvents = pgTable(
  "custody_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    /** 1-based position in this batch's chain. Unique per batch. */
    seq: integer("seq").notNull(),
    kind: eventKind("kind").notNull(),

    actorOrgId: uuid("actor_org_id")
      .notNull()
      .references(() => organizations.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),

    /** Where the actor physically was. Source of computed food-miles. */
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyMetres: doublePrecision("accuracy_metres"),
    /** False when capture fell outside the farm geofence. Kept, not rejected. */
    withinGeofence: boolean("within_geofence"),

    /** Event-specific fields. Canonicalised before hashing — see lib/ledger.ts. */
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),

    /** Hash of the previous event in this batch's chain; null for seq 1. */
    prevHash: text("prev_hash"),
    /** sha256(canonical(this event) || prevHash). Recomputable by anyone. */
    hash: text("hash").notNull(),

    /** Set once this event lands on chain, individually or inside a root. */
    anchorId: uuid("anchor_id"),
  },
  (t) => ({
    chainIdx: uniqueIndex("custody_events_batch_seq_idx").on(t.batchId, t.seq),
    hashIdx: uniqueIndex("custody_events_hash_idx").on(t.hash),
    batchIdx: index("custody_events_batch_idx").on(t.batchId),
    unanchored: index("custody_events_unanchored_idx")
      .on(t.anchorId)
      .where(sql`anchor_id IS NULL`),
  }),
);

/** Kinds written to Polygon individually rather than swept into a Merkle root. */
export const ANCHORED_KINDS = [
  "HARVESTED",
  "CUSTODY_TRANSFERRED",
  "BATCH_SPLIT",
  "SOLD",
  "RECALLED",
] as const;

/* --------------------------------------------------------- chain plumbing */

export const chainAnchors = pgTable("chain_anchors", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** "event" for an individual write, "root" for a Merkle sweep. */
  mode: text("mode").notNull(),
  merkleRoot: text("merkle_root"),
  eventCount: integer("event_count").notNull().default(1),
  status: anchorStatus("status").notNull().default("pending"),
  txHash: text("tx_hash"),
  blockNumber: integer("block_number"),
  confirmations: integer("confirmations").notNull().default(0),
  chainId: integer("chain_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

/**
 * Outbox. The API commits to Postgres and returns; this worker queue carries the
 * write to the chain. The user never waits on a block, and if Polygon is down the
 * product keeps working and the backlog drains later.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => custodyEvents.id),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => ({
    pending: index("outbox_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`done_at IS NULL`),
  }),
);

/* -------------------------------------------------------------- evidence */

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").references(() => batches.id),
  kind: text("kind").notNull(), // harvest_photo | certificate | lab_report | invoice
  /** Object storage path in production; a data URI in local dev. */
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  /** sha256 of the bytes. This is what gets anchored, never the file. */
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every hand-off price. Because each is hashed into the ledger at the moment it
 * is set, by a party that cannot later change it, the consumer's "58% went to
 * the farmer" is provable rather than claimed.
 */
export const pricePoints = pgTable(
  "price_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => custodyEvents.id),
    stage: text("stage").notNull(), // farm_gate | distributor | retail
    setByOrgId: uuid("set_by_org_id")
      .notNull()
      .references(() => organizations.id),
    /** Integer paise throughout. Floating-point money is a bug waiting to happen. */
    pricePerUnitPaise: integer("price_per_unit_paise").notNull(),
    transportCostPaise: integer("transport_cost_paise").notNull().default(0),
    storageCostPaise: integer("storage_cost_paise").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ batchIdx: index("price_points_batch_idx").on(t.batchId) }),
);

/* ------------------------------------------------------------- relations */

export const batchesRelations = relations(batches, ({ one, many }) => ({
  farm: one(farms, { fields: [batches.farmId], references: [farms.id] }),
  crop: one(cropVarieties, {
    fields: [batches.cropVarietyId],
    references: [cropVarieties.id],
  }),
  custodian: one(organizations, {
    fields: [batches.custodianOrgId],
    references: [organizations.id],
  }),
  events: many(custodyEvents),
  prices: many(pricePoints),
}));

export const custodyEventsRelations = relations(custodyEvents, ({ one }) => ({
  batch: one(batches, { fields: [custodyEvents.batchId], references: [batches.id] }),
  actorOrg: one(organizations, {
    fields: [custodyEvents.actorOrgId],
    references: [organizations.id],
  }),
}));

export const farmsRelations = relations(farms, ({ one, many }) => ({
  org: one(organizations, { fields: [farms.orgId], references: [organizations.id] }),
  batches: many(batches),
}));
