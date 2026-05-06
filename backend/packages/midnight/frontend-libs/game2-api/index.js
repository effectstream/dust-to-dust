/**
 * Provides types and utilities for working with deployed (on-chain) Game2 contracts
 *
 * @packageDocumentation
 */
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Contract, createGame2PrivateState, ledger, pureCircuits, witnesses, LEVEL_COUNT_PER_BIOME, BIOME_COUNT,
// Command,
 } from 'game2-contract';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, shareReplay } from 'rxjs';
/** @internal */
const compiledGame2Contract = CompiledContract.make('Game2', Contract).pipe(CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets('./managed/game2'));
// only converts bigint, but this is the only problem we have with printing ledger types
export function safeJSONString(obj) {
    if (typeof obj == 'bigint') {
        return Number(obj).toString();
    }
    else if (Array.isArray(obj)) {
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
    }
    else if (typeof obj == 'object') {
        let entries = Object.entries(obj);
        // this allows us to print Map properly
        let len = ('length' in obj ? obj.length : undefined) ?? ('size' in obj ? obj.size : undefined) ?? entries.length;
        ;
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
 * Provides an implementation of {@link DeployedGame2API} that interacts with the provided prover and submits transactions on-chain
 */
export class Game2API {
    deployedContract;
    providers;
    logger;
    /** @internal */
    constructor(deployedContract, providers, logger) {
        this.deployedContract = deployedContract;
        this.providers = providers;
        this.logger = logger;
        this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
        this.state$ = combineLatest([
            // Combine public (ledger) state with...
            providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(map((contractState) => ledger(contractState.data)), tap((ledgerState) => logger?.debug({
                ledgerStateChanged: {
                    ledgerState: {
                        ...ledgerState,
                        // state: ledgerState.state === STATE.occupied ? 'occupied' : 'vacant',
                        // poster: toHex(ledgerState.poster),
                    },
                },
            }))),
            // TODO: update this comment since this does change but we worked around it in pvp-arena
            // ...private state...
            //    since the private state of the bulletin board application never changes, we can query the
            //    private state once and always use the same value with `combineLatest`. In applications
            //    where the private state is expected to change, we would need to make this an `Observable`.
            from(providers.privateStateProvider.get('game2PrivateState')),
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
                const iteratingLevels = [];
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
                        byBiome.set(difficulty, byDifficulty);
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
            const newState = {
                activeBattleConfigs: new Map(ledgerState.active_battle_configs),
                activeBattleStates: new Map(ledgerState.active_battle_states),
                quests: new Map(ledgerState.quests),
                player: ledgerState.players.member(playerId) ? ledgerState.players.lookup(playerId) : undefined,
                playerId: playerId,
                playerAbilities: new Map(ledgerState.player_abilities.member(playerId) ? ledgerState.player_abilities.lookup(playerId) : []),
                allAbilities: new Map(ledgerState.all_abilities),
                levels: extractLevelsFromLedgerState(),
                bosses: extractBossesFromLedgerState(),
                playerBossProgress: extractPlayerBossProgressFromLedgerState(),
            };
            return newState;
        }).pipe(
        // Share the subscription among all subscribers to prevent hammering the indexer
        // with 14+ concurrent GraphQL subscriptions (one per scene)
        shareReplay({ bufferSize: 1, refCount: true }));
    }
    /**
     * Gets the address of the current deployed contract.
     */
    deployedContractAddress;
    /**
     * Gets an observable stream of state changes based on the current public (ledger),
     * and private state data.
     */
    state$;
    async register_new_player() {
        const txData = await this.deployedContract.callTx.register_new_player();
        this.logger?.trace({
            transactionAdded: {
                circuit: 'register_new_player',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }
    async start_new_battle(loadout, level) {
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
    async combat_round(battle_id, ability_targets) {
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
    async retreat_from_battle(battle_id) {
        const txData = await this.deployedContract.callTx.retreat_from_battle(battle_id);
        this.logger?.trace({
            transactionAdded: {
                circuit: 'retreat_from_battle',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }
    async start_new_quest(loadout, level) {
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
    async is_quest_ready(quest_id) {
        const txData = await this.deployedContract.callTx.is_quest_ready(quest_id);
        this.logger?.trace({
            transactionAdded: {
                circuit: 'is_quest_ready',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
        return txData.private.result;
    }
    async finalize_quest(quest_id) {
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
    async sell_ability(ability) {
        const txData = await this.deployedContract.callTx.sell_ability(ability);
        this.logger?.trace({
            transactionAdded: {
                circuit: 'sell_ability',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }
    async upgrade_ability(ability, sacrifice) {
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
    async admin_level_new(level, boss) {
        const txData = await this.deployedContract.callTx.admin_level_new(level, boss);
        this.logger?.trace({
            transactionAdded: {
                circuit: 'admin_level_new',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }
    async admin_level_add_config(level, enemies) {
        const txData = await this.deployedContract.callTx.admin_level_add_config(level, enemies);
        this.logger?.trace({
            transactionAdded: {
                circuit: 'admin_level_add_config',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }
    async admin_set_quest_duration(level, duration) {
        const txData = await this.deployedContract.callTx.admin_set_quest_duration(level, duration);
        this.logger?.trace({
            transactionAdded: {
                circuit: 'admin_set_quest_duration',
                txHash: txData.public.txHash,
                blockHeight: txData.public.blockHeight,
            },
        });
    }
    /**
     * Deploys a new Game2 contract to the network.
     *
     * @param providers The game's providers.
     * @param logger An optional 'pino' logger to use for logging.
     * @returns A `Promise` that resolves with a {@link Game2API} instance that manages the newly deployed
     * {@link DeployedGame2Contract}; or rejects with a deployment error.
     */
    static async deploy(providers, logger) {
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
    static async join(providers, contractAddress, logger) {
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
    static async getPrivateState(privateStateProvider) {
        const existingPrivateState = await privateStateProvider.get("game2PrivateState");
        if (existingPrivateState) {
            return existingPrivateState;
        }
        else {
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
//# sourceMappingURL=index.js.map