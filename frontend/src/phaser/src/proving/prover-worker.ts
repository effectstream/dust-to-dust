import init, {
  CostModel,
  MidnightWasmParamsProvider,
  Rng,
  WasmProver,
  WasmResolver,
  initThreadPool,
} from '@paima/midnight-wasm-prover';
import type { ProverRequest, ProverResponse } from './worker-types';

let prover: WasmProver | undefined;
let rng: Rng | undefined;
let wasmInitialized = false;
let configuredBaseUrl: string | undefined;

const fetchBinary = async (url: string): Promise<ArrayBuffer> => {
  console.log(`[wasm-prover] fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  console.log(`[wasm-prover] fetched ${url} (${buffer.byteLength} bytes)`);
  return buffer;
};

const createResolver = (baseUrl: string): WasmResolver => {
  const proverKeyFetcher = async (keyPath: string): Promise<ArrayBuffer> =>
    await fetchBinary(`${baseUrl}/keys/${keyPath}.prover`);
  const verifierKeyFetcher = async (keyPath: string): Promise<ArrayBuffer> =>
    await fetchBinary(`${baseUrl}/keys/${keyPath}.verifier`);
  const irSourceFetcher = async (keyPath: string): Promise<ArrayBuffer> =>
    await fetchBinary(`${baseUrl}/zkir/${keyPath}.bzkir`);

  return WasmResolver.newWithFetchers(
    proverKeyFetcher,
    verifierKeyFetcher,
    irSourceFetcher,
  );
};

const createParamsProvider = (baseUrl: string): MidnightWasmParamsProvider => {
  const paramsFetcher = async (k: number): Promise<ArrayBuffer> =>
    await fetchBinary(`${baseUrl}/bls_midnight_2p${k}`);

  return MidnightWasmParamsProvider.newWithFetcher(paramsFetcher);
};

const threadCount = () => {
  const concurrency = self.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(4, concurrency));
};

const postError = (requestId: number, error: unknown) => {
  self.postMessage({
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : String(error),
  } satisfies ProverResponse);
};

const initializeWasm = async () => {
  if (wasmInitialized) return;

  await init();
  rng = Rng.new();

  if (self.crossOriginIsolated) {
    console.log(`[wasm-prover] crossOriginIsolated=true, initializing thread pool with ${threadCount()} threads`);
    await initThreadPool(threadCount());
  } else {
    console.warn('[wasm-prover] crossOriginIsolated=false, skipping rayon thread pool init');
  }

  wasmInitialized = true;
};

self.onmessage = async (event: MessageEvent<ProverRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'init': {
        await initializeWasm();
        configuredBaseUrl = message.baseUrl;
        prover = WasmProver.new(
          createResolver(message.baseUrl),
          createParamsProvider(message.baseUrl),
        );
        self.postMessage({
          type: 'init-ready',
          requestId: message.requestId,
        } satisfies ProverResponse);
        return;
      }
      case 'prove': {
        if (!prover || !rng) {
          throw new Error('WASM prover worker is not initialized');
        }
        if (!configuredBaseUrl) {
          throw new Error('WASM prover base URL is not configured');
        }

        const startedAt = performance.now();
        console.log(`[wasm-prover] starting prove, inputBytes=${message.serializedTx.byteLength}`);
        const provenTx = await prover.prove(
          rng,
          message.serializedTx,
          CostModel.initialCostModel(),
        );
        console.log(`[wasm-prover] prove succeeded, outputBytes=${provenTx.byteLength}`);

        self.postMessage(
          {
            type: 'success',
            requestId: message.requestId,
            serializedTx: provenTx,
            durationMs: Math.round(performance.now() - startedAt),
          } satisfies ProverResponse,
          { transfer: [provenTx.buffer] },
        );
        return;
      }
    }
  } catch (error) {
    postError(message.requestId, error);
  }
};
