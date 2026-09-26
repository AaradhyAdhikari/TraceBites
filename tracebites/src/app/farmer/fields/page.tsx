import { revalidatePath } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { batches, farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { AddFieldForm } from "@/components/AddFieldForm";

/**
 * Fields.
 *
 * Without this page a farmer who signs up has no field, so the harvest form's
 * field selector is empty and registration cannot start. The seed created farms
 * directly in the database, which hid the gap.
 */
export default async function FieldsPage() {
  const ctx = (await requireFarmer())!; // layout already redirected if absent

  const rows = await db
    .select({
      id: farms.id,
      name: farms.name,
      farmCode: farms.farmCode,
      surveyNumber: farms.surveyNumber,
      areaHectares: farms.areaHectares,
      lat: farms.lat,
      lng: farms.lng,
      certification: farms.certification,
      batchCount: sql<number>`(SELECT count(*)::int FROM ${batches} WHERE ${batches.farmId} = ${farms.id})`,
    })
    .from(farms)
    .where(eq(farms.ownerUserId, ctx.user.id))
    .orderBy(asc(farms.name));

  async function addField(formData: FormData) {
    "use server";
    const inner = await requireFarmer();
    if (!inner) throw new Error("Not signed in");

    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("A field needs a name");

    const areaRaw = String(formData.get("area") ?? "").trim();
    const latRaw = String(formData.get("lat") ?? "").trim();
    const lngRaw = String(formData.get("lng") ?? "").trim();

    // Four digits, printed in every batch code from this field. Unique within
    // the org, so retry on the unlikely collision rather than failing the farmer.
    let farmCode = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000));
      const [clash] = await db
        .select({ id: farms.id })
        .from(farms)
        // The code is unique per org, so the collision check stays org-wide even
        // though the listing above is per-owner.
        .where(sql`${farms.orgId} = ${inner.org.id} AND ${farms.farmCode} = ${candidate}`)
        .limit(1);
      if (!clash) {
        farmCode = candidate;
        break;
      }
    }
    if (!farmCode) throw new Error("Could not allocate a field code — try again");

    await db.insert(farms).values({
      orgId: inner.org.id,
      ownerUserId: inner.user.id,
      name,
      farmCode,
      surveyNumber: String(formData.get("surveyNumber") ?? "").trim() || null,
      areaHectares: areaRaw ? Number(areaRaw) : null,
      lat: latRaw ? Number(latRaw) : null,
      lng: lngRaw ? Number(lngRaw) : null,
      certification: String(formData.get("certification") ?? "").trim() || null,
    });

    revalidatePath("/farmer/fields");
    revalidatePath("/farmer/harvest/new");
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h1 className="text-[26px] font-bold tracking-tight">Fields</h1>
      <p className="text-[14px] text-muted mt-1 mb-6 leading-relaxed">
        Each field has a four-digit code that appears in every batch registered from it.
      </p>

      {rows.length === 0 ? (
        <div className="card p-5 mb-6">
          <p className="text-[15px] font-semibold mb-1">No fields yet</p>
          <p className="text-[13.5px] text-muted leading-relaxed">
            Add one before registering a harvest — a batch has to come from somewhere.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 mb-8">
          {rows.map((f) => (
            <li key={f.id} className="card px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-[15.5px]">{f.name}</span>
                <span className="mono text-[12px] text-muted">{f.farmCode}</span>
              </div>
              <p className="text-[13px] text-muted mt-1">
                {f.areaHectares ? `${f.areaHectares} ha` : "Area not recorded"}
                {f.surveyNumber ? ` · ${f.surveyNumber}` : ""}
                {` · ${f.batchCount} batch${f.batchCount === 1 ? "" : "es"}`}
              </p>
              {f.lat === null && (
                <p className="text-[12px] text-soil mt-1.5 leading-relaxed">
                  No location saved, so harvests here cannot be geo-checked and weather advice is
                  unavailable.
                </p>
              )}
              {f.certification && (
                <span className="inline-block mt-2 text-[11px] px-1.5 py-0.5 rounded bg-mossSoft text-moss">
                  {f.certification}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-[11px] uppercase tracking-[0.1em] text-muted mb-3">Add a field</h2>
      <AddFieldForm action={addField} />
    </div>
  );
}
