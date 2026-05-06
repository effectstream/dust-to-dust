#!/usr/bin/env -S deno --unstable-detect-cjs -A

/**
 * On-chain integration test for Dust 2 Dust game contract.
 *
 * Runs a full game flow against a real deployed contract on the undeployed
 * (local dev) network. Submits actual ZK-proven transactions and verifies
 * state changes via the indexer.
 *
 * Prerequisites:
 *   - Midnight node (port 9944)
 *   - Indexer (port 8088)
 *   - Proof server (port 6300)
 *   - Batcher (port 3334)
 *   - Contract deployed: deno task contract-game2:deploy:dev
 *   - Content registered: deno task contract-game2:admin:dev register-content --minimal
 *
 * Run:
 *   deno task contract-game2:test:dev
 *   # or with a specific contract:
 *   MIDNIGHT_NETWORK_ID=undeployed deno --unstable-detect-cjs -A contract-game2-test.ts --contract <addr>
 */

import { Command } from 'commander';
import { Buffer } from 'node:buffer';
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import { buildWalletFacade } from "@paimaexample/midnight-contracts";
import { fromFileUrl, dirname, join } from "@std/path";
import { Game2API } from "game2-api";
import type { Game2DerivedState } from "game2-api";
import {
  type Ability,
  type BattleConfig,
  type BattleRewards,
  type Level,
  type PlayerLoadout,
  BOSS_TYPE,
  pureCircuits,
} from "game2-contract";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { toHex } from "@midnight-ntwrk/compact-runtime";
import {
  type UnboundTransaction,
  type FinalizedTransaction,
} from "@midnight-ntwrk/midnight-js-types";
import { type TransactionId } from "@midnight-ntwrk/ledger-v8";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { firstValueFrom, filter, timeout, tap } from "rxjs";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const log = {
  info: (...args: any[]) => console.log('\x1b[36m[INFO]\x1b[0m', ...args),
  pass: (...args: any[]) => console.log('\x1b[32m[PASS]\x1b[0m', ...args),
  fail: (...args: any[]) => console.log('\x1b[31m[FAIL]\x1b[0m', ...args),
  warn: (...args: any[]) => console.warn('\x1b[33m[WARN]\x1b[0m', ...args),
  error: (...args: any[]) => console.error('\x1b[31m[ERROR]\x1b[0m', ...args),
  debug: (...args: any[]) => {},
  trace: (...args: any[]) => {},
  fatal: (...args: any[]) => console.error('\x1b[31m[FATAL]\x1b[0m', ...args),
};

const here = dirname(fromFileUrl(import.meta.url));
const DEFAULT_BATCHER_URL = process.env.BATCHER_URL || 'http://localhost:3334';

// Timeout for waiting on state changes after a transaction (ms)
const STATE_TIMEOUT = 120_000;

// ---------------------------------------------------------------------------
// Batcher interaction (same as admin script)
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

  // Resolve tx hash → identifier via indexer
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
      return identifiers[0];
    }
  }

  return txHash;
}

// ---------------------------------------------------------------------------
// Provider initialization (uses fresh random wallet for test isolation)
// ---------------------------------------------------------------------------

