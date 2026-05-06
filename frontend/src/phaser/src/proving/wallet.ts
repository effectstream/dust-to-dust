import { type DeployedGame2API, Game2API, Game2CircuitKeys, type Game2Providers } from 'game2-api';
import { CompactTypeBytes, transientCommit, type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { logger } from '../main';
import semver from 'semver';
import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
// Lazy-loaded to avoid crypto-browserify Buffer.slice crash in Vite dev mode.
// The CJS crypto chain (hash-base -> readable-stream) needs Buffer at init time,
// but esbuild pre-bundling doesn't inject the polyfill early enough.
const getLevelPrivateStateProvider = async () => {
  // Ensure Buffer is globally available before the crypto chain initializes
  if (!globalThis.Buffer) {
    const { Buffer } = await import('buffer');
    globalThis.Buffer = Buffer;
  }
  return (await import('@midnight-ntwrk/midnight-js-level-private-state-provider')).levelPrivateStateProvider;
};
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { type FinalizedTxData, SucceedEntirely, UnboundTransaction, ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';
import { CoinPublicKey, EncPublicKey, type ShieldedCoinInfo, Transaction, type TransactionId, UnprovenTransaction, ZswapSecretKeys, FinalizedTransaction } from '@midnight-ntwrk/ledger-v8';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledgerv8 from '@midnight-ntwrk/ledger-v8';
import { BatcherClient } from './batcher-client';
import { wasmProofProvider } from './wasm-proof-provider';

export class BrowserDeploymentManager {
  #initializedProviders: Promise<Game2Providers> | undefined;

  constructor(private readonly _logger?: any) {
  }

  async create(): Promise<Game2API> {
    console.log('getting providers');
    const providers = await this.getProviders();
    console.log('trying to create');
    return Game2API.deploy(providers, this._logger).then((api) => {
      console.log('got create api');
      return api;
    });
  }
  async join(contractAddress: ContractAddress): Promise<Game2API> {
    console.log('getting providers');
    const providers = await this.getProviders();
    providers.privateStateProvider.setContractAddress(contractAddress);
    console.log('trying to join');
    return Game2API.join(providers, contractAddress, this._logger)
      .then((api) => { console.log('got join api'); return api; });
  }

  private getProviders(): Promise<Game2Providers> {
    return (
      this.#initializedProviders ??
      (this.#initializedProviders = initializeProviders())
    );
  }
}

const toHex = (data: Uint8Array): string =>
  Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string): Uint8Array => {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const match = cleanHex.match(/.{1,2}/g);
  return new Uint8Array(match ? match.map((byte) => parseInt(byte, 16)) : []);
};

const DELEGATED_TX_SENTINEL = 'delegated-to-batcher';
const LOCAL_ZSWAP_SEED_STORAGE_KEY = 'game2-local-zswap-seed';

const getOrCreateLocalZswapKeys = (): ZswapSecretKeys => {
  const existingSeed = window.localStorage.getItem(LOCAL_ZSWAP_SEED_STORAGE_KEY);

  if (existingSeed) {
    return ZswapSecretKeys.fromSeed(fromHex(existingSeed));
  }

  const seed = window.crypto.getRandomValues(new Uint8Array(32));
  window.localStorage.setItem(LOCAL_ZSWAP_SEED_STORAGE_KEY, toHex(seed));
  return ZswapSecretKeys.fromSeed(seed);
};

/** @internal */
const initializeProviders = async (): Promise<Game2Providers> => {
  const envIndexerUri = import.meta.env.VITE_BATCHER_MODE_INDEXER_HTTP_URL as string | undefined;
  const envIndexerWsUri = import.meta.env.VITE_BATCHER_MODE_INDEXER_WS_URL as string | undefined;
  const useInjectedWallet = !!(window as any).midnight && !envIndexerUri;

  let shieldedCoinPublicKey: CoinPublicKey;
  let shieldedEncryptionPublicKey: EncPublicKey;
  let walletConfig: { indexerUri: string; indexerWsUri: string } | undefined;

  if (useInjectedWallet) {
    const wallet = await connectToWallet(getNetworkId());
    const addresses = await wallet.getShieldedAddresses();
    shieldedCoinPublicKey = addresses.shieldedCoinPublicKey;
    shieldedEncryptionPublicKey = addresses.shieldedEncryptionPublicKey;
    walletConfig = await wallet.getConfiguration();
    console.log(`[wallet] wallet indexerUri=${walletConfig.indexerUri} indexerWsUri=${walletConfig.indexerWsUri}`);
  } else {
    const localKeys = getOrCreateLocalZswapKeys();
    shieldedCoinPublicKey = localKeys.coinPublicKey;
    shieldedEncryptionPublicKey = localKeys.encryptionPublicKey;
    console.log('[wallet] Using local zswap identity; skipping injected wallet');
  }

  const indexerUri: string =
    envIndexerUri || walletConfig?.indexerUri || '';
  const indexerWsUri: string =
    envIndexerWsUri || walletConfig?.indexerWsUri || '';

  if (!indexerUri || !indexerWsUri) {
    throw new Error('Indexer URLs are missing. Configure VITE_BATCHER_MODE_INDEXER_HTTP_URL and VITE_BATCHER_MODE_INDEXER_WS_URL, or install an injected Midnight wallet.');
  }

  console.log(`[wallet] Using indexer: ${indexerUri} (${walletConfig && indexerUri === walletConfig.indexerUri ? 'from wallet' : 'from env/local override'})`);
  console.log(`[wallet] Using indexer WS: ${indexerWsUri}`);

  let pendingTxHash: string | null = null;

  const getTxIdentifierByHash = async (txHash: string): Promise<string | null> => {
    const query = `
      query GetTxByHash($hash: String!) {
        transactions(offset: { hash: $hash }) {
          ... on RegularTransaction {
            identifiers
          }
        }
      }
    `;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const response = await fetch(indexerUri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { hash: txHash } }),
        });
        const body = await response.json();
        const txs: any[] = body?.data?.transactions ?? [];
        if (txs.length > 0 && Array.isArray(txs[0].identifiers) && txs[0].identifiers.length > 0) {
          const id = txs[0].identifiers[0] as string;
          console.log(`[wallet:getTxIdentifierByHash] txHash=${txHash} -> identifier=${id} (attempt ${attempt})`);
          return id;
        }
      } catch (e) {
        console.warn(`[wallet:getTxIdentifierByHash] attempt ${attempt} error:`, e);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.warn(`[wallet:getTxIdentifierByHash] Could not resolve identifier for txHash=${txHash} after 10 attempts`);
    return null;
  };

  const walletProvider = {
    getCoinPublicKey(): CoinPublicKey {
      return shieldedCoinPublicKey;
    },
    getEncryptionPublicKey(): EncPublicKey {
      return shieldedEncryptionPublicKey;
    },
    async balanceTx(
      tx: UnboundTransaction,
    ): Promise<FinalizedTransaction> {
      const txHash = await BatcherClient.delegatedBalanceHook(tx);
      pendingTxHash = txHash;
      console.log(`[wallet:balanceTx] batcher confirmed txHash=${txHash}`);
      window.dispatchEvent(new CustomEvent('d2d-tx-submitted', { detail: { txHash } }));
      return tx as unknown as FinalizedTransaction;
    },
  };

  const zkConfigProvider: ZKConfigProvider<Game2CircuitKeys> = new FetchZkConfigProvider(window.location.origin, fetch.bind(window));

  const basePublicDataProvider = indexerPublicDataProvider(indexerUri, indexerWsUri);
  const publicDataProvider = {
    ...basePublicDataProvider,
    queryZSwapAndContractState: async (contractAddress: any, config?: any) => {
      console.log(`[wallet:queryZSwapAndContractState] contractAddress=${contractAddress}`);

      let resolvedConfig = config;
      if (!resolvedConfig) {
        try {
          const heightQuery = `
            query GetLatestContractBlock($address: HexEncoded!) {
              contractAction(address: $address) {
                transaction {
                  block {
                    height
                  }
                }
              }
            }
          `;
          const response = await fetch(indexerUri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: heightQuery, variables: { address: contractAddress } }),
          });
          const body = await response.json();
          const height = body?.data?.contractAction?.transaction?.block?.height;
          if (height != null) {
            console.log(`[wallet:queryZSwapAndContractState] Resolved latest contract blockHeight=${height}`);
            resolvedConfig = { type: 'blockHeight', blockHeight: height };
          } else {
            console.warn(`[wallet:queryZSwapAndContractState] Could not resolve contract block height — falling back to null offset`);
          }
        } catch (e) {
          console.warn(`[wallet:queryZSwapAndContractState] Failed to fetch contract block height:`, e);
        }
      }

      const result = await basePublicDataProvider.queryZSwapAndContractState(contractAddress, resolvedConfig);
      if (!result) {
        console.error(`[wallet:queryZSwapAndContractState] RETURNED NULL for contractAddress=${contractAddress}`);
      } else {
        const [, contractState] = result;
        const stateKeys = contractState ? Object.keys(contractState).join(', ') : 'null';
        console.log(`[wallet:queryZSwapAndContractState] OK — contractState keys: ${stateKeys}`);
      }
      return result;
    },
    watchForTxData: async (txId: TransactionId): Promise<FinalizedTxData> => {
      if ((txId as unknown as string) !== DELEGATED_TX_SENTINEL) {
        return basePublicDataProvider.watchForTxData(txId);
      }

      const txHash = pendingTxHash;
      pendingTxHash = null;

      if (txHash) {
        console.log(`[wallet] watchForTxData: intercepted sentinel, resolving identifier for txHash=${txHash}...`);
        const identifier = await getTxIdentifierByHash(txHash);
        if (identifier) {
          console.log(`[wallet] watchForTxData: waiting for real indexer confirmation via identifier=${identifier}`);
          return basePublicDataProvider.watchForTxData(identifier as unknown as TransactionId);
        }
        console.warn('[wallet] watchForTxData: could not resolve identifier, falling back to mock');
      } else {
        console.warn('[wallet] watchForTxData: no pendingTxHash — returning mock FinalizedTxData immediately');
      }

      return Promise.resolve({
        tx: null as any,
        status: SucceedEntirely,
        txId,
        identifiers: [],
        txHash: DELEGATED_TX_SENTINEL as any,
        blockHash: DELEGATED_TX_SENTINEL,
        blockHeight: 0,
        blockTimestamp: Date.now(),
        blockAuthor: null,
        indexerId: 0,
        protocolVersion: 0,
        fees: { paidFees: '0', estimatedFees: '0' },
        segmentStatusMap: undefined,
        unshielded: { created: [], spent: [] },
      } as FinalizedTxData);
    },
  };

  return {
    privateStateProvider: (await getLevelPrivateStateProvider())<string>({
      privateStateStoreName: 'game2-private-state',
      privateStoragePasswordProvider: async () => "YourPasswordMy1!",
      accountId: '0',
    }),
    zkConfigProvider,
    proofProvider: wasmProofProvider(zkConfigProvider),
    publicDataProvider,
    walletProvider,
    midnightProvider: {
      async submitTx(_tx: ledgerv8.FinalizedTransaction): Promise<TransactionId> {
        return DELEGATED_TX_SENTINEL as unknown as TransactionId;
      },
    },
  };
};

/** @internal */
const connectToWallet = async (networkId: string): Promise<ConnectedAPI> => {
  const COMPATIBLE_CONNECTOR_API_VERSION = '>=1.0.0';
  const midnight = (window as any).midnight;

  if (!midnight) {
    throw new Error("Midnight Lace wallet not found. Extension installed?");
  }

  const wallets = Object.entries(midnight).filter(([_, api]: [string, any]) =>
    api.apiVersion && semver.satisfies(api.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
  ) as [string, any][];

  if (wallets.length === 0) {
    throw new Error("No compatible Midnight wallet found.");
  }

  const [name, api] = wallets[0];
  logger.debug(`Connecting to wallet: ${name} (version ${api.apiVersion})`);

  return api.connect(networkId);
};
