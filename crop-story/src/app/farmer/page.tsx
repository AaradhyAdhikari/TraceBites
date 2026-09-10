import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { batches, cropVarieties, custodyEvents, farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { rupees, shortDate } from "@/lib/format";
import { AnchorPill } from "@/components/AnchorPill";

export default async function FarmerHome() {
  const ctx = await requireFarmer();
  if (!ctx) redirect("/login");

  const rows = await db
    .select({
      id: batches.id,
      code: batches.code,
      quantity: batches.quantity,
      unit: batches.unit,
      harvestedOn: batches.harvestedOn,
      status: batches.status,
      price: batches.farmGatePricePaise,
      crop: cropVarieties.commonName,
      farm: farms.name,
    })
    .from(batches)
    .innerJoin(farms, eq(farms.id, batches.farmId))
    .innerJoin(cropVarieties, eq(cropVarieties.id, batches.cropVarietyId))
    .where(eq(farms.orgId, ctx.org.id))
    .orderBy(desc(batches.createdAt))
    .limit(50);

  // One aggregate for the whole page — never a count query per row, and never
  // the whole event table pulled into memory to be counted here.
  const eventCounts = new Map<string, number>();
  if (rows.length) {
    const counts = await db
      .select({
        batchId: custodyEvents.batchId,
        n: sql<number>`count(*)::int`,
      })
      .from(custodyEvents)
      .where(inArray(custodyEvents.batchId, rows.map((r) => r.id)))
      .groupBy(custodyEvents.batchId);

    for (const c of counts) eventCounts.set(c.batchId, c.n);
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.1em] text-muted">{ctx.org.name}</p>
          <h1 className="text-[26px] font-bold tracking-tight mt-0.5">{ctx.user.displayName}</h1>
        </div>
        <Link href="/logout" className="text-[13px] text-muted hover:text-ink pt-1">
          Sign out
        </Link>
      </header>

      <Link href="/farmer/harvest/new" className="btn-primary w-full py-3 mb-7">
        Register a harvest
      </Link>

      <h2 className="text-[11px] uppercase tracking-[0.1em] text-muted mb-3">
        My batches ({rows.length})
      </h2>

      {rows.length === 0 ? (
        <div className="card p-5 text-center">
          <p className="text-[15px] font-semibold mb-1">Nothing registered yet</p>
          <p className="text-[13.5px] text-muted leading-relaxed">
            Register your first harvest and you&rsquo;ll get a code you can print and stick on the
            crate.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((b) => (
            <li key={b.id}>
              <Link
                href={`/farmer/batches/${b.code}`}
                className="card block px-4 py-3.5 hover:border-moss transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-[15.5px]">{b.crop}</span>
                  <span className="mono text-[11.5px] text-muted">{b.code}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-1.5">
                  <span className="text-[13.5px] text-muted">
                    {b.quantity} {b.unit} · {shortDate(b.harvestedOn)}
                  </span>
                  {b.price !== null && (
                    <span className="text-[13.5px] font-semibold text-moss">
                      {rupees(b.price)}/{b.unit}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  <span className="text-[11px] uppercase tracking-wider text-muted">{b.status}</span>
                  <span className="text-line2">·</span>
                  <AnchorPill events={eventCounts.get(b.id) ?? 0} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
