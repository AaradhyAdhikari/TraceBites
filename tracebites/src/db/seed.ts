/**
 * Seed data.
 *
 * One FPO, three farmers with real fields in Punjab and Maharashtra, the crop
 * master list, and two batches that already carry a few events — so a fresh
 * clone opens on a working example rather than an empty shell.
 *
 * Idempotent: safe to run repeatedly.
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  cropVarieties,
  farms,
  memberships,
  organizations,
  pricePoints,
  users,
} from "./schema";
import { appendEvent, saltedRef } from "@/lib/ledger";
import { registerHarvest } from "@/lib/harvest";

const CROPS = [
  { cropCode: "WH", commonName: "Wheat", nameHi: "गेहूँ", nameMr: "गहू", category: "cereal", defaultUnit: "quintal", shelfLifeDays: 180, season: "Rabi", agmarknetName: "Wheat" },
  { cropCode: "RI", commonName: "Rice", nameHi: "चावल", nameMr: "तांदूळ", category: "cereal", defaultUnit: "quintal", shelfLifeDays: 365, season: "Kharif", agmarknetName: "Paddy(Dhan)(Common)" },
  { cropCode: "TO", commonName: "Tomato", nameHi: "टमाटर", nameMr: "टोमॅटो", category: "vegetable", defaultUnit: "kg", shelfLifeDays: 10, season: "Year-round", agmarknetName: "Tomato" },
  { cropCode: "ON", commonName: "Onion", nameHi: "प्याज", nameMr: "कांदा", category: "vegetable", defaultUnit: "kg", shelfLifeDays: 90, season: "Rabi", agmarknetName: "Onion" },
  { cropCode: "PO", commonName: "Potato", nameHi: "आलू", nameMr: "बटाटा", category: "vegetable", defaultUnit: "kg", shelfLifeDays: 60, season: "Rabi", agmarknetName: "Potato" },
  { cropCode: "SP", commonName: "Spinach", nameHi: "पालक", nameMr: "पालक", category: "vegetable", defaultUnit: "kg", shelfLifeDays: 5, season: "Winter", agmarknetName: "Spinach" },
];

async function main() {
  if (!process.env.LEDGER_SALT) {
    process.env.LEDGER_SALT = "dev-only-salt-replace-before-any-real-data";
  }

  console.log("seeding…");

  // ---- crops ------------------------------------------------------------
  for (const c of CROPS) {
    await db.insert(cropVarieties).values(c).onConflictDoNothing({ target: cropVarieties.cropCode });
  }
  console.log(`· ${CROPS.length} crop varieties`);

  // ---- organisation -----------------------------------------------------
  let [fpo] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, "Sangrur Farmer Producer Co."))
    .limit(1);

  if (!fpo) {
    [fpo] = await db
      .insert(organizations)
      .values({
        kind: "fpo",
        name: "Sangrur Farmer Producer Co.",
        district: "Sangrur",
        state: "Punjab",
        orgRef: "",
      })
      .returning();
    // orgRef is a salted hash of the row's own id, so it has to be a second write.
    await db.update(organizations).set({ orgRef: saltedRef(fpo.id) }).where(eq(organizations.id, fpo.id));
    fpo.orgRef = saltedRef(fpo.id);
  }

  // ---- people and fields ------------------------------------------------
  const people = [
    { phone: "9876500001", displayName: "Rajesh Singh", farm: "Kotra Field", farmCode: "1234", lat: 30.2458, lng: 75.8421, area: 2.4, cert: "Certified Organic" },
    { phone: "9876500002", displayName: "Priya Sharma", farm: "Bhawanigarh Plot", farmCode: "2341", lat: 30.2712, lng: 76.0389, area: 1.1, cert: null },
    { phone: "9876500003", displayName: "Sunita Devi", farm: "Longowal East", farmCode: "4567", lat: 30.2043, lng: 75.6845, area: 3.2, cert: "Transitional" },
  ];

  const created: { userId: string; farmId: string; name: string }[] = [];

  for (const p of people) {
    let [u] = await db.select().from(users).where(eq(users.phone, p.phone)).limit(1);
    if (!u) {
      [u] = await db
        .insert(users)
        .values({ phone: p.phone, displayName: p.displayName, preferredLocale: "hi" })
        .returning();
      await db.insert(memberships).values({ userId: u.id, orgId: fpo.id, role: "farmer" });
    }

    let [f] = await db.select().from(farms).where(eq(farms.farmCode, p.farmCode)).limit(1);
    if (!f) {
      [f] = await db
        .insert(farms)
        .values({
          orgId: fpo.id,
          ownerUserId: u.id,
          name: p.farm,
          farmCode: p.farmCode,
          surveyNumber: `SG/${p.farmCode}/A`,
          areaHectares: p.area,
          lat: p.lat,
          lng: p.lng,
          certification: p.cert,
        })
        .returning();
    }

    created.push({ userId: u.id, farmId: f.id, name: p.displayName });
  }
  console.log(`· ${created.length} farmers with fields`);

  // ---- two worked examples ---------------------------------------------
  const existing = await db.execute(sql`SELECT count(*)::int AS n FROM batches`);
  if ((existing.rows[0] as { n: number }).n > 0) {
    console.log("· batches already present, skipping example harvests");
    console.log("\nseed complete. Sign in at /login with 9876500001");
    process.exit(0);
  }

  const [wheat, tomato] = await Promise.all([
    db.select().from(cropVarieties).where(eq(cropVarieties.cropCode, "WH")).limit(1),
    db.select().from(cropVarieties).where(eq(cropVarieties.cropCode, "TO")).limit(1),
  ]);

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  // A wheat batch that has moved on — it carries a retail price, so the verify
  // page can show a real farmer-share bar.
  const a = await registerHarvest(
    {
      farmId: created[0].farmId,
      cropVarietyId: wheat[0].id,
      quantity: 40,
      unit: "quintal",
      harvestedOn: daysAgo(9),
      askingPrice: 2400,
      lat: 30.2461,
      lng: 75.8418,
      accuracy: 8,
    },
    { userId: created[0].userId, orgId: fpo.id },
  );

  const priceEvent = await db.transaction((tx) =>
    appendEvent(tx, {
      batchId: a.batchId,
      kind: "PRICE_SET",
      actorOrgId: fpo.id,
      occurredAt: new Date(Date.now() - 2 * 86_400_000),
      geo: { lat: 28.6139, lng: 77.209, accuracy: 20 },
      payload: { stage: "retail", pricePerUnitPaise: 410_000, unit: "quintal" },
    }),
  );
  await db.insert(pricePoints).values({
    batchId: a.batchId,
    eventId: priceEvent.id,
    stage: "retail",
    setByOrgId: fpo.id,
    pricePerUnitPaise: 410_000,
  });

  // A tomato batch fresh off the field — nothing but the harvest yet.
  const b = await registerHarvest(
    {
      farmId: created[1].farmId,
      cropVarietyId: tomato[0].id,
      quantity: 180,
      unit: "kg",
      harvestedOn: daysAgo(1),
      askingPrice: 22,
      lat: 30.2709,
      lng: 76.0392,
      accuracy: 11,
    },
    { userId: created[1].userId, orgId: fpo.id },
  );

  console.log(`· example batches: ${a.code}, ${b.code}`);
  console.log(`\nseed complete.`);
  console.log(`  sign in   → /login with 9876500001 (any 6-digit code)`);
  console.log(`  scan test → /v/${a.code}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
