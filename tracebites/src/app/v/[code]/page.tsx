/**
 * Public verification.
 *
 * No login, no JavaScript needed to read it, server-rendered so it opens on a
 * bad connection at a market stall. This page is the reason the chain exists:
 * a consumer checks the record without trusting whoever runs the database.
 */

import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  batches,
  chainAnchors,
  cropVarieties,
  custodyEvents,
  farms,
  organizations,
  pricePoints,
} from "@/db/schema";
import { parseBatchCode } from "@/lib/batch-code";
import { haversineMetres, verifyChain } from "@/lib/ledger";
import { EVENT_LABEL, dateTime, rupees, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return { title: `${decodeURIComponent(code)} · TraceBites` };
}

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const raw = decodeURIComponent((await params).code);
  const code = parseBatchCode(raw);

  if (!code) {
    return (
      <Shell>
        <h1 className="text-[22px] font-bold tracking-tight">That code isn&rsquo;t valid</h1>
        <p className="text-[14.5px] text-muted mt-2 leading-relaxed">
          <span className="mono">{raw}</span> failed its check character, which usually means a typo.
          Codes look like <span className="mono">RS1234-WH5432-T</span>. Try scanning again rather
          than typing it.
        </p>
      </Shell>
    );
  }

  const [batch] = await db
    .select({
      id: batches.id,
      code: batches.code,
      quantity: batches.quantity,
      unit: batches.unit,
      harvestedOn: batches.harvestedOn,
      status: batches.status,
      crop: cropVarieties.commonName,
      shelfLifeDays: cropVarieties.shelfLifeDays,
      farmName: farms.name,
      district: farms.district,
      state: farms.state,
      farmLat: farms.lat,
      farmLng: farms.lng,
      certification: farms.certification,
      orgName: organizations.name,
    })
    .from(batches)
    .innerJoin(farms, eq(farms.id, batches.farmId))
    .innerJoin(organizations, eq(organizations.id, farms.orgId))
    .innerJoin(cropVarieties, eq(cropVarieties.id, batches.cropVarietyId))
    .where(eq(batches.code, code))
    .limit(1);

  if (!batch) {
    return (
      <Shell>
        <h1 className="text-[22px] font-bold tracking-tight">No such batch</h1>
        <p className="text-[14.5px] text-muted mt-2 leading-relaxed">
          <span className="mono">{code}</span> is a well-formed code, but nothing has been registered
          against it. If this was printed on a package, treat it as unverified.
        </p>
      </Shell>
    );
  }

  const [events, chain, prices] = await Promise.all([
    db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.batchId, batch.id))
      .orderBy(asc(custodyEvents.seq)),
    verifyChain(db, batch.id),
    db
      .select()
      .from(pricePoints)
      .where(eq(pricePoints.batchId, batch.id))
      .orderBy(asc(pricePoints.createdAt)),
  ]);

  const anchorIds = events.map((e) => e.anchorId).filter(Boolean) as string[];
  const anchors = anchorIds.length
    ? await db.select().from(chainAnchors).where(eq(chainAnchors.id, anchorIds[0]!))
    : [];
  const publicAnchor = anchors.find((a) => a.status === "confirmed" && a.txHash);

  // Food-miles: measured from the GPS trail, not assumed.
  const located = events.filter((e) => e.lat !== null && e.lng !== null);
  let metres = 0;
  for (let i = 1; i < located.length; i++) {
    metres += haversineMetres(
      { lat: located[i - 1].lat!, lng: located[i - 1].lng! },
      { lat: located[i].lat!, lng: located[i].lng! },
    );
  }
  const km = Math.round(metres / 1000);

  const daysSinceHarvest = Math.floor(
    (Date.now() - new Date(batch.harvestedOn).getTime()) / 86_400_000,
  );

  const farmGate = prices.find((p) => p.stage === "farm_gate");
  const retail = [...prices].reverse().find((p) => p.stage === "retail") ?? null;
  const finalPaise = retail?.pricePerUnitPaise ?? null;

  return (
    <Shell>
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Verified record</p>
      <h1 className="text-[30px] font-bold tracking-tight mt-1 leading-tight">{batch.crop}</h1>
      <p className="text-[15px] text-ink2 mt-1.5">
        Grown at {batch.farmName}
        {batch.state ? `, ${batch.state}` : ""} · harvested {shortDate(batch.harvestedOn)}
      </p>

      {/* ---- integrity, stated exactly ---------------------------------- */}
      <section
        className={`card px-4 py-3.5 mt-5 ${chain.ok ? "border-moss/40" : "border-crit/50"}`}
      >
        <p className={`text-[14.5px] font-semibold ${chain.ok ? "text-moss" : "text-crit"}`}>
          {chain.ok
            ? `All ${chain.length} records match their fingerprints`
            : `This record has been altered`}
        </p>
        <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
          {chain.ok ? (
            <>
              Every step below was hashed when it happened and linked to the one before it. Changing
              any of them would break the links that follow.
            </>
          ) : (
            chain.reason
          )}
        </p>
        {publicAnchor?.txHash ? (
          <a
            href={`https://amoy.polygonscan.com/tx/${publicAnchor.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block mono text-[12px] text-chain hover:underline mt-2 break-all"
          >
            On Polygon → {publicAnchor.txHash.slice(0, 18)}…
          </a>
        ) : (
          <p className="text-[12px] text-muted mt-2 leading-relaxed">
            Not yet anchored to a public chain — the record is currently held and checked here only.
          </p>
        )}
      </section>

      {/* ---- price breakdown --------------------------------------------- */}
      {farmGate && (
        <section className="card p-4 mt-4">
          <p className="label">
            {finalPaise ? "Where the price went" : "What the farmer was paid"}
          </p>
          {finalPaise ? (
            <PriceBar farmGatePaise={farmGate.pricePerUnitPaise} finalPaise={finalPaise} unit={batch.unit} />
          ) : (
            <>
              <p className="text-[26px] font-bold tracking-tight">
                {rupees(farmGate.pricePerUnitPaise)}
                <span className="text-[15px] font-medium text-muted"> per {batch.unit}</span>
              </p>
              <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">
                Recorded by the farmer at harvest and hashed at that moment, so no later buyer could
                change it. The full breakdown appears once this batch is sold on.
              </p>
            </>
          )}
        </section>
      )}

      {/* ---- facts ------------------------------------------------------- */}
      <section className="grid grid-cols-2 gap-px bg-line border border-line rounded-md overflow-hidden mt-4">
        <Fact label="Days since harvest" value={`${daysSinceHarvest}`} />
        <Fact
          label="Shelf life"
          value={`${batch.shelfLifeDays} days`}
          note={daysSinceHarvest > batch.shelfLifeDays ? "past typical shelf life" : undefined}
        />
        <Fact
          label="Distance travelled"
          value={km > 0 ? `${km} km` : "—"}
          note={km > 0 ? "measured from scans" : "no journey recorded yet"}
        />
        <Fact label="Certification" value={batch.certification ?? "None declared"} />
      </section>

      {/* ---- journey ----------------------------------------------------- */}
      <section className="mt-7">
        <h2 className="text-[11px] uppercase tracking-[0.1em] text-muted mb-3">Journey</h2>
        <ol className="flex flex-col">
          {events.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <div className="flex flex-col items-center pt-1.5">
                <span className="w-2 h-2 rounded-full bg-moss shrink-0" />
                {i < events.length - 1 && <span className="w-px flex-1 bg-line my-1" />}
              </div>
              <div className="pb-5 flex-1 min-w-0">
                <p className="text-[14.5px] font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</p>
                <p className="text-[12.5px] text-muted mt-0.5">{dateTime(e.occurredAt)}</p>
                {e.lat !== null && e.lng !== null && (
                  <p className="mono text-[11.5px] text-muted mt-0.5">
                    {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
                  </p>
                )}
                <p className="mono text-[10.5px] text-line2 mt-1.5 break-all">{e.hash}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line pt-4 mt-2">
        <p className="mono text-[11.5px] text-muted">{batch.code}</p>
        <p className="text-[12px] text-muted mt-2 leading-relaxed">
          TraceBites records what each party said, when they said it, in a form none of them can
          rewrite afterwards. It cannot make a false claim true — an inspector&rsquo;s attestation is
          what tests the claim itself.
        </p>
      </footer>
    </Shell>
  );
}

/* ------------------------------------------------------------- pieces */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <a href="/" className="text-[12px] uppercase tracking-[0.12em] text-moss font-semibold">
        TraceBites
      </a>
      <div className="mt-5">{children}</div>
    </main>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-surface px-3.5 py-3">
      <p className="text-[10.5px] uppercase tracking-[0.09em] text-muted">{label}</p>
      <p className="text-[16px] font-semibold mt-1 leading-tight">{value}</p>
      {note && <p className="text-[11.5px] text-muted mt-0.5 leading-snug">{note}</p>}
    </div>
  );
}

function PriceBar({
  farmGatePaise,
  finalPaise,
  unit,
}: {
  farmGatePaise: number;
  finalPaise: number;
  unit: string;
}) {
  const share = Math.min(100, Math.round((farmGatePaise / finalPaise) * 100));
  return (
    <>
      <p className="text-[26px] font-bold tracking-tight">
        {rupees(finalPaise)}
        <span className="text-[15px] font-medium text-muted"> per {unit}</span>
      </p>
      <div className="flex h-8 rounded overflow-hidden border border-line mt-3">
        <div style={{ width: `${share}%` }} className="bg-moss" />
        <div style={{ width: `${100 - share}%` }} className="bg-line2" />
      </div>
      <div className="flex justify-between text-[12.5px] mt-2">
        <span className="text-ink2">
          Farmer <b className="mono font-semibold">{rupees(farmGatePaise)}</b> · {share}%
        </span>
        <span className="text-muted">
          Everyone else <b className="mono font-semibold">{rupees(finalPaise - farmGatePaise)}</b>
        </span>
      </div>
    </>
  );
}
