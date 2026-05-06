/**
 * Provides types and utilities for working with deployed (on-chain) Game2 contracts
 *
 * @packageDocumentation
 */

import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { type Logger } from 'pino';
import type { Game2DerivedState, Game2Contract, Game2Providers, DeployedGame2Contract, PrivateStates } from './common-types.js';
import {
    type Game2PrivateState,
    Contract,
    createGame2PrivateState,
    ledger,
    pureCircuits,
    witnesses,
    Ability,
    Level,
    PlayerLoadout,
    BattleConfig,
    BattleRewards,
    EnemiesConfig,
    LEVEL_COUNT_PER_BIOME,
    BIOME_COUNT,
  // Command,
} from 'game2-contract';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, firstValueFrom, type Observable, shareReplay } from 'rxjs';
import { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

/** @internal */
const compiledGame2Contract = CompiledContract.make<Game2Contract>(
    'Game2',
    Contract,
).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets('./managed/game2'),
);

// only converts bigint, but this is the only problem we have with printing ledger types
export function safeJSONString(obj: object): string {
    if (typeof obj == 'bigint') {
        return Number(obj).toString();
    } else if (Array.isArray(obj)) {
        let str = '[';
        let innerFirst = true;
        for (let i = 0; i < obj.length; ++i) {
            if (!innerFirst) {
                str += ', ';
            }
            innerFirst = false;
            str += safeJSONString(obj[i]);
        }
        str += ']';
        return str;
    } else if (obj == null) {
        return 'null';
    } else if (typeof obj == 'object') {
        let entries = Object.entries(obj);
        // this allows us to print Map properly
        let len = ('length' in obj ? obj.length : undefined) ?? ('size' in obj ? obj.size : undefined) ?? entries.length;;
        if ('entries' in obj && typeof obj.entries === "function") {
            entries = obj.entries();
        }
        let str = `[${len}]{`;
        let first = true;
        for (let [key, val] of entries) {
            if (!first) {
                str += ', ';
            }
            first = false;
            str += `"${key}": ${safeJSONString(val)}`;
        }
        str += '}';
        return str;
    }
    return JSON.stringify(obj);
}

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

    // TODO: add an admin-only API or not?
    admin_level_new: (level: Level, boss: EnemiesConfig) => Promise<void>;

    admin_level_add_config: (level: Level, enemies: EnemiesConfig) => Promise<void>;

    admin_set_quest_duration: (level: Level, duration: bigint) => Promise<void>;

    /**
     * Register a delegation from the caller's game public key to their real wallet shielded address.
     * @param walletAddress The raw 64-byte shielded address (coin_pub_key || enc_pub_key).
     */
    registerDelegation: (walletAddress: Uint8Array) => Promise<void>;
}

/**
 * Provides an implementation of {@link DeployedGame2API} that interacts with the provided prover and submits transactions on-chain
 */
