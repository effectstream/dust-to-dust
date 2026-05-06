/**
 * Provides types and utilities for working with deployed (on-chain) Game2 contracts
 *
 * @packageDocumentation
 */
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { type Logger } from 'pino';
import type { Game2DerivedState, Game2Providers, DeployedGame2Contract } from './common-types.js';
import { type Game2PrivateState, Ability, Level, PlayerLoadout, BattleConfig, BattleRewards, EnemiesConfig } from 'game2-contract';
import { type Observable } from 'rxjs';
import { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
export declare function safeJSONString(obj: object): string;
/**
 * Game2's Contract API. Corresponds directly to the exported circuits.
 */
export interface DeployedGame2API {
    readonly deployedContractAddress: ContractAddress;
    readonly state$: Observable<Game2DerivedState>;
    /**
     * Register a new player and give them the default abilities.
     * Populates all ledger states indexed by the player ID
     * Uses the player_secret_key() witness as the player ID
     */
    register_new_player: () => Promise<void>;
    /**
     * Start a new active battle
     * @param loadout Abilities used in this battle. They will be (temporarily) removed until battle end.
     * @param level The level (biome / difficulty) to start the battle in
     * @returns The config corresponding to the created battle.
     */
    start_new_battle: (loadout: PlayerLoadout, level: Level) => Promise<BattleConfig>;
    /**
     * Run a combat round of an already existing active battle
     * @param battle_id Battle to attempt a combat round of
     * @param ability_targets Enemy targets for each ability
     * @returns Rewards if battle is complete (win or lose), or undefined if not
     */
    combat_round: (battle_id: bigint, ability_targets: [bigint, bigint, bigint]) => Promise<BattleRewards | undefined>;
    /**
     * Retreat from an active battle without penalty
     * Returns the loadout to the player and removes the battle from active battles
     * @param battle_id Battle to retreat from
     */
    retreat_from_battle: (battle_id: bigint) => Promise<void>;
    /**
     * Start a new quest
     *
     * @param loadout Abilities used in this quest. They will be (temporarily) removed until battle end.
     * @param level The level (biome / difficulty) to start the quest in
     * @returns The quest ID of the new quest
     */
    start_new_quest: (loadout: PlayerLoadout, level: Level) => Promise<bigint>;
    /**
     * Check if a quest is ready to be finalized (without actually finalizing it)
     *
     * @param quest_id Quest to check readiness for
     * @returns True if quest is ready to be finalized, false otherwise
     */
    is_quest_ready: (quest_id: bigint) => Promise<boolean>;
    /**
     * Attempt to finalize a quest (enter into the boss battle)
     *
     * @param quest_id Quest to try to end
     * @returns The battle ID of the resulting boss battle, or none if quest not ready yet
     */
    finalize_quest: (quest_id: bigint) => Promise<bigint | undefined>;
    /**
     * Sell an ability
     *
     * @param ability The ability to sell. You must own at least 1
     */
    sell_ability: (ability: Ability) => Promise<void>;
    /**
     * Upgrade an ability, sacrificing the second one.
     *
     * @param ability The ability to upgrade
     * @param sacrifice The ability to sacrifice. Must have score >= the upgraded ability
     * @returns ability id of the upgraded ability
     */
    upgrade_ability: (ability: Ability, sacrifice: Ability) => Promise<bigint>;
    admin_level_new: (level: Level, boss: EnemiesConfig) => Promise<void>;
    admin_level_add_config: (level: Level, enemies: EnemiesConfig) => Promise<void>;
    admin_set_quest_duration: (level: Level, duration: bigint) => Promise<void>;
}
/**
 * Provides an implementation of {@link DeployedGame2API} that interacts with the provided prover and submits transactions on-chain
 */
export declare class Game2API implements DeployedGame2API {
    readonly deployedContract: DeployedGame2Contract;
    private readonly providers;
    private readonly logger?;
    /** @internal */
    private constructor();
    /**
     * Gets the address of the current deployed contract.
     */
    readonly deployedContractAddress: ContractAddress;
    /**
     * Gets an observable stream of state changes based on the current public (ledger),
     * and private state data.
     */
    readonly state$: Observable<Game2DerivedState>;
    register_new_player(): Promise<void>;
    start_new_battle(loadout: PlayerLoadout, level: Level): Promise<BattleConfig>;
    combat_round(battle_id: bigint, ability_targets: [bigint, bigint, bigint]): Promise<BattleRewards | undefined>;
    retreat_from_battle(battle_id: bigint): Promise<void>;
    start_new_quest(loadout: PlayerLoadout, level: Level): Promise<bigint>;
    is_quest_ready(quest_id: bigint): Promise<boolean>;
    finalize_quest(quest_id: bigint): Promise<bigint | undefined>;
    sell_ability(ability: Ability): Promise<void>;
    upgrade_ability(ability: Ability, sacrifice: Ability): Promise<bigint>;
    admin_level_new(level: Level, boss: EnemiesConfig): Promise<void>;
    admin_level_add_config(level: Level, enemies: EnemiesConfig): Promise<void>;
    admin_set_quest_duration(level: Level, duration: bigint): Promise<void>;
    /**
     * Deploys a new Game2 contract to the network.
     *
     * @param providers The game's providers.
     * @param logger An optional 'pino' logger to use for logging.
     * @returns A `Promise` that resolves with a {@link Game2API} instance that manages the newly deployed
     * {@link DeployedGame2Contract}; or rejects with a deployment error.
     */
    static deploy(providers: Game2Providers, logger?: Logger): Promise<Game2API>;
    /**
     * Finds an already deployed Game2 contract on the network, and joins it.
     *
     * @param providers The game's providers.
     * @param contractAddress The contract address of the deployed gamecontract to search for and join.
     * @param logger An optional 'pino' logger to use for logging.
     * @returns A `Promise` that resolves with a {@link Game2API} instance that manages the joined
     * {@link DeployedGame2Contract}; or rejects with an error.
     */
    static join(providers: Game2Providers, contractAddress: ContractAddress, logger?: Logger): Promise<Game2API>;
    static getPrivateState(privateStateProvider: PrivateStateProvider): Promise<Game2PrivateState>;
}
/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';
export * from './common-types.js';
