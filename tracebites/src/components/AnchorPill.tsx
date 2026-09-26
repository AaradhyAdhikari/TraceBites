/**
 * Chain state, stated precisely.
 *
 * Never says "verified" or "blockchain secured" on its own — the prototype's
 * habit of decorating everything with a chain badge is what this replaces. It
 * reports how many events are in the chain, and (on the detail view) whether
 * they reached a public chain, with a link when they did.
 */
export function AnchorPill({
  events,
  txHash,
  explorerUrl,
}: {
  events: number;
  txHash?: string | null;
  explorerUrl?: string | null;
}) {
  if (txHash && explorerUrl) {
    return (
      <a
        href={explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] mono px-1.5 py-0.5 rounded bg-chainSoft text-chain hover:underline"
      >
        anchored · {txHash.slice(0, 10)}…
      </a>
    );
  }

  if (txHash?.startsWith("local:")) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] mono px-1.5 py-0.5 rounded bg-surface2 text-muted">
        local ledger only
      </span>
    );
  }

  return (
    <span className="text-[11px] mono text-muted">
      {events} event{events === 1 ? "" : "s"} in chain
    </span>
  );
}