export class Game2API implements DeployedGame2API {
    /** @internal */
    private constructor(
        public readonly deployedContract: DeployedGame2Contract,
        private readonly providers: Game2Providers,
        private readonly logger?: Logger,
    ) {
        this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
        this.state$ = combineLatest(
            [
                // Combine public (ledger) state with...
                providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
                  map((contractState) => ledger(contractState.data)),
                  tap((ledgerState) =>
                    logger?.debug({
                      ledgerStateChanged: {
                        ledgerState: {
                          ...ledgerState,
                          // state: ledgerState.state === STATE.occupied ? 'occupied' : 'vacant',
                          // poster: toHex(ledgerState.poster),
                        },
                      },
                    }),
                  ),
                ),
                // TODO: update this comment since this does change but we worked around it in pvp-arena
                // ...private state...
                //    since the private state of the bulletin board application never changes, we can query the
                //    private state once and always use the same value with `combineLatest`. In applications
                //    where the private state is expected to change, we would need to make this an `Observable`.
                from(providers.privateStateProvider.get('game2PrivateState') as Promise<Game2PrivateState>),
            ],
            // ...and combine them to produce the required derived state.
            (ledgerState, privateState) => {
                const playerId = pureCircuits.derive_player_pub_key(privateState.secretKey);
                // we can't index by Level directly so we map by biome then difficulty and add an extra map (for both levels + bosses)
                // levels
                const extractLevelsFromLedgerState = () => {
                    const levelsByBiomes = new Map();
                    // TODO: for some reason ledgerState.levels has no [Symbol.iterator]() and thus can't be converted or iterated
                    // so we're just going to manually index by biome id... we should have a better way to do this!
                    const iteratingLevels: [bigint, bigint, any][] = [];
                    for (let biome = 0; biome < BIOME_COUNT; ++biome) {
                        for (let difficulty = 1; difficulty <= LEVEL_COUNT_PER_BIOME; ++difficulty) {
                            const level = { biome: BigInt(biome), difficulty: BigInt(difficulty) };
                            if (ledgerState.levels.member(level)) {
                                iteratingLevels.push([level.biome, level.difficulty, ledgerState.levels.lookup(level)]);
                            }
                        }
                    }
                    for (let [biome, difficulty, configs] of iteratingLevels) {
                        let byBiome = levelsByBiomes.get(biome);
                        if (byBiome == undefined) {
                            byBiome = new Map();
                            levelsByBiomes.set(biome, byBiome);
                        }
                        let byDifficulty = byBiome.get(difficulty);
                        if (byDifficulty == undefined) {
                            byDifficulty = new Map();
                            byBiome.set(difficulty, byDifficulty)
                        }
                        for (let [index, config] of configs) {
                            byDifficulty.set(index, config);
                        }
                    }
                    return levelsByBiomes;
                };
                // bosses
                const extractBossesFromLedgerState = () => {
                    const bossesByBiomes = new Map();
                    for (let [level, boss] of ledgerState.bosses) {
                        let byBiome = bossesByBiomes.get(level.biome);
                        if (byBiome == undefined) {
                            byBiome = new Map();
                            bossesByBiomes.set(level.biome, byBiome);
                        }
                        byBiome.set(level.difficulty, boss);
                    }
                    return bossesByBiomes;
                };
                // player boss progress
                const extractPlayerBossProgressFromLedgerState = () => {
                    const progressByBiomes = new Map();
                    if (ledgerState.player_boss_progress.member(playerId)) {
                        const playerProgress = ledgerState.player_boss_progress.lookup(playerId);
                        // Manually iterate through known biomes (similar to levels extraction)
                        for (let biome = 0; biome < BIOME_COUNT; ++biome) {
                            if (playerProgress.member(BigInt(biome))) {
                                const biomeProgress = playerProgress.lookup(BigInt(biome));
                                let byBiome = new Map();
                                for (let difficulty = 1; difficulty <= LEVEL_COUNT_PER_BIOME; ++difficulty) {
                                    if (biomeProgress.member(BigInt(difficulty))) {
                                        byBiome.set(BigInt(difficulty), biomeProgress.lookup(BigInt(difficulty)));
                                    }
                                }
                                if (byBiome.size > 0) {
                                    progressByBiomes.set(BigInt(biome), byBiome);
                                }
                            }
                        }
                    }
                    return progressByBiomes;
                };
                // quest durations (biome -> difficulty -> seconds)
                const extractQuestDurationsFromLedgerState = () => {
                    const durationsByBiomes = new Map<bigint, Map<bigint, bigint>>();
                    for (let [level, duration] of ledgerState.quest_durations) {
                        let byBiome = durationsByBiomes.get(level.biome);
                        if (byBiome == undefined) {
                            byBiome = new Map();
                            durationsByBiomes.set(level.biome, byBiome);
                        }
                        byBiome.set(level.difficulty, duration);
                    }
                    return durationsByBiomes;
                };
                // Resolve delegation for this player (64-byte raw shielded address)
                const ledgerAny = ledgerState as any;
                const myDelegatedAddress: Uint8Array | null =
                    playerId !== null && ledgerAny.delegations?.member(playerId)
                        ? ledgerAny.delegations.lookup(playerId).data
                        : null;

                // Filter battles and quests to only include those belonging to the current player
                const myBattleConfigs = new Map(
                    [...ledgerState.active_battle_configs].filter(([, config]) => config.player_pub_key === playerId)
                );
                const myBattleIds = new Set(myBattleConfigs.keys());
                const myBattleStates = new Map(
                    [...ledgerState.active_battle_states].filter(([id]) => myBattleIds.has(id))
                );
                const myQuests = new Map(
                    [...ledgerState.quests].filter(([, quest]) => quest.player_pub_key === playerId)
                );

                const newState: Game2DerivedState = {
                    activeBattleConfigs: myBattleConfigs,
                    activeBattleStates: myBattleStates,
                    quests: myQuests,
                    player: ledgerState.players.member(playerId) ? ledgerState.players.lookup(playerId) : undefined,
                    playerId: playerId,
                    playerAbilities: new Map(ledgerState.player_abilities.member(playerId) ? ledgerState.player_abilities.lookup(playerId) : []),
                    allAbilities: new Map(ledgerState.all_abilities),
                    levels: extractLevelsFromLedgerState(),
                    bosses: extractBossesFromLedgerState(),
                    playerBossProgress: extractPlayerBossProgressFromLedgerState(),
                    questDurations: extractQuestDurationsFromLedgerState(),
                    myDelegatedAddress,
                };
                return newState;
            },
        ).pipe(
            // Share the subscription among all subscribers to prevent hammering the indexer
            // with 14+ concurrent GraphQL subscriptions (one per scene)
            shareReplay({ bufferSize: 1, refCount: true })
        );
    }

    /**
     * Gets the address of the current deployed contract.
     */
    readonly deployedContractAddress: ContractAddress;

    /**
     * Gets an observable stream of state changes based on the current public (ledger),
     * and private state data.
     */
    readonly state$: Observable<Game2DerivedState>;
   
    async register_new_player(): Promise<void> {
        const txData = await this.deployedContract.callTx.register_new_player();

        this.logger?.trace({
            transactionAdded: {
                circuit: 'register_new_player',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }

    async start_new_battle(loadout: PlayerLoadout, level: Level): Promise<BattleConfig> {
        const txData = await this.deployedContract.callTx.start_new_battle(loadout, level);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'start_new_battle',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });

        return txData.private.result;
    }
    async combat_round(battle_id: bigint, ability_targets: [bigint, bigint, bigint]): Promise<BattleRewards | undefined> {
        const txData = await this.deployedContract.callTx.combat_round(battle_id, ability_targets);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'combat_round',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });

        return txData.private.result.is_some ? txData.private.result.value : undefined;
    }

    async retreat_from_battle(battle_id: bigint): Promise<void> {
        const txData = await this.deployedContract.callTx.retreat_from_battle(battle_id);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'retreat_from_battle',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }

    async start_new_quest(loadout: PlayerLoadout, level: Level): Promise<bigint> {
        const startTime = BigInt(Math.floor(Date.now() / 1000));
        const txData = await this.deployedContract.callTx.start_new_quest(loadout, level, startTime);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'start_new_quest',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });

        return txData.private.result;
    }

    async is_quest_ready(quest_id: bigint): Promise<boolean> {
        const state = await firstValueFrom(this.state$);
        const quest = state.quests.get(quest_id);
        if (!quest) return false;
        const duration = state.questDurations.get(quest.level.biome)?.get(quest.level.difficulty) ?? 1200n;
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        return nowSec >= quest.start_time + (duration > 0n ? duration : 1200n);
    }

    async finalize_quest(quest_id: bigint): Promise<bigint | undefined> {
        const txData = await this.deployedContract.callTx.finalize_quest(quest_id);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'finalize_quest',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });

        return txData.private.result.is_some ? txData.private.result.value : undefined;
    }

    async sell_ability(ability: Ability): Promise<void> {
        const txData = await this.deployedContract.callTx.sell_ability(ability);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'sell_ability',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }

    async upgrade_ability(ability: Ability, sacrifice: Ability): Promise<bigint> {
        const txData = await this.deployedContract.callTx.upgrade_ability(ability, sacrifice);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'upgrade_ability',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });

        return txData.private.result;
    }

    async admin_level_new(level: Level, boss: EnemiesConfig): Promise<void> {
        const txData = await this.deployedContract.callTx.admin_level_new(level, boss);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'admin_level_new',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }

    async admin_level_add_config(level: Level, enemies: EnemiesConfig): Promise<void> {
        const txData = await this.deployedContract.callTx.admin_level_add_config(level, enemies);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'admin_level_add_config',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }

    async admin_set_quest_duration(level: Level, duration: bigint): Promise<void> {
        const txData = await this.deployedContract.callTx.admin_set_quest_duration(level, duration);

        this.logger?.trace({
            transactionAdded: {
                circuit: 'admin_set_quest_duration',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }

    async registerDelegation(walletAddress: Uint8Array): Promise<void> {
        if (walletAddress.length !== 64) {
            throw new Error(`registerDelegation: expected 64 bytes, got ${walletAddress.length}`);
        }
        this.logger?.info(`registerDelegation(len=${walletAddress.length})`);
        await (this.deployedContract.callTx as any).register_delegation(walletAddress);
        this.logger?.info('registerDelegation done');
    }

    /**
     * Deploys a new Game2 contract to the network.
     *
     * @param providers The game's providers.
     * @param logger An optional 'pino' logger to use for logging.
     * @returns A `Promise` that resolves with a {@link Game2API} instance that manages the newly deployed
     * {@link DeployedGame2Contract}; or rejects with a deployment error.
     */
    static async deploy(providers: Game2Providers, logger?: Logger): Promise<Game2API> {
        logger?.info('deployContract');

        const deployedGame2Contract = await deployContract(providers, {
            compiledContract: compiledGame2Contract,
            privateStateId: 'game2PrivateState',
            initialPrivateState: await Game2API.getPrivateState(providers.privateStateProvider),
        });
        logger?.trace({
            contractDeployed: {
                finalizedDeployTxData: deployedGame2Contract.deployTxData.public,
            },
        });

        return new Game2API(deployedGame2Contract, providers, logger);
    }

    /**
     * Finds an already deployed Game2 contract on the network, and joins it.
     *
     * @param providers The game's providers.
     * @param contractAddress The contract address of the deployed gamecontract to search for and join.
     * @param logger An optional 'pino' logger to use for logging.
     * @returns A `Promise` that resolves with a {@link Game2API} instance that manages the joined
     * {@link DeployedGame2Contract}; or rejects with an error.
     */
    static async join(providers: Game2Providers, contractAddress: ContractAddress, logger?: Logger): Promise<Game2API> {
        logger?.info({
            joinContract: {
                contractAddress,
            },
        });

        const deployedGame2Contract = await findDeployedContract(providers, {
            compiledContract: compiledGame2Contract,
            contractAddress,
            privateStateId: 'game2PrivateState',
            initialPrivateState: await Game2API.getPrivateState(providers.privateStateProvider),
        });

        logger?.trace({
            contractJoined: {
                finalizedDeployTxData: deployedGame2Contract.deployTxData.public,
            },
        });

        return new Game2API(deployedGame2Contract, providers, logger);
    }

    static async getPrivateState(
        privateStateProvider: PrivateStateProvider
    ): Promise<Game2PrivateState> {
        const existingPrivateState =
            await privateStateProvider.get("game2PrivateState");

        if (existingPrivateState) {
            return existingPrivateState;
        } else {
            let newPrivateState = createGame2PrivateState(utils.randomBytes(32));

            // this is done anyway on the first contract deploy/join, but we need to
            // initialize it before that to be able to have the public key for the
            // lobby menu available before that.
            privateStateProvider.set("game2PrivateState", newPrivateState);

            return newPrivateState;
        }
    }
}


/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
