#!/usr/bin/env node

/**
 * Admin tools for Dust 2 Dust game contracts.
 * Handles content registration, contract join, info, and cleanup.
 */

import { Command } from 'commander';
import { Buffer } from 'node:buffer';
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import { buildWalletFacade, getInitialShieldedState } from "@paimaexample/midnight-contracts";
import { fromFileUrl, dirname, join } from "@std/path";
import { Game2API } from "game2-api";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { toHex } from "@midnight-ntwrk/compact-runtime";
import {
  type UnboundTransaction,
  type FinalizedTransaction,
} from "@midnight-ntwrk/midnight-js-types";
import {
  type TransactionId,
} from "@midnight-ntwrk/ledger-v8";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  log: (...args: any[]) => console.log('[LOG]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => {},
  trace: (...args: any[]) => {},
  fatal: (...args: any[]) => console.error('[FATAL]', ...args),
}

const here = dirname(fromFileUrl(import.meta.url));

const DEFAULT_BATCHER_URL = process.env.BATCHER_URL || 'http://localhost:3334';

/**
 * Resolve the contract address from either --contract flag or the
 * deployed contract file (written by contract-game2-deploy.ts).
 */
function resolveContractAddress(contractOption?: string): string {
  if (contractOption) return contractOption;

  const data = readMidnightContract("contract-game2", {
    baseDir: here,
    networkId: midnightNetworkConfig.id,
  });

  if (!data.contractAddress) {
    logger.error(`No deployed contract address found for network: ${midnightNetworkConfig.id}`);
    logger.error('Either deploy a contract first or provide --contract <address>');
    process.exit(1);
  }

  return data.contractAddress;
}

// ---------------------------------------------------------------------------
// Batcher interaction
// ---------------------------------------------------------------------------

async function postToBatcher(serializedTx: string, circuitId: string): Promise<string | null> {
  const body = {
    data: {
      target: "midnight_balancing",
      address: "moderator_trusted_node",
      addressType: 0,
      input: JSON.stringify({
        tx: serializedTx,
        txStage: "unbound",
        circuitId,
      }),
      timestamp: Date.now(),
    },
    confirmationLevel: "wait-receipt",
  };

  const response = await fetch(`${DEFAULT_BATCHER_URL}/send-input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Batcher rejected transaction (HTTP ${response.status}): ${text}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`Batcher failed: ${result.message}`);
  }

  const txHash = result.transactionHash;
  if (!txHash) return null;

  // The batcher returns the tx hash, but the SDK needs the tx identifier.
  // Query the indexer by hash to get the identifier for watchForTxData.
  const indexerResponse = await fetch(midnightNetworkConfig.indexer, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query { transactions(offset: { hash: "${txHash}" }) { raw } }`,
    }),
  });
  const indexerResult = await indexerResponse.json();
  const rawHex = indexerResult?.data?.transactions?.[0]?.raw;
  if (rawHex) {
    const { Transaction } = await import("@midnight-ntwrk/ledger-v8");
    const rawBytes = new Uint8Array(rawHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
    const tx = Transaction.deserialize('signature', 'proof', 'binding', rawBytes);
    const identifiers = tx.identifiers();
    if (identifiers.length > 0) {
      logger.info(`Resolved tx identifier: ${identifiers[0]} (hash: ${txHash})`);
      return identifiers[0];
    }
  }

  return txHash;
}

// ---------------------------------------------------------------------------
// Provider initialization
// ---------------------------------------------------------------------------