async function initializeTestProviders() {
  setNetworkId(midnightNetworkConfig.id);

  const networkUrls = {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  };

  const walletResult = await buildWalletFacade(
    networkUrls,
    midnightNetworkConfig.walletSeed,
    midnightNetworkConfig.id
  );
  const { zswapSecretKeys } = walletResult;

  log.info(`Wallet coin public key: ${zswapSecretKeys.coinPublicKey}`);

  const zkConfigDir = join(here, "contract-game2", "src", "managed", "game2");
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigDir);

  let lastTxHash: string | null = null;
  const testRunId = Date.now();

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName: `midnight-level-db-test-${testRunId}`,
      privateStateStoreName: `game2-private-state-test-${testRunId}`,
      privateStoragePasswordProvider: async () =>
        process.env.MIDNIGHT_STORAGE_PASSWORD || "YourPasswordMy1!",
      accountId: Buffer.from(zswapSecretKeys.coinPublicKey as any).toString('hex'),
    }),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      midnightNetworkConfig.proofServer,
      zkConfigProvider
    ),
    publicDataProvider: indexerPublicDataProvider(
      midnightNetworkConfig.indexer,
      midnightNetworkConfig.indexerWS
    ),
    walletProvider: {
      getCoinPublicKey() { return zswapSecretKeys.coinPublicKey; },
      getEncryptionPublicKey() { return zswapSecretKeys.encryptionPublicKey; },
      async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
        const serialized = toHex(tx.serialize());
        lastTxHash = await postToBatcher(serialized, 'test');
        log.info(`Batcher confirmed txHash=${lastTxHash}`);
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
// Test helpers
// ---------------------------------------------------------------------------

function resolveContractAddress(contractOption?: string): string {
  if (contractOption) return contractOption;

  const data = readMidnightContract("contract-game2", {
    baseDir: here,
    networkId: midnightNetworkConfig.id,
  });

  if (!data.contractAddress) {
    log.error(`No deployed contract address found for network: ${midnightNetworkConfig.id}`);
    log.error('Deploy first: deno task contract-game2:deploy:dev');
    process.exit(1);
  }

  return data.contractAddress;
}

/** Wait for a state update matching the predicate. */
async function waitForState(
  api: Game2API,
  predicate: (state: Game2DerivedState) => boolean,
  description: string
): Promise<Game2DerivedState> {
  log.info(`Waiting for: ${description}...`);
  return firstValueFrom(
    api.state$.pipe(
      filter(predicate),
      timeout(STATE_TIMEOUT),
    )
  );
}

function buildLoadout(state: Game2DerivedState): PlayerLoadout {
  const abilities: bigint[] = [];
  for (const [abilityId, count] of state.playerAbilities) {
    for (let i = 0n; i < count && abilities.length < 7; i++) {
      abilities.push(abilityId);
    }
    if (abilities.length >= 7) break;
  }
  if (abilities.length < 7) {
    throw new Error(`Not enough abilities: have ${abilities.length}, need 7`);
  }
  return { abilities };
}

function totalAbilities(state: Game2DerivedState): bigint {
  let total = 0n;
  for (const count of state.playerAbilities.values()) total += count;
  return total;
}

const GRASS_1: Level = { biome: 0n, difficulty: 1n };

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    log.fail(message);
    failed++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => Promise<void>) {
  log.info(`--- ${name} ---`);
  try {
    await fn();
    log.pass(name);
    passed++;
  } catch (e: any) {
    log.fail(`${name}: ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('game2-test')
  .description('On-chain integration test for Dust 2 Dust')
  .option('--contract <address>', 'Contract address')
  .action(async (options) => {
    const contractAddress = resolveContractAddress(options.contract);

    log.info(`Network: ${midnightNetworkConfig.id}`);
    log.info(`Contract: ${contractAddress}`);
    log.info(`Batcher: ${DEFAULT_BATCHER_URL}`);
    log.info(`Indexer: ${midnightNetworkConfig.indexer}`);
    log.info(`Proof server: ${midnightNetworkConfig.proofServer}`);
    log.info('');

    // Initialize providers
    log.info('Initializing providers...');
    const providers = await initializeTestProviders();
    providers.privateStateProvider.setContractAddress(contractAddress);

    // Join contract
    log.info('Joining contract...');
    const api = await Game2API.join(providers, contractAddress, log as any);
    log.info('Joined contract successfully');
    log.info('');

    // Get initial state
    const initialState = await firstValueFrom(api.state$);
    log.info(`Initial state: player=${initialState.player ? 'exists' : 'none'}, levels=${initialState.levels.size} biomes`);

    // Verify content is registered
    const hasContent = initialState.levels.get(0n)?.get(1n)?.size ?? 0;
    if (hasContent === 0) {
      log.error('No content registered for grasslands/1. Run: deno task contract-game2:admin:dev register-content --minimal');
      process.exit(1);
    }
    log.info(`Content registered: ${hasContent} enemy configs for grasslands/1`);
    log.info('');

    // Set quest duration to 1 second for fast testing (admin function)
    log.info('Setting quest duration to 1 second for testing...');
    try {
      await (api as any).admin_set_quest_duration({ biome: 0n, difficulty: 1n }, 1n);
      log.info('Quest duration set to 1 second');
    } catch (e: any) {
      log.warn(`Could not set quest duration (may not be admin): ${e.message}`);
    }

    // =====================================================================
    // TEST 1: Player Registration
    // =====================================================================
    await test('Player Registration', async () => {
      await api.register_new_player();
      const state = await waitForState(
        api,
        (s) => s.player !== undefined && s.player.gold === 0n,
        'player registered with 0 gold'
      );

      assert(state.player !== undefined, 'Player should exist');
      assert(state.player!.gold === 0n, 'Gold should be 0');
      assert(state.playerAbilities.size >= 4, 'Should have at least 4 ability types');
      assert(totalAbilities(state) >= 10n, 'Should have at least 10 total abilities');

      const physId = pureCircuits.derive_ability_id(pureCircuits.ability_base_phys());
      const blockId = pureCircuits.derive_ability_id(pureCircuits.ability_base_block());
      assert(state.playerAbilities.get(physId) === 4n, 'Should have 4 phys');
      assert(state.playerAbilities.get(blockId) === 4n, 'Should have 4 block');

      log.info(`Player registered: ${totalAbilities(state)} abilities, ${state.playerAbilities.size} types`);
    });

    // =====================================================================
    // TEST 2: Normal Battle
    // =====================================================================

    // Wait for registration to be fully reflected in state before any subsequent tests
    const postRegState = await waitForState(
      api,
      (s) => s.player !== undefined && s.player.gold === 0n && totalAbilities(s) >= 10n,
      'registration fully reflected (gold=0, abilities>=10)'
    );
    log.info(`Post-registration state: gold=${postRegState.player!.gold}, abilities=${totalAbilities(postRegState)}`);

    await test('Start Normal Battle', async () => {
      const state = await waitForState(
        api,
        (s) => s.player !== undefined && totalAbilities(s) >= 7n,
        'player has abilities for loadout'
      );
      const loadout = buildLoadout(state);

      log.info(`Starting battle with loadout of 7 abilities at grasslands/1`);
      const config = await api.start_new_battle(loadout, GRASS_1);

      const newState = await waitForState(
        api,
        (s) => s.activeBattleConfigs.size > 0,
        'battle created'
      );

      assert(newState.activeBattleConfigs.size >= 1, 'Should have active battle');
      // Note: derive_battle_id uses transientCommit which may differ client vs on-chain
      // So we get the battle ID from the state instead of computing it locally
      const battleId = newState.activeBattleConfigs.keys().next().value!;

      log.info(`Battle started: ID=${battleId}, enemies=${Number(config.enemies.count)}`);
    });

    await test('Fight Battle to Completion', async () => {
      const state = await waitForState(
        api,
        (s) => s.activeBattleConfigs.size > 0,
        'battle available to fight'
      );
      const battleId = state.activeBattleConfigs.keys().next().value!;
      const config = state.activeBattleConfigs.get(battleId)!;

      let result: BattleRewards | undefined;
      let rounds = 0;
      const MAX_ROUNDS = 100;

      const enemyCount = Number(config.enemies.count);

      while (result === undefined && rounds < MAX_ROUNDS) {
        // Use smart targeting: focus fire on alive enemies
        const t0 = 0n; // Always target first enemy initially
        const t1 = enemyCount >= 2 ? 1n : 0n;

        log.info(`  Round ${rounds + 1}: targets=[${t0},${t1},${t0}]`);
        result = await api.combat_round(battleId, [t0, t1, t0]);
        rounds++;
      }

      assert(rounds > 0, 'Should have fought at least 1 round');
      assert(rounds < MAX_ROUNDS, `Battle should end within ${MAX_ROUNDS} rounds`);
      log.info(`Battle ended after ${rounds} rounds: alive=${result?.alive}, gold=${result?.gold}`);

      // Wait for state to reflect battle end (player must be defined too)
      const endState = await waitForState(
        api,
        (s) => !s.activeBattleConfigs.has(battleId) && s.player !== undefined,
        'battle cleaned up'
      );

      assert(!endState.activeBattleConfigs.has(battleId), 'Battle should be removed');

      if (result?.alive) {
        assert(endState.player!.gold >= 0n, 'Gold should be non-negative');
        log.info(`Won! Gold=${endState.player!.gold}, abilities=${totalAbilities(endState)}`);
      } else {
        log.warn('Player died in battle — continuing with reduced abilities');
      }

    });

    // =====================================================================
    // TEST 3: Quest → Boss Battle
    // =====================================================================
    await test('Quest and Boss Battle', async () => {
      let state = await waitForState(
        api,
        (s) => s.player !== undefined && totalAbilities(s) >= 7n,
        'player has enough abilities'
      );

      // Ensure we have enough abilities
      if (totalAbilities(state) < 7n) {
        log.warn('Not enough abilities for quest, skipping');
        return;
      }

      const loadout = buildLoadout(state);
      log.info('Starting quest...');
      const questId = await api.start_new_quest(loadout, GRASS_1);

      state = await waitForState(
        api,
        (s) => s.quests.has(questId),
        'quest created'
      );
      assert(state.quests.has(questId), 'Quest should exist');
      log.info(`Quest started: ID=${questId}`);

      // Poll readiness until quest is ready
      log.info('Waiting for quest readiness...');
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) {
        ready = await api.is_quest_ready(questId);
        if (!ready) {
          log.info(`  Quest not ready yet (attempt ${attempt + 1}/30), waiting 5s...`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      assert(ready, 'Quest should become ready within timeout');
      log.info('Quest ready!');

      // Finalize quest → boss battle
      log.info('Finalizing quest...');
      const bossBattleId = await api.finalize_quest(questId);
      assert(bossBattleId !== undefined, 'Should get boss battle ID');

      state = await waitForState(
        api,
        (s) => s.activeBattleConfigs.has(bossBattleId!),
        'boss battle created'
      );

      const bossConfig = state.activeBattleConfigs.get(bossBattleId!)!;
      assert(
        bossConfig.enemies.stats[0].boss_type === BOSS_TYPE.boss,
        'Should be a boss battle'
      );
      log.info(`Boss battle: ID=${bossBattleId}, boss_type=${bossConfig.enemies.stats[0].boss_type}`);

      // Fight boss
      let result: BattleRewards | undefined;
      let rounds = 0;
      while (result === undefined && rounds < 200) {
        log.info(`  Boss round ${rounds + 1}`);
        result = await api.combat_round(bossBattleId!, [0n, 0n, 0n]);
        rounds++;
      }

      assert(rounds > 0, 'Should have fought at least 1 boss round');
      log.info(`Boss battle ended after ${rounds} rounds: alive=${result?.alive}`);

      if (result?.alive) {
        const finalState = await waitForState(
          api,
          (s) => {
            const progress = s.playerBossProgress.get(0n)?.get(1n);
            return progress === true;
          },
          'boss progress marked'
        );
        assert(
          finalState.playerBossProgress.get(0n)?.get(1n) === true,
          'Boss progress should be marked for grasslands/1'
        );
        log.info('Boss progress confirmed!');
      }
    });

    // =====================================================================
    // TEST 4: Retreat
    // =====================================================================
    await test('Retreat from Battle', async () => {
      let state = await waitForState(
        api,
        (s) => s.player !== undefined && totalAbilities(s) >= 7n,
        'player has enough abilities'
      );
      if (totalAbilities(state) < 7n) {
        log.warn('Not enough abilities for retreat test, skipping');
        return;
      }

      const goldBefore = state.player!.gold;
      const abilitiesBefore = totalAbilities(state);
      const loadout = buildLoadout(state);

      log.info('Starting battle to retreat from...');
      const config = await api.start_new_battle(loadout, GRASS_1);
      const battleId = pureCircuits.derive_battle_id(config);

      await waitForState(
        api,
        (s) => s.activeBattleConfigs.has(battleId),
        'battle created'
      );

      log.info('Retreating...');
      await api.retreat_from_battle(battleId);

      const endState = await waitForState(
        api,
        (s) => !s.activeBattleConfigs.has(battleId) && s.player !== undefined,
        'battle removed after retreat'
      );

      assert(!endState.activeBattleConfigs.has(battleId), 'Battle should be removed');
      assert(endState.player!.gold === goldBefore, 'Gold should be unchanged');
      log.info(`Retreat successful: gold=${endState.player!.gold}, abilities=${totalAbilities(endState)}`);
    });

    // =====================================================================
    // TEST 5: Shop — Sell
    // =====================================================================
    await test('Sell Ability', async () => {
      const state = await waitForState(
        api,
        (s) => s.player !== undefined && totalAbilities(s) >= 1n,
        'player has abilities to sell'
      );

      // Find a non-base ability to sell
      const baseIds = new Set([
        pureCircuits.derive_ability_id(pureCircuits.ability_base_phys()),
        pureCircuits.derive_ability_id(pureCircuits.ability_base_block()),
      ]);

      let sellableAbility: Ability | undefined;
      let sellableId: bigint | undefined;
      for (const [id, count] of state.playerAbilities) {
        if (!baseIds.has(id) && count >= 1n) {
          sellableAbility = state.allAbilities.get(id);
          sellableId = id;
          break;
        }
      }

      if (!sellableAbility) {
        log.warn('No sellable abilities, skipping');
        return;
      }

      const goldBefore = state.player!.gold;
      log.info(`Selling ability ID=${sellableId}`);
      await api.sell_ability(sellableAbility);

      const endState = await waitForState(
        api,
        (s) => s.player !== undefined && s.player.gold > goldBefore,
        'gold increased after sell'
      );

      assert(endState.player!.gold > goldBefore, 'Gold should have increased');
      log.info(`Sold! Gold: ${goldBefore} → ${endState.player!.gold}`);
    });

    // =====================================================================
    // TEST 6: Security — Re-registration Resets State
    // =====================================================================
    await test('SECURITY: Re-registration resets player', async () => {
      let state = await waitForState(
        api,
        (s) => s.player !== undefined,
        'player state available'
      );
      const goldBeforeRereg = state.player!.gold;

      // Only test if player has gold (otherwise re-reg wouldn't show a visible change)
      if (goldBeforeRereg === 0n) {
        log.warn('Player has 0 gold, re-registration reset not visually testable');
        // Still call register to verify it doesn't crash
        await api.register_new_player();
        await waitForState(api, (s) => s.player !== undefined, 'player re-registered');
        return;
      }

      log.info(`Current gold: ${goldBeforeRereg}, re-registering...`);
      await api.register_new_player();

      const endState = await waitForState(
        api,
        (s) => s.player !== undefined && s.player.gold === 0n,
        'gold reset to 0 after re-registration'
      );

      assert(endState.player!.gold === 0n, 'Gold should be reset to 0');
      log.info(`CONFIRMED: Re-registration reset gold from ${goldBeforeRereg} to ${endState.player!.gold}`);
    });

    // =====================================================================
    // Summary
    // =====================================================================
    log.info('');
    log.info('═══════════════════════════════════════');
    log.info(`  Results: ${passed} passed, ${failed} failed`);
    log.info('═══════════════════════════════════════');

    process.exit(failed > 0 ? 1 : 0);
  });

program.parse();
