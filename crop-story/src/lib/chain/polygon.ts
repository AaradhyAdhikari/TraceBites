import type { AnchorReceipt, AnchorRequest, ChainAdapter } from "./index";

/**
 * Polygon Amoy adapter.
 *
 * Deliberately not wired to viem yet: the contract at contracts/src/CropStoryRegistry.sol
 * has to be reviewed, fuzz-tested and deployed before anything writes to it, and a
 * half-working chain path is worse than an honest gap.
 *
 * What lands here next (Phase 0, week 2):
 *   · viem walletClient over POLYGON_RPC_URL with the relayer key from KMS
 *   · serial nonce management — one relayer, one in-flight tx at a time, else
 *     replacements silently drop events
 *   · gas ceiling + exponential backoff; the outbox already carries retry state
 *   · writeContract(registerBatch | appendEvent | anchorRoot) by req.mode
 *   · receipt polling to fill blockNumber and confirmations
 */
export class PolygonAdapter implements ChainAdapter {
  readonly name = "polygon-amoy";
  readonly chainId = 80002;

  async submit(_req: AnchorRequest): Promise<AnchorReceipt> {
    const missing = ["POLYGON_RPC_URL", "REGISTRY_CONTRACT_ADDRESS", "RELAYER_PRIVATE_KEY"].filter(
      (k) => !process.env[k],
    );
    throw new Error(
      missing.length
        ? `Polygon adapter is not configured — missing ${missing.join(", ")}. Set CHAIN_ADAPTER=local for development.`
        : "Polygon adapter is not implemented yet — the registry contract has not been deployed. Set CHAIN_ADAPTER=local.",
    );
  }
}
