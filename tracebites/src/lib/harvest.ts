/**
 * Harvest registration.
 *
 * This is the only place a batch comes into existence, and the first link of its
 * chain. It runs in one transaction: batch row, HARVESTED event, optional photo
 * and farm-gate price, each appended to the chain in order. If any step fails,
 * no half-registered batch survives.
 */

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { batches, cropVarieties, documents, farms, pricePoints, users } from "@/db/schema";
import { formatBatchCode, randomSerial } from "./batch-code";
import { appendEvent, haversineMetres, sha256 } from "./ledger";

export const harvestInput = z.object({
  farmId: z.string().uuid(),
  cropVarietyId: z.string().uuid(),
  quantity: z.number().positive().max(100_000),
  unit: z.enum(["kg", "quintal"]),
  harvestedOn: z.string(),
  /** Rupees per unit as typed by the farmer; converted to paise on the way in. */
  askingPrice: z.number().nonnegative().max(1_000_000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().nonnegative().optional(),
  /** data: URI in local dev; an object-storage key once Storage lands. */
  photo: z.string().optional(),
  /** Client-generated id so a retried offline submission cannot double-register. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type HarvestInput = z.infer<typeof harvestInput>;

export interface RegisterContext {
  userId: string;
  orgId: string;
}

export async function registerHarvest(input: HarvestInput, ctx: RegisterContext) {
  const [farm] = await db.select().from(farms).where(eq(farms.id, input.farmId)).limit(1);
  if (!farm || farm.orgId !== ctx.orgId) throw new Error("Farm not found for this organisation");

  // Org membership is not ownership. Without this a co-op member could register
  // a harvest against a neighbour's field by passing its id, and the batch code
  // would carry that neighbour's field code.
  if (farm.ownerUserId !== null && farm.ownerUserId !== ctx.userId) {
    throw new Error("That field belongs to another farmer");
  }

  const [crop] = await db
    .select()
    .from(cropVarieties)
    .where(eq(cropVarieties.id, input.cropVarietyId))
    .limit(1);
  if (!crop) throw new Error("Unknown crop");

  const [farmer] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!farmer) throw new Error("Unknown user");

  // Geofence. A capture outside the registered plot is RECORDED, not rejected —
  // fields have poor signal and honest farmers stand at the road. It is flagged,
  // and an inspector's queue is sorted by exactly this flag.
  const geo =
    input.lat !== undefined && input.lng !== undefined
      ? { lat: input.lat, lng: input.lng, accuracy: input.accuracy ?? null }
      : null;

  let withinGeofence: boolean | null = null;
  if (geo && farm.lat !== null && farm.lng !== null) {
    const distance = haversineMetres(geo, { lat: farm.lat, lng: farm.lng });
    withinGeofence = distance <= farm.geofenceMetres;
  }

  return db.transaction(async (tx) => {
    // Retrying an offline submission must not create a second batch.
    if (input.idempotencyKey) {
      const existing = await tx.execute(sql`
        SELECT b.id, b.code FROM batches b
        JOIN custody_events e ON e.batch_id = b.id AND e.seq = 1
        WHERE e.payload->>'idempotencyKey' = ${input.idempotencyKey}
        LIMIT 1
      `);
      const hit = (existing.rows as { id: string; code: string }[])[0];
      if (hit) return { batchId: hit.id, code: hit.code, deduplicated: true };
    }

    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = formatBatchCode({
        farmerName: farmer.displayName,
        farmCode: farm.farmCode,
        cropCode: crop.cropCode,
        batchSerial: randomSerial(),
      });
      const [clash] = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(eq(batches.code, candidate))
        .limit(1);
      if (!clash) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Could not allocate a unique batch code");

    const harvestedOn = new Date(input.harvestedOn);

    const [batch] = await tx
      .insert(batches)
      .values({
        code,
        farmId: farm.id,
        cropVarietyId: crop.id,
        custodianOrgId: ctx.orgId,
        quantity: input.quantity,
        unit: input.unit,
        harvestedOn,
        status: "registered",
        farmGatePricePaise:
          input.askingPrice !== undefined ? Math.round(input.askingPrice * 100) : null,
      })
      .returning();

    // ---- seq 1: HARVESTED ------------------------------------------------
    await appendEvent(tx, {
      batchId: batch.id,
      kind: "HARVESTED",
      actorOrgId: ctx.orgId,
      actorUserId: ctx.userId,
      geo,
      withinGeofence,
      occurredAt: harvestedOn,
      payload: {
        crop: crop.commonName,
        cropCode: crop.cropCode,
        quantity: input.quantity,
        unit: input.unit,
        farmCode: farm.farmCode,
        // The farm is referenced by id; its name, survey number and owner stay
        // off the chain entirely.
        farmId: farm.id,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
    });

    // ---- seq 2: PHOTO_ATTACHED ------------------------------------------
    if (input.photo) {
      const digest = sha256(input.photo);
      const [doc] = await tx
        .insert(documents)
        .values({
          batchId: batch.id,
          kind: "harvest_photo",
          storagePath: input.photo,
          mimeType: input.photo.slice(5, input.photo.indexOf(";")) || "image/jpeg",
          byteSize: input.photo.length,
          sha256: digest,
        })
        .returning();

      await appendEvent(tx, {
        batchId: batch.id,
        kind: "PHOTO_ATTACHED",
        actorOrgId: ctx.orgId,
        actorUserId: ctx.userId,
        geo,
        // Only the digest is anchored. The image itself never leaves our storage,
        // but anyone can prove the image they were shown is the one taken.
        payload: { documentId: doc.id, sha256: digest, kind: "harvest_photo" },
      });
    }

    // ---- seq 3: PRICE_SET ------------------------------------------------
    if (input.askingPrice !== undefined) {
      const paise = Math.round(input.askingPrice * 100);
      const priceEvent = await appendEvent(tx, {
        batchId: batch.id,
        kind: "PRICE_SET",
        actorOrgId: ctx.orgId,
        actorUserId: ctx.userId,
        geo,
        payload: { stage: "farm_gate", pricePerUnitPaise: paise, unit: input.unit },
      });

      await tx.insert(pricePoints).values({
        batchId: batch.id,
        eventId: priceEvent.id,
        stage: "farm_gate",
        setByOrgId: ctx.orgId,
        pricePerUnitPaise: paise,
      });
    }

    return { batchId: batch.id, code, deduplicated: false };
  });
}
