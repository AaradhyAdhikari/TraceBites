/**
 * Chain adapters.
 *
 * The application never talks to Polygon directly — it talks to this interface.
 * That keeps three things true:
 *
 *   · `npm run dev` works with no RPC, no funded wallet and no deployed contract,
 *     so a teammate can build the farmer flow on a train;
 *   · the Polygon adapter can be swapped for Hyperledger, or for a different L2,
 *     without touching a single route;
 *   · the local adapter's receipts are obviously fake (`local:` prefix, no
 *     PolygonScan link), so a demo can never accidentally imply an anchor that
 *     does not exist. That failure mode is exactly what we are building against.
 */

export interface AnchorRequest {
  /** Hash of the event, or a Merkle root over many. Never the content itself. */
  digest: string;
  batchRef: string;
  kind: string;
  occurredAt: Date;
  mode: "event" | "root";
  eventCount: number;
}

export interface AnchorReceipt {
  txHash: string;
  blockNumber: number | null;
  chainId: number | null;
  explorerUrl: string | null;
  /** False for the local adapter. The UI must not claim verification without it. */
  onPublicChain: boolean;
}

export interface ChainAdapter {
  readonly name: string;
  submit(req: AnchorRequest): Promise<AnchorReceipt>;
}

let cached: ChainAdapter | null = null;

export async function getChainAdapter(): Promise<ChainAdapter> {
  if (cached) return cached;

  if (process.env.CHAIN_ADAPTER === "polygon") {
    const { PolygonAdapter } = await import("./polygon");
    cached = new PolygonAdapter();
  } else {
    const { LocalAdapter } = await import("./local");
    cached = new LocalAdapter();
  }
  return cached;
}
