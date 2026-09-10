import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cropVarieties, farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { HarvestForm } from "@/components/HarvestForm";

export default async function NewHarvestPage() {
  const ctx = await requireFarmer();
  if (!ctx) redirect("/login");

  const [myFarms, crops] = await Promise.all([
    db.select().from(farms).where(eq(farms.orgId, ctx.org.id)).orderBy(asc(farms.name)),
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
    </div>
  );
}
