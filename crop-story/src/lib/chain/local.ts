import { createHash } from "node:crypto";
import type { AnchorReceipt, AnchorRequest, ChainAdapter } from "./index";

/**
 * Development adapter. Produces a deterministic receipt without a network.
 *
 * Deliberately marked `onPublicChain: false` and prefixed `local:` so that no
 * screen can render it as a verified anchor. A demo that quietly shows a fake
 * transaction hash is the exact dishonesty this project exists to remove.
 */
export class LocalAdapter implements ChainAdapter {
  readonly name = "local";

  async submit(req: AnchorRequest): Promise<AnchorReceipt> {
    const txHash =
      "local:" + createHash("sha256").update(`${req.digest}:${req.mode}`).digest("hex").slice(0, 40);
    return {
      txHash,
      blockNumber: null,
      chainId: null,
      explorerUrl: null,
      onPublicChain: false,
    };
  }
}
