import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { batches, cropVarieties, custodyEvents, farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { verifyChain } from "@/lib/ledger";
import { verifyUrl } from "@/lib/batch-code";
import { EVENT_LABEL, dateTime, rupees, shortDate } from "@/lib/format";

export default async function BatchDetail({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const ctx = await requireFarmer();
  if (!ctx) redirect("/login");

  const { code } = await params;
  const { new: isNew } = await searchParams;

  const [batch] = await db
    .select({
      id: batches.id,
      code: batches.code,
      quantity: batches.quantity,
      unit: batches.unit,
      harvestedOn: batches.harvestedOn,
      status: batches.status,
      price: batches.farmGatePricePaise,
      crop: cropVarieties.commonName,
      farmName: farms.name,
      farmOrgId: farms.orgId,
    })
    .from(batches)
    .innerJoin(farms, eq(farms.id, batches.farmId))
    .innerJoin(cropVarieties, eq(cropVarieties.id, batches.cropVarietyId))
    .where(eq(batches.code, decodeURIComponent(code)))
    .limit(1);

  if (!batch || batch.farmOrgId !== ctx.org.id) notFound();

  const [events, chain] = await Promise.all([
    db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.batchId, batch.id))
      .orderBy(asc(custodyEvents.seq)),
    verifyChain(db, batch.id),
  ]);

  const url = verifyUrl(batch.code);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 512, errorCorrectionLevel: "M" });

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Link href="/farmer" className="text-[13px] text-muted hover:text-ink">
        ← My batches
      </Link>

      {isNew && (
        <div className="card border-moss/50 bg-mossSoft px-4 py-3 mt-4 text-[13.5px] leading-relaxed">
          <strong className="font-semibold">Registered.</strong> Print this code and put it on the
          crate. Anyone who scans it can see where this came from.
        </div>
      )}

      <h1 className="text-[26px] font-bold tracking-tight mt-4">{batch.crop}</h1>
      <p className="text-[14px] text-muted mt-1">
        {batch.quantity} {batch.unit} · harvested {shortDate(batch.harvestedOn)} · {batch.farmName}
      </p>

      {/* ---- the label -------------------------------------------------- */}
      <section className="card p-5 mt-5 flex flex-col items-center gap-3 print:border-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR code for batch ${batch.code}`} className="w-48 h-48" />
        <p className="mono text-[15px] font-medium tracking-wide">{batch.code}</p>
        <p className="text-[12px] text-muted text-center leading-relaxed max-w-[260px]">
          The last character is a check digit — a mistyped code fails instead of opening someone
          else&rsquo;s harvest.
        </p>
        <div className="flex gap-2 w-full mt-1 print:hidden">
          <a href={qr} download={`${batch.code}.png`} className="btn-ghost flex-1">
            Download
          </a>
          <a href={url} target="_blank" rel="noreferrer" className="btn-ghost flex-1">
            Open public page
          </a>
        </div>
      </section>

      {batch.price !== null && (
        <section className="card p-4 mt-4">
          <p className="label mb-1">Your price, recorded on the chain</p>
          <p className="text-[24px] font-bold tracking-tight">
            {rupees(batch.price)}
            <span className="text-[15px] font-medium text-muted"> per {batch.unit}</span>
          </p>
          <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">
            No buyer can alter this figure after the fact. It is what the consumer will see as your
            share of the final price.
          </p>
        </section>
      )}

      {/* ---- the chain --------------------------------------------------- */}
      <section className="mt-7">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[11px] uppercase tracking-[0.1em] text-muted">
            Chain · {events.length} event{events.length === 1 ? "" : "s"}
          </h2>
          <span
            className={`text-[11.5px] mono ${chain.ok ? "text-moss" : "text-crit font-semibold"}`}
          >
            {chain.ok ? "intact" : `broken at #${chain.brokenAtSeq}`}
          </span>
        </div>

        <ol className="flex flex-col">
          {events.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <div className="flex flex-col items-center pt-1.5">
                <span className="w-2 h-2 rounded-full bg-moss shrink-0" />
                {i < events.length - 1 && <span className="w-px flex-1 bg-line my-1" />}
              </div>
              <div className="pb-5 min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</p>
                <p className="text-[12.5px] text-muted mt-0.5">{dateTime(e.occurredAt)}</p>
                {e.withinGeofence === false && (
                  <p className="text-[12px] text-soil mt-1">
                    Recorded away from the registered field — flagged for inspection.
                  </p>
                )}
                <p className="mono text-[10.5px] text-line2 mt-1.5 break-all">
                  {e.hash.slice(0, 32)}…
                </p>
              </div>
            </li>
          ))}
        </ol>

        {!chain.ok && (
          <div className="card border-crit/50 px-4 py-3 text-[13px] text-crit leading-relaxed">
            {chain.reason}
          </div>
        )}
      </section>
    </div>
  );
}
