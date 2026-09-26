import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cropVarieties, farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { HarvestForm } from "@/components/HarvestForm";

export default async function NewHarvestPage() {
  const ctx = (await requireFarmer())!; // layout already redirected if absent

  const [myFarms, crops] = await Promise.all([
    db.select().from(farms).where(eq(farms.ownerUserId, ctx.user.id)).orderBy(asc(farms.name)),
    db.select().from(cropVarieties).orderBy(asc(cropVarieties.commonName)),
  ]);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Link href="/farmer" className="text-[13px] text-muted hover:text-ink">
        ← My batches
      </Link>

      <h1 className="text-[26px] font-bold tracking-tight mt-3 mb-1">Register a harvest</h1>
      <p className="text-[14px] text-muted mb-6 leading-relaxed">
        This creates the first link in the batch&rsquo;s chain. Everything that happens to it
        afterwards attaches to what you enter here.
      </p>

      {myFarms.length === 0 ? (
        <div className="card p-5">
          <p className="text-[15px] font-semibold mb-1">Add a field first</p>
          <p className="text-[13.5px] text-muted leading-relaxed mb-4">
            A batch has to come from somewhere, and the field&rsquo;s code becomes part of every
            batch code registered from it.
          </p>
          <Link href="/farmer/fields" className="btn-primary w-full">
            Add a field
          </Link>
        </div>
      ) : (
      <HarvestForm
        farms={myFarms.map((f) => ({ id: f.id, name: f.name, farmCode: f.farmCode }))}
        crops={crops.map((c) => ({
          id: c.id,
          name: c.commonName,
          nameHi: c.nameHi,
          code: c.cropCode,
          unit: c.defaultUnit,
        }))}
      />
      )}
    </div>
  );
}
