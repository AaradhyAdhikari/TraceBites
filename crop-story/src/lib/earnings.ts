/**
 * Farmer earnings.
 *
 * Deliberately distinguishes three different numbers that a careless dashboard
 * would merge into one headline:
 *
 *   registered — the farm-gate value of everything the farmer has recorded.
 *                Not money. It is what they asked for, on produce they may
 *                still be holding.
 *   sold       — farm-gate value of batches that reached a SOLD event. Owed,
 *                but not necessarily received.
 *   settled    — money actually paid out.
 *
 * Showing "₹1,20,000 earned" when none of it has been paid is the kind of
 * flattering arithmetic that destroys trust the first time a farmer checks their
 * bank balance. Until payouts exist (Phase 3), `settled` is honestly zero and
 * the UI says so rather than hiding the row.
 *
 * Pure: takes rows, returns a summary. No I/O, fully testable.
 */

export interface EarningsRow {
  batchId: string;
  code: string;
  crop: string;
  quantity: number;
  unit: string;
  /** Farm-gate price per unit in paise; null when the farmer set no price. */
  farmGatePricePaise: number | null;
  status: string;
  harvestedOn: Date;
  /** True once a payout row exists for this batch. Always false until Phase 3. */
  settled?: boolean;
}

export interface EarningsSummary {
  registeredPaise: number;
  soldPaise: number;
  settledPaise: number;
  batchCount: number;
  /** Batches with no price recorded — they cannot appear in any total. */
  unpricedCount: number;
  byCrop: { crop: string; valuePaise: number; quantity: number; unit: string }[];
}

const SOLD_STATUSES = new Set(["sold"]);

export function summariseEarnings(rows: EarningsRow[]): EarningsSummary {
  let registeredPaise = 0;
  let soldPaise = 0;
  let settledPaise = 0;
  let unpricedCount = 0;

  const cropTotals = new Map<string, { valuePaise: number; quantity: number; unit: string }>();

  for (const r of rows) {
    if (r.farmGatePricePaise === null) {
      unpricedCount++;
      continue;
    }

    // Integer paise throughout; round once, at the multiplication, so a
    // fractional quantity cannot leak a sub-paise error into a total.
    const value = Math.round(r.farmGatePricePaise * r.quantity);

    registeredPaise += value;
    if (SOLD_STATUSES.has(r.status)) soldPaise += value;
    if (r.settled) settledPaise += value;

    const existing = cropTotals.get(r.crop);
    if (existing) {
      existing.valuePaise += value;
      // Quantities only add up within a single unit. Mixing kg and quintal into
      // one figure would be silently wrong, so the first unit seen wins and the
      // caller is expected to group by crop, which in practice has one unit.
      if (existing.unit === r.unit) existing.quantity += r.quantity;
    } else {
      cropTotals.set(r.crop, { valuePaise: value, quantity: r.quantity, unit: r.unit });
    }
  }

  const byCrop = [...cropTotals.entries()]
    .map(([crop, v]) => ({ crop, ...v }))
    .sort((a, b) => b.valuePaise - a.valuePaise);

  return {
    registeredPaise,
    soldPaise,
    settledPaise,
    batchCount: rows.length,
    unpricedCount,
    byCrop,
  };
}

/**
 * The farmer's share of a final consumer price.
 *
 * Returns null rather than a misleading number when either side is missing —
 * a share of an unknown total is not a small share, it is no share.
 */
export function farmerSharePercent(
  farmGatePaise: number | null,
  finalPaise: number | null,
): number | null {
  if (farmGatePaise === null || finalPaise === null || finalPaise <= 0) return null;
  return Math.min(100, Math.round((farmGatePaise / finalPaise) * 100));
}
