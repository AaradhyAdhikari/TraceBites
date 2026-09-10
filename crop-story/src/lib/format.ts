/** Money is integer paise everywhere. Format only at the edge. */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function shortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const EVENT_LABEL: Record<string, string> = {
  HARVESTED: "Harvested",
  PHOTO_ATTACHED: "Photo attached",
  CERT_LINKED: "Certificate linked",
  QUALITY_GRADED: "Quality graded",
  PRICE_SET: "Price set",
  CUSTODY_TRANSFERRED: "Custody transferred",
  BATCH_SPLIT: "Split into lots",
  COLD_CHAIN_PING: "Cold chain reading",
  IN_TRANSIT: "In transit",
  LISTED: "Listed for sale",
  SOLD: "Sold",
  RATED: "Rated by buyer",
  INSPECTED: "Inspector attested",
  RECALLED: "Recalled",
};
