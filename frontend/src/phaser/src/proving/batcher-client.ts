import { toHex } from "@midnight-ntwrk/compact-runtime";

const DEFAULT_BATCHER_URL = import.meta.env.VITE_BATCHER_MODE_BATCHER_URL || "http://localhost:3334";

export class BatcherClient {
  static circuitName = "";

  public static setCircuitName(circuitName: string) {
    this.circuitName = circuitName;
  }

  public static async delegatedBalanceHook(
    tx: { serialize(): Uint8Array },
  ): Promise<string | null> {
    const serializedTx = toHex(tx.serialize());
    const circuitId = this.circuitName || 'unknown';
    BatcherClient.setCircuitName('');
    return await this.postToBatcher(serializedTx, circuitId, "unbound");
  }

  private static async postToBatcher(
    serializedTx: string,
    circuitId: string,
    txStage: "unproven" | "unbound" | "finalized" = "unbound",
  ): Promise<string | null> {
    console.log(
      `[BatcherClient] Posting to Batcher at ${DEFAULT_BATCHER_URL}/send-input...`,
    );
    const body = {
      data: {
        target: "midnight_balancing",
        address: "moderator_trusted_node",
        addressType: 0,
        input: JSON.stringify({
          tx: serializedTx,
          txStage: txStage,
          circuitId: circuitId,
        }),
        timestamp: Date.now(),
      },
      confirmationLevel: "wait-receipt",
    };

    try {
      const response = await fetch(`${DEFAULT_BATCHER_URL}/send-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[BatcherClient] Batcher rejected transaction (HTTP ${response.status}):`,
          text,
        );
        throw new Error(`Batcher rejected transaction: ${text}`);
      }

      const result = await response.json();
      if (!result.success) {
        console.error(`[BatcherClient] Batcher failed:`, result.message);
        throw new Error(`Batcher failed: ${result.message}`);
      }

      const txHash: string | null = result.transactionHash ?? null;
      console.log(
        `[BatcherClient] ${circuitId} submitted successfully via batcher! txHash=${txHash}`,
      );
      return txHash;
    } catch (e) {
      console.error(`[BatcherClient] Network error calling batcher:`, e);
      throw e;
    }
  }
}
