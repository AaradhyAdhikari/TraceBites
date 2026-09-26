import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { batches, cropVarieties, farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { summariseEarnings } from "@/lib/earnings";
import { rupees } from "@/lib/format";

/**
 * Earnings.
 *
 * Three numbers that a careless dashboard would merge into one flattering
 * headline: what has been registered, what has been sold, what has actually
 * been paid. Until payouts exist the third is honestly zero and says why,
 * because a farmer who reads "₹1,24,960 earned" and then checks their bank
 * balance will never trust this app again.
 */
export default async function EarningsPage() {
  const ctx = (await requireFarmer())!; // layout already redirected if absent

  const rows = await db
    .select({
      batchId: batches.id,
      code: batches.code,
      crop: cropVarieties.commonName,
      quantity: batches.quantity,
      unit: batches.unit,
      farmGatePricePaise: batches.farmGatePricePaise,
      status: batches.status,
      harvestedOn: batches.harvestedOn,
    })
    .from(batches)
    .innerJoin(farms, eq(farms.id, batches.farmId))
    .innerJoin(cropVarieties, eq(cropVarieties.id, batches.cropVarietyId))
    .where(eq(farms.orgId, ctx.org.id))
    .orderBy(desc(batches.harvestedOn));

  const s = summariseEarnings(rows);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h1 className="text-[26px] font-bold tracking-tight">Earnings</h1>
      <p className="text-[14px] text-muted mt-1 mb-6 leading-relaxed">
        Every figure here comes from prices recorded on the chain at the moment they were set.
      </p>

      {s.batchCount === 0 ? (
        <div className="card p-5">
          <p className="text-[15px] font-semibold mb-1">Nothing to total yet</p>
          <p className="text-[13.5px] text-muted leading-relaxed mb-4">
            Register a harvest with an asking price and it will appear here.
          </p>
          <Link href="/farmer/harvest/new" className="btn-primary w-full">
            Register a harvest
          </Link>
        </div>
      ) : (
        <>
          <section className="card p-5 mb-3">
            <p className="label">Value registered</p>
            <p className="text-[32px] font-bold tracking-tight leading-none mt-1">
              {rupees(s.registeredPaise)}
            </p>
            <p className="text-[12.5px] text-muted mt-2 leading-relaxed">
              What you asked for across {s.batchCount} batch{s.batchCount === 1 ? "" : "es"}. This is
              not money yet — some of this produce may still be with you.
            </p>
          </section>

          <section className="grid grid-cols-2 gap-px bg-line border border-line rounded-md overflow-hidden mb-5">
            <div className="bg-surface px-4 py-3.5">
              <p className="text-[10.5px] uppercase tracking-[0.09em] text-muted">Sold</p>
              <p className="text-[19px] font-semibold mt-1 tabular-nums">{rupees(s.soldPaise)}</p>
              <p className="text-[11.5px] text-muted mt-0.5 leading-snug">owed to you</p>
            </div>
            <div className="bg-surface px-4 py-3.5">
              <p className="text-[10.5px] uppercase tracking-[0.09em] text-muted">Paid out</p>
              <p className="text-[19px] font-semibold mt-1 tabular-nums">{rupees(s.settledPaise)}</p>
              <p className="text-[11.5px] text-muted mt-0.5 leading-snug">
                payouts not built yet
              </p>
            </div>
          </section>

          {s.unpricedCount > 0 && (
            <div className="card px-4 py-3 mb-5 border-soil/40">
              <p className="text-[13px] text-soil leading-relaxed">
                {s.unpricedCount} batch{s.unpricedCount === 1 ? " has" : "es have"} no price recorded,
                so {s.unpricedCount === 1 ? "it is" : "they are"} missing from every total above.
              </p>
            </div>
          )}

          <h2 className="text-[11px] uppercase tracking-[0.1em] text-muted mb-3">By crop</h2>
          <ul className="flex flex-col gap-2 mb-6">
            {s.byCrop.map((c) => {
              const share = s.registeredPaise > 0 ? (c.valuePaise / s.registeredPaise) * 100 : 0;
              return (
                <li key={c.crop} className="card px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-[15px]">{c.crop}</span>
                    <span className="text-[15px] font-semibold tabular-nums">
                      {rupees(c.valuePaise)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface2 mt-2.5 overflow-hidden">
                    <div className="h-full bg-moss" style={{ width: `${share.toFixed(1)}%` }} />
                  </div>
                  <p className="text-[12px] text-muted mt-1.5 tabular-nums">
                    {c.quantity} {c.unit} · {Math.round(share)}% of registered value
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-line pt-4">
            <p className="text-[12px] text-muted leading-relaxed">
              A statement you can take to a lender — showing verified harvest history and prices —
              arrives with payouts in a later release.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
