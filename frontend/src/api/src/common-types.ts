/**
 * Game common types and abstractions.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { Game2PrivateState, Contract, Witnesses, BattleState, BattleConfig, Level, EnemiesConfig, Player, QuestConfig, Ability } from 'game2-contract';

/**
 * The private states consumed throughout the application.
 *
 * @remarks
 * {@link PrivateStates} can be thought of as a type that describes a schema for all
 * private states for all contracts used in the application. Each key represents
 * the type of private state consumed by a particular type of contract.
 * The key is used by the deployed contract when interacting with a private state provider,
 * and the type (i.e., `typeof PrivateStates[K]`) represents the type of private state
 * expected to be returned.
 *
 * @public
 */
export type PrivateStates = {
  /**
   * Key used to provide the private state for {@link Game2Contract} deployments.
   */
  readonly game2PrivateState: Game2PrivateState;
};

/**
 * Represents a Game2 contract and its private state.
 *
 * @public
 */
export type Game2Contract = Contract<Game2PrivateState, Witnesses<Game2PrivateState>>;

/**
 * The keys of the circuits exported from {@link Game2Contract}.
 *
 * @public
 */
export type Game2CircuitKeys = Exclude<keyof Game2Contract['provableCircuits'], number | symbol>;

/**
 * The providers required by {@link Game2Contract}.
 *
 * @public
 */
export type Game2Providers = MidnightProviders<Game2CircuitKeys, 'game2PrivateState', Game2PrivateState>;

/**
 * A {@link Game2Contract} that has been deployed to the network.
 *
 * @public
 */
export type DeployedGame2Contract = FoundContract<Game2Contract>;

/**
 * A type that represents the derived combination of public (or ledger), and private state.
 */
export type Game2DerivedState = {
  activeBattleStates: Map<bigint, BattleState>;
  activeBattleConfigs: Map<bigint, BattleConfig>;
  quests: Map<bigint, QuestConfig>;
  player?: Player;
  playerId?: bigint;
  playerAbilities: Map<bigint, bigint>;
  allAbilities: Map<bigint, Ability>;
  // biome -> difficulty -> index
  levels: Map<bigint, Map<bigint, Map<bigint, EnemiesConfig>>>;
  // biome -> difficulty
  bosses: Map<bigint, Map<bigint, EnemiesConfig>>;
  // biome -> difficulty -> boolean (true if boss completed)
  playerBossProgress: Map<bigint, Map<bigint, boolean>>;
  // quest durations in seconds per level: biome -> difficulty -> seconds (missing means default 1200)
  questDurations: Map<bigint, Map<bigint, bigint>>;
  /** Current player's delegated wallet shielded address (64 raw bytes: coin_pk || enc_pk), or null if not delegated. */
  myDelegatedAddress: Uint8Array | null;
}