async function initializeBatcherProviders(batcherUrl: string) {
  setNetworkId(midnightNetworkConfig.id);

  // Build wallet using the same HD derivation as the deploy script
  // to get the correct coin public key that matches the contract's admin key
  const networkUrls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };
  const walletResult = await buildWalletFacade(networkUrls, midnightNetworkConfig.walletSeed, midnightNetworkConfig.id);
  const { zswapSecretKeys } = walletResult;

  logger.info(`Wallet coin public key: ${zswapSecretKeys.coinPublicKey}`);

  const zkConfigDir = join(here, "contract-game2", "src", "managed", "game2");
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigDir);

  let lastTxHash: string | null = null;

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: "midnight-level-db-deploy",
      privateStateStoreName: "game2-private-state-deploy",
      privateStoragePasswordProvider: async () => process.env.MIDNIGHT_STORAGE_PASSWORD || "YourPasswordMy1!",
      accountId: Buffer.from(zswapSecretKeys.coinPublicKey as any).toString('hex'),
    }),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(midnightNetworkConfig.proofServer, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(
      midnightNetworkConfig.indexer,
      midnightNetworkConfig.indexerWS,
    ),
    walletProvider: {
      getCoinPublicKey() { return zswapSecretKeys.coinPublicKey; },
      getEncryptionPublicKey() { return zswapSecretKeys.encryptionPublicKey; },
      async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
        const serialized = toHex(tx.serialize());
        lastTxHash = await postToBatcher(serialized, 'admin');
        logger.info(`Batcher confirmed txHash=${lastTxHash}`);
        return tx as unknown as FinalizedTransaction;
      },
    },
    midnightProvider: {
      async submitTx(_tx: FinalizedTransaction): Promise<TransactionId> {
        return (lastTxHash ?? '0'.repeat(64)) as unknown as TransactionId;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// JSON content loading
// ---------------------------------------------------------------------------

type ContentJSON = {
  levels: { level: { biome: number; difficulty: number }; enemies: SerializedEnemiesConfig }[];
  enemyConfigs: { level: { biome: number; difficulty: number }; enemies: SerializedEnemiesConfig }[];
  questDurations?: { level: { biome: number; difficulty: number }; durationSec: number }[];
};

type SerializedEnemiesConfig = {
  stats: {
    boss_type: number;
    enemy_type: number;
    hp: number;
    moves: { attack: number; block_self: number; block_allies: number; heal_self: number; heal_allies: number }[];
    move_count: number;
    physical_def: number;
    fire_def: number;
    ice_def: number;
  }[];
  count: number;
};

function toBigIntContent(entry: SerializedEnemiesConfig) {
  return {
    stats: entry.stats.map((s) => ({
      boss_type: s.boss_type,
      enemy_type: BigInt(s.enemy_type),
      hp: BigInt(s.hp),
      moves: s.moves.map((m) => ({
        attack: BigInt(m.attack),
        block_self: BigInt(m.block_self),
        block_allies: BigInt(m.block_allies),
        heal_self: BigInt(m.heal_self),
        heal_allies: BigInt(m.heal_allies),
      })),
      move_count: BigInt(s.move_count),
      physical_def: BigInt(s.physical_def),
      fire_def: BigInt(s.fire_def),
      ice_def: BigInt(s.ice_def),
    })),
    count: BigInt(entry.count),
  };
}

function toLevel(l: { biome: number; difficulty: number }) {
  return { biome: BigInt(l.biome), difficulty: BigInt(l.difficulty) };
}

const DEFAULT_CONTENT_JSON = join(here, '..', '..', '..', 'frontend', 'src', 'content', 'dist', 'game-content.json');

function loadContentJSON(path: string): ContentJSON {
  const raw = Deno.readTextFileSync(path);
  return JSON.parse(raw) as ContentJSON;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('game2-admin')
  .description('Admin tools for Dust 2 Dust game contracts')
  .version('0.1.0');

program
  .command('register-content')
  .description('Register all game content (levels, enemies, bosses) using batcher mode')
  .option('--contract <address>', 'Contract address (overrides saved deployment)')
  .option('--content-json <path>', 'Path to game-content.json (default: frontend/src/content/dist/game-content.json)')
  .action(async (options) => {
    try {
      const contractAddress = resolveContractAddress(options.contract);
      const contentPath = options.contentJson ?? DEFAULT_CONTENT_JSON;

      logger.info(`Network: ${midnightNetworkConfig.id}`);
      logger.info(`Connecting to contract: ${contractAddress}`);
      logger.info(`Batcher: ${DEFAULT_BATCHER_URL}`);
      logger.info(`Indexer: ${midnightNetworkConfig.indexer}`);
      logger.info(`Proof server: ${midnightNetworkConfig.proofServer}`);
      logger.info(`Content JSON: ${contentPath}`);

      const content = loadContentJSON(contentPath);

      const providers = await initializeBatcherProviders(DEFAULT_BATCHER_URL);
      providers.privateStateProvider.setContractAddress(contractAddress);
      logger.info('Providers initialized, joining contract...');

      const api = await Game2API.join(providers, contractAddress, logger);
      logger.info('Successfully joined contract!');

      logger.info(`Registering ${content.levels.length} levels...`);
      for (let i = 0; i < content.levels.length; ++i) {
        logger.info(`  Level ${i + 1} / ${content.levels.length}`);
        const entry = content.levels[i];
        await api.admin_level_new(toLevel(entry.level), toBigIntContent(entry.enemies));
      }

      logger.info(`Registering ${content.enemyConfigs.length} enemy configurations...`);
      for (let i = 0; i < content.enemyConfigs.length; ++i) {
        logger.info(`  Enemy config ${i + 1} / ${content.enemyConfigs.length}`);
        const entry = content.enemyConfigs[i];
        await api.admin_level_add_config(toLevel(entry.level), toBigIntContent(entry.enemies));
      }

      // Register quest durations
      if (content.questDurations && content.questDurations.length > 0) {
        logger.info(`Registering ${content.questDurations.length} quest durations...`);
        for (let i = 0; i < content.questDurations.length; ++i) {
          const entry = content.questDurations[i];
          const level = toLevel(entry.level);
          const duration = BigInt(entry.durationSec);
          logger.info(`  Quest duration ${i + 1} / ${content.questDurations.length}: biome ${entry.level.biome} diff ${entry.level.difficulty} = ${duration}s`);
          await api.admin_set_quest_duration(level, duration);
        }
      }

      logger.info('All content registered successfully!');
    } catch (error) {
      logger.error(`Content registration failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('join')
  .description('Join an existing contract and verify connection')
  .option('--contract <address>', 'Contract address')
  .action(async (options) => {
    try {
      const contractAddress = resolveContractAddress(options.contract);

      logger.info(`Network: ${midnightNetworkConfig.id}`);
      logger.info(`Joining contract: ${contractAddress}`);
      logger.info(`Batcher: ${DEFAULT_BATCHER_URL}`);

      const providers = await initializeBatcherProviders(DEFAULT_BATCHER_URL);
      providers.privateStateProvider.setContractAddress(contractAddress);
      const api = await Game2API.join(providers, contractAddress, logger);

      logger.info('Successfully joined contract!');
      logger.info(`Contract address: ${api.deployedContractAddress}`);
    } catch (error) {
      logger.error(`Failed to join contract: ${error}`);
      process.exit(1);
    }
  });

program
  .command('set-quest-duration')
  .description('Set the quest duration in seconds for a specific level (admin only)')
  .argument('<biome>', 'Biome ID (0=grasslands, 1=desert, 2=tundra, 3=cave)')
  .argument('<difficulty>', 'Difficulty level (1, 2, or 3)')
  .argument('<seconds>', 'Quest duration in seconds')
  .option('--contract <address>', 'Contract address')
  .action(async (biome: string, difficulty: string, seconds: string, options: any) => {
    try {
      const contractAddress = resolveContractAddress(options.contract);
      const level = { biome: BigInt(biome), difficulty: BigInt(difficulty) };
      const duration = BigInt(seconds);

      logger.info(`Network: ${midnightNetworkConfig.id}`);
      logger.info(`Setting quest duration for biome ${biome} difficulty ${difficulty} to ${duration}s on contract: ${contractAddress}`);

      const providers = await initializeBatcherProviders(DEFAULT_BATCHER_URL);
      providers.privateStateProvider.setContractAddress(contractAddress);
      const api = await Game2API.join(providers, contractAddress, logger);

      await api.admin_set_quest_duration(level, duration);
      logger.info(`Quest duration set to ${duration} seconds for biome ${biome} difficulty ${difficulty}`);
    } catch (error) {
      logger.error(`Failed to set quest duration: ${error}`);
      process.exit(1);
    }
  });

program
  .command('info')
  .description('Show deployment information')
  .action(async () => {
    try {
      const data = readMidnightContract("contract-game2", {
        baseDir: here,
        networkId: midnightNetworkConfig.id,
      });

      if (!data.contractAddress) {
        logger.info(`No deployment found for network: ${midnightNetworkConfig.id}`);
        logger.info('Run deploy script to deploy a new contract.');
        return;
      }

      logger.info('Current deployment:');
      logger.info(`  Network: ${midnightNetworkConfig.id}`);
      logger.info(`  Contract Address: ${data.contractAddress}`);
      logger.info(`  Indexer: ${midnightNetworkConfig.indexer}`);
      logger.info(`  Node: ${midnightNetworkConfig.node}`);
      logger.info(`  Proof Server: ${midnightNetworkConfig.proofServer}`);
    } catch (error) {
      logger.info(`No deployment found for network: ${midnightNetworkConfig.id}`);
      logger.info('Run deploy script to deploy a new contract.');
    }
  });

program.parse();
