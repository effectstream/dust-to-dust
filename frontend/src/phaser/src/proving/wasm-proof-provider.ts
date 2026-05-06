import { Transaction } from '@midnight-ntwrk/ledger-v8';
import type {
  ProofProvider,
  ProveTxConfig,
  UnboundTransaction,
  ZKConfigProvider,
} from '@midnight-ntwrk/midnight-js-types';
import WasmProverWorker from './prover-worker?worker';
import type { ProverRequest, ProverResponse } from './worker-types';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

const DEFAULT_TIMEOUT_MS = 300000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`WASM prover timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
};

class WasmProofWorkerClient {
  private readonly worker = new WasmProverWorker();
  private readonly pending = new Map<number, { resolve: (value: ProverResponse) => void; reject: (reason?: unknown) => void }>();
  private requestId = 0;
  private readonly ready: Promise<void>;

  constructor(baseUrl: string) {
    this.worker.onmessage = (event: MessageEvent<ProverResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;

      this.pending.delete(message.requestId);

      if (message.type === 'error') {
        pending.reject(new Error(message.message));
        return;
      }

      pending.resolve(message);
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'WASM prover worker crashed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };

    this.ready = this.send({ type: 'init', requestId: 0, baseUrl }).then(() => undefined);
  }

  async prove(serializedTx: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    await this.ready;
    const startedAt = performance.now();
    const response = await withTimeout(
      this.send({ type: 'prove', requestId: 0, serializedTx }, [serializedTx.buffer]),
      timeoutMs,
    );

    if (response.type !== 'success') {
      throw new Error(`Unexpected prover worker response: ${response.type}`);
    }

    const totalDurationMs = Math.round(performance.now() - startedAt);
    console.info(
      `[wasm-prover] proof completed total=${totalDurationMs}ms worker=${response.durationMs}ms inputBytes=${response.serializedTx.byteLength}`,
    );

    return response.serializedTx;
  }

  private send(message: ProverRequest, transfer: Transferable[] = []): Promise<ProverResponse> {
    const requestId = ++this.requestId;

    return new Promise<ProverResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...message, requestId }, transfer);
    });
  }
}

export const wasmProofProvider = <K extends string>(
  _zkConfigProvider: ZKConfigProvider<K>,
  baseUrl: string = window.location.origin,
): ProofProvider => {
  const client = new WasmProofWorkerClient(baseUrl);

  return {
    async proveTx(unprovenTx, proveTxConfig?: ProveTxConfig): Promise<UnboundTransaction> {
      let circuitName = '';
      try {
        const key: number = unprovenTx?.intents?.keys().next()?.value!;
        const action = unprovenTx?.intents?.get(key)?.actions[0];
        circuitName = (action as any).entryPoint;
      } catch (error) {
        console.error('Error getting circuit name', error);
      }
      console.log('circuitName:', circuitName);

      try {
        const inputBytes = unprovenTx.serialize();
        const startedAt = performance.now();
        console.info(`[wasm-prover] proveTx started inputBytes=${inputBytes.byteLength}`);
        const provenSerializedTx = await client.prove(
          inputBytes,
          proveTxConfig?.timeout ?? DEFAULT_TIMEOUT_MS,
        );

        console.info(
          `[wasm-prover] proveTx finished duration=${Math.round(performance.now() - startedAt)}ms outputBytes=${provenSerializedTx.byteLength}`,
        );

        window.dispatchEvent(new CustomEvent('d2d-proof-complete', { detail: { circuitName } }));

        return Transaction.deserialize(
          'signature',
          'proof',
          'pre-binding',
          provenSerializedTx,
        ) as UnboundTransaction;
      } catch (error) {
        console.error('Error proving transaction with WASM, falling back to httpClientProofProvider', error);
        return await httpClientProofProvider('http://localhost:6300', _zkConfigProvider).proveTx(unprovenTx);
      }
    },
  };
};
