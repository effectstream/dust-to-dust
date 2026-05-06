import {
    ProveTxConfig,
    type UnboundTransaction,
} from "@midnight-ntwrk/midnight-js-types";
import {
    Transaction,
    UnprovenTransaction,
} from "@midnight-ntwrk/ledger-v8";
import {
    WasmProver,
    MidnightWasmParamsProvider,
    Rng,
    CostModel,
    WasmResolver,
} from "@paima/midnight-wasm-prover";
import { logger } from "../logger";

export async function proveTxLocally(
    baseUrl: string,
    tx: Uint8Array,
    proveTxConfig?: ProveTxConfig
): Promise<Uint8Array> {
    const fetchBinary = async (url: string): Promise<ArrayBuffer> => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
        return await response.arrayBuffer();
    };

    const resolver = WasmResolver.newWithFetchers(
        async (keyPath: string) => await fetchBinary(`${baseUrl}/keys/${keyPath}.prover`),
        async (keyPath: string) => await fetchBinary(`${baseUrl}/keys/${keyPath}.verifier`),
        async (keyPath: string) => await fetchBinary(`${baseUrl}/zkir/${keyPath}.bzkir`),
    );

    const paramsProvider = MidnightWasmParamsProvider.newWithFetcher(
        async (k: number) => await fetchBinary(`${baseUrl}/bls_midnight_2p${k}`),
    );

    const prover = WasmProver.new(resolver, paramsProvider);
    const rng = Rng.new();

    logger.network.info(
        `Starting ZK proof [${navigator.hardwareConcurrency} threads]`
    );

    const startTime = performance.now();

    let provenTxRaw = await prover.prove(
        rng,
        tx,
        CostModel.initialCostModel(),
    );

    const endTime = performance.now();
    logger.network.info(
        `Proved tx in: ${Math.floor(endTime - startTime)} ms`
    );

    return provenTxRaw;
}
