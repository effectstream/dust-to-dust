import {
    Game2CircuitKeys,
    safeJSONString,
    type Game2Providers,
} from "game2-api";
import { logger } from "../main";
// Lazy-loaded to avoid crypto-browserify Buffer.slice crash in Vite dev mode.
const getLevelPrivateStateProvider = async () => {
    if (!globalThis.Buffer) {
        const { Buffer } = await import('buffer');
        globalThis.Buffer = Buffer;
    }
    return (await import('@midnight-ntwrk/midnight-js-level-private-state-provider')).levelPrivateStateProvider;
};
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import {
    type UnboundTransaction,
    type ZKConfigProvider,
} from "@midnight-ntwrk/midnight-js-types";
import {
    CoinPublicKey,
    EncPublicKey,
    FinalizedTransaction,
    Transaction,
    TransactionId,
    ZswapSecretKeys,
} from "@midnight-ntwrk/ledger-v8";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { wasmProofProvider } from "./wasm-proof-provider";
import { BatcherClient } from "./batcher-client";

const toHex = (data: Uint8Array): string =>
    Array.from(data)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

const fromHex = (hex: string): Uint8Array => {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    const match = cleanHex.match(/.{1,2}/g);
    return new Uint8Array(match ? match.map((byte) => parseInt(byte, 16)) : []);
};

const LOCAL_ZSWAP_SEED_STORAGE_KEY = 'game2-batcher-zswap-seed';

const getOrCreateLocalZswapKeys = (): ZswapSecretKeys => {
    const existingSeed = window.localStorage.getItem(LOCAL_ZSWAP_SEED_STORAGE_KEY);
    if (existingSeed) {
        return ZswapSecretKeys.fromSeed(fromHex(existingSeed));
    }
    const seed = window.crypto.getRandomValues(new Uint8Array(32));
    window.localStorage.setItem(LOCAL_ZSWAP_SEED_STORAGE_KEY, toHex(seed));
    return ZswapSecretKeys.fromSeed(seed);
};

const DELEGATED_TX_SENTINEL = 'delegated-to-batcher';

/** @internal */
export const initializeProviders = async (): Promise<Game2Providers> => {
    const localKeys = getOrCreateLocalZswapKeys();

    const zkConfigProvider: ZKConfigProvider<Game2CircuitKeys> = new FetchZkConfigProvider(
        window.location.origin,
        fetch.bind(window)
    );

    let pendingTxHash: string | null = null;

    return {
        privateStateProvider: (await getLevelPrivateStateProvider())<string>({
            privateStateStoreName: "game2-private-state",
            privateStoragePasswordProvider: async () => "YourPasswordMy1!",
            accountId: '0',
        }),
        zkConfigProvider,
        proofProvider: wasmProofProvider(zkConfigProvider),
        publicDataProvider: indexerPublicDataProvider(
            import.meta.env.VITE_BATCHER_MODE_INDEXER_HTTP_URL!,
            import.meta.env.VITE_BATCHER_MODE_INDEXER_WS_URL!
        ),
        walletProvider: {
            getCoinPublicKey(): CoinPublicKey {
                return localKeys.coinPublicKey;
            },
            getEncryptionPublicKey(): EncPublicKey {
                return localKeys.encryptionPublicKey;
            },
            async balanceTx(
                tx: UnboundTransaction,
            ): Promise<FinalizedTransaction> {
                const txHash = await BatcherClient.delegatedBalanceHook(tx);
                pendingTxHash = txHash;
                console.log(`[batcher:balanceTx] batcher confirmed txHash=${txHash}`);
                return tx as unknown as FinalizedTransaction;
            },
        },
        midnightProvider: {
            async submitTx(_tx: FinalizedTransaction): Promise<TransactionId> {
                return DELEGATED_TX_SENTINEL as unknown as TransactionId;
            },
        },
    };
};
