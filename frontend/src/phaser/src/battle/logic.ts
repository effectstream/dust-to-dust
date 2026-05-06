/**
 * Contains re-implementations of contract logic in cases where we either need dynamic call-back
 * or the circuit is just impure due to division witnesses
 */
import { Game2DerivedState, safeJSONString } from "game2-api";
import { Ability, BattleRewards, Effect, EFFECT_TYPE, BOSS_TYPE, pureCircuits, BattleConfig, BattleState, EnemiesConfig, Level } from "game2-contract";
import { game, logger } from '../main';

export type CombatCallbacks = {
    // triggered when an enemy blocks. enemy is the enemy that blocks, targets are who the block is applied to
    onEnemyBlock: (enemy: number, targets: number[], amount: number) => Promise<void>;
    // triggered when an enemy attacks. there are no enemy attack types (atm) and enemy is which enemy attacks (since only 1 player)
    onEnemyAttack: (enemy: number, amount: number) => Promise<void>;
    // triggered when an enemy heals. enemy is the enemy that heals, and targets are the ones to be healed
    onEnemyHeal: (enemy: number, targets: number[], amount: number) => Promise<void>;
    // triggered when a player's ability causes an effect (directly or via trigger)
    // reminder: `amount` is the color for EFFECT_TYPE.generate (range [0, 2])
    onPlayerEffect: (source: number, targets: number[], effectType: EFFECT_TYPE, amounts: number[], baseAmounts?: number[]) => Promise<void>;
    // triggered at the start of a round to show which abilities are being played this round
    onDrawAbilities: (abilities: Ability[]) => Promise<void>;
    // triggered when an ability is used. energy == undefined means base effect applying, otherwise it specifies which trigger is being applied
    onUseAbility: (abilityIndex: number, energy?: number) => Promise<void>;
    // triggered after an ability has been used (e.g. to re-tween back)
    afterUseAbility: (abilityIndex: number) => Promise<void>;
    // triggered before all energy triggers of a given color will be applied
    onEnergyTrigger: (source: number, color: number) => Promise<void>;
    // triggered at the end of the round during final damage application
    onEndOfRound: () => Promise<void>;
};

/**
 * Combat round logic that accepts specific player targets
 * @param battle_id Battle to be simulated. This is looked up int gameState so the battle must have been created first
 * @param gameState Current game's state. This is both input and output. Modified during execution.
 * @param playerTargets Player-selected targets for each spirit. This is an array of numbers, where each number corresponds to the enemy index (0, 1, 2) that the spirit will target.
 * @param uiHooks Optional callbacks that can hook into UI animations when calling this for frontend simulation.
 * @returns Rewards from the battle if it is completed (all enemies died or player died). or undefined if it remains in progress
 */
export function combat_round_logic(battle_id: bigint, gameState: Game2DerivedState, abilityTargets: number[], uiHooks?: CombatCallbacks): Promise<BattleRewards | undefined> {
    return new Promise(async (resolve) => {
        logger.combat.debug(`combat_round_logic(${abilityTargets}, ${uiHooks == undefined})`);
        const battleConfig = gameState.activeBattleConfigs.get(battle_id)!;
        const battleState = gameState.activeBattleStates.get(battle_id)!;

        const abilityIds = battleState.deck_indices.map((i) => battleConfig.loadout.abilities[Number(i)]);
        const abilities = abilityIds.map((id) => gameState.allAbilities.get(id)!)

        let player_block = BigInt(0);
        const stats = battleConfig.enemies.stats;
        const moves = [
            stats[0].moves[Number(battleState.enemy_move_index_0)],
            stats[1].moves[Number(battleState.enemy_move_index_1)],
            stats[2].moves[Number(battleState.enemy_move_index_2)],
        ];
        const enemy_count = Number(battleConfig.enemies.count);
        const enemies = new Array(enemy_count).fill(0).map((_, i) => i);
        const enemy_block = enemies.map((i) => moves.filter((_, j) => j != i && j < enemy_count).reduce((sum, move) => BigInt(sum) + BigInt(move.block_allies), BigInt(moves[i].block_self)));
        let old_damage_to_enemy = [battleState.damage_to_enemy_0, battleState.damage_to_enemy_1, battleState.damage_to_enemy_2];
        let round_damage_to_enemy = new Array(enemy_count).fill(BigInt(0));
        let round_damage_to_player = BigInt(0);

        const handleEndOfRound = () => {
            uiHooks?.onEndOfRound();
            if (round_damage_to_player > player_block) {
                battleState.damage_to_player += round_damage_to_player - player_block;
            }
            if (round_damage_to_enemy[0] > enemy_block[0]) {
                battleState.damage_to_enemy_0 += round_damage_to_enemy[0] - enemy_block[0];
            }
            if (round_damage_to_enemy[1] > enemy_block[1]) {
                battleState.damage_to_enemy_1 += round_damage_to_enemy[1] - enemy_block[1];
            }
            if (round_damage_to_enemy[2] > enemy_block[2]) {
                battleState.damage_to_enemy_2 += round_damage_to_enemy[2] - enemy_block[2];
            }
            if (battleState.damage_to_player >= 100) {
                logger.combat.info(`YOU DIED`);
                resolve({ alive: false, gold: BigInt(0), ability: { is_some: false, value: BigInt(0) } });
            }
            else if (battleState.damage_to_enemy_0 >= BigInt(stats[0].hp) && (enemy_count < 2 || battleState.damage_to_enemy_1 >= BigInt(stats[1].hp)) && (enemy_count < 3 || battleState.damage_to_enemy_2 >= BigInt(stats[2].hp))) {
                logger.combat.info(`YOU WON`);
                resolve(battleRewards(gameState, battleConfig.level, battleConfig.enemies));
            } else {
                logger.combat.info(`CONTINUE BATTLE`);
                resolve(undefined);
            }
        }

        await uiHooks?.onDrawAbilities(abilities);

        // Enemy block phase
        for (let i = 0; i < enemy_count; ++i) {
            if (old_damage_to_enemy[i] < BigInt(stats[i].hp)) {
                // do not change vars for block since it's directly checked during player against enemy damage code
                const selfBlock = Number(moves[i].block_self);
                if (selfBlock != 0) {
                    await uiHooks?.onEnemyBlock(i, [i], selfBlock);
                }
                const alliesBlock = Number(moves[i].block_allies);
                if (alliesBlock != 0) {
                    await uiHooks?.onEnemyBlock(i, enemies.filter((e) => e != i && old_damage_to_enemy[e] < BigInt(stats[e].hp)), alliesBlock);
                }
            }
        }

        const aliveTargets = new Array(enemy_count)
            .fill(0)
            .map((_, i) => i)
            .filter((i) => old_damage_to_enemy[i] < BigInt(stats[i].hp));

        // Player abilities with player-selected targets (key difference!)
        const resolveEffect = async (effect: { is_some: boolean, value: Effect }, source: number, target: number) => {
            if (effect.is_some) {
                const targets = effect.value.is_aoe ? aliveTargets : [target];
                switch (effect.value.effect_type) {
                    case EFFECT_TYPE.attack_fire:
                    case EFFECT_TYPE.attack_ice:
                    case EFFECT_TYPE.attack_phys:
                        const amounts = targets.map((enemy) => {
                            const dmg = pureCircuits.effect_damage(effect.value, stats[enemy]);
                            round_damage_to_enemy[enemy] += dmg;
                            return Number(dmg)
                        });
                        const baseAmounts = targets.map(() => Number(effect.value.amount));
                        await uiHooks?.onPlayerEffect(source, targets, effect.value.effect_type, amounts, baseAmounts);
                        break;
                    case EFFECT_TYPE.block:
                        await uiHooks?.onPlayerEffect(source, targets, effect.value.effect_type, [Number(effect.value.amount)]);
                        player_block += effect.value.amount;
                        break;
                }
            }
        };

        // base effects
        const isEnemyDead = (i: number) => round_damage_to_enemy[i] + old_damage_to_enemy[i] - enemy_block[i] >= BigInt(stats[i].hp);
        const allEnemiesDead = () => isEnemyDead(0) && (enemy_count < 2 || isEnemyDead(1)) && (enemy_count < 3 || isEnemyDead(2));
        for (let i = 0; i < abilities.length; ++i) {
            const ability = abilities[i];
            await uiHooks?.onUseAbility(i, undefined);
            if (ability.generate_color.is_some) {
                await uiHooks?.onEnergyTrigger(i, Number(ability.generate_color.value));
            }
            await resolveEffect(ability.effect, i, abilityTargets[i]);
            await uiHooks?.afterUseAbility(i);
            if (allEnemiesDead()) {
                logger.combat.debug(`[${uiHooks == undefined}] prematurely ending`);
                return handleEndOfRound();
            }
        }
        
        // energy triggers
        for (let i = 0; i < abilities.length; ++i) {
            const ability = abilities[i];
            for (let c = 0; c < 3; ++c) {
                if (ability.on_energy[c].is_some && abilities.some((a2, j) => i != j && a2.generate_color.is_some && Number(a2.generate_color.value) == c)) {
                    await uiHooks?.onUseAbility(i, c);
                    await resolveEffect(ability.on_energy[c], i, abilityTargets[i]); // Use same target as base effect
                    await uiHooks?.afterUseAbility(i);
                    if (allEnemiesDead()) {
                        logger.combat.debug(`[${uiHooks == undefined}] prematurely ending`);
                        return handleEndOfRound();
                    }
                }
            }
        }

        // Enemy heal phase
        for (let i = 0; i < enemy_count; ++i) {
            if (!isEnemyDead(i)) {
                const selfHeal = Number(moves[i].heal_self);
                if (selfHeal != 0) {
                    await uiHooks?.onEnemyHeal(i, [i], selfHeal);
                }
                const alliesHeal = Number(moves[i].heal_allies);
                if (alliesHeal != 0) {
                    await uiHooks?.onEnemyHeal(i, enemies.filter((e) => e != i && !isEnemyDead(e)), alliesHeal);
                }
            }
        }
      
        // Enemy damage phase
        for (let i = 0; i < enemy_count; ++i) {
            if (!isEnemyDead(i)) {
                const damage = moves[i].attack;
                if (Number(damage) != 0) {
                    round_damage_to_player += damage;
                    await uiHooks?.onEnemyAttack(i, Number(damage));
                }
            }
        }

        handleEndOfRound();
    });
}

// due to use of div/mod witnesseswe can't export these as a pure circuit so we re-do it here for speed
export function randomAbility(rng: Uint8Array, difficulty: bigint): Ability {
    const color = rng[0] % 6;
    const trigger1 = color != 0 && (rng[1] % 3) == 0;
    const trigger2 = color != 1 && (rng[2] % 3) == 0;
    const trigger3 = color != 2 && (rng[3] % 3) == 0;
    const main_factor = difficulty * BigInt((trigger1 ? 0 : 1) + (trigger2 ? 0 : 1) + (trigger3 ? 0 : 1) + (color <= 2 ? 0 : 1));
    const main_effect = randomEffect(rng[4], main_factor);
    const trigger_factor = BigInt(2) * difficulty;
    return {
        effect: { is_some: true, value: main_effect },
        on_energy: [
            { is_some: trigger1, value: randomEffect(rng[5], trigger_factor) },
            { is_some: trigger2, value: randomEffect(rng[6], trigger_factor) },
            { is_some: trigger3, value: randomEffect(rng[7], trigger_factor) },
        ],
        generate_color: { is_some: color <= 2, value: BigInt(color % 3) },
        upgrade_level: BigInt(0),
    };
}

export function randomEffect(rng: number, factor: bigint): Effect {
    const effect_type = (rng % 4) as EFFECT_TYPE;
    const is_aoe = effect_type != EFFECT_TYPE.block ? rng > 180 : false;
    const block_factor = effect_type != EFFECT_TYPE.block ? 1 : 2;
    const final_factor = Number(factor) * block_factor * (is_aoe ? 1 : 2);
    const amount = BigInt(Math.floor((4 * final_factor + (rng % final_factor)) / 5));
    return {
        effect_type,
        amount,
        is_aoe
    };
}

function randomDeckIndices(rng: number): number[] {
    const mod_6 = rng % 6;
    if (mod_6 == 0) {
        return [0, 1, 2];
    } else if (mod_6 == 1) {
        return [0, 2, 1];
    } else if (mod_6 == 2) {
        return [1, 0, 2];
    } else if (mod_6 == 3) {
        return [1, 2, 0];
    } else if (mod_6 == 4) {
        return [2, 0, 1];
    }
    return [2, 1, 0];
}

export function initBattlestate(rng: Uint8Array, battle: BattleConfig): BattleState {
    return {
        round: BigInt(0),
        deck_indices: randomDeckIndices(rng[1]).map(BigInt),
        damage_to_player: BigInt(0),
        damage_to_enemy_0: BigInt(0),
        damage_to_enemy_1: BigInt(0),
        damage_to_enemy_2: BigInt(0),
        enemy_move_index_0: battle.enemies.count >= 1 ? (BigInt(rng[2]) % battle.enemies.stats[0].move_count) : BigInt(0),
        enemy_move_index_1: battle.enemies.count >= 2 ? (BigInt(rng[3]) % battle.enemies.stats[1].move_count) : BigInt(0),
        enemy_move_index_2: battle.enemies.count >= 3 ? (BigInt(rng[4]) % battle.enemies.stats[2].move_count) : BigInt(0),
    };
}

export function battleRewards(gameState: Game2DerivedState, level: Level, enemies: EnemiesConfig): BattleRewards {
    const enemyCount = Number(enemies.count);

    let abilityReward = { is_some: false, value: BigInt(0) };
    let reward_factor = BigInt(0);
    for (let i = 0; i < enemyCount; ++i) {
        reward_factor += pureCircuits.boss_type_reward_factor(enemies.stats[i].boss_type);
    }
    if (reward_factor > 0) {
        const ability = randomAbility(gameState.player!.rng, level.difficulty * reward_factor);
        const abilityId = pureCircuits.derive_ability_id(ability);
        // TODO: should this be here? if we don't do that we need to return the entire ability in the contract
        // if we don't return it, we need to match the logic here with the contract
        gameState.allAbilities.set(abilityId, ability);
        abilityReward.is_some = true;
        abilityReward.value = abilityId;
    }
    return { alive: true, gold: pureCircuits.battle_gold_reward(reward_factor, level.difficulty), ability: abilityReward };
}

export function abilityValue(ability: Ability): bigint {
    const score = pureCircuits.ability_score(ability);
    return (score * score) / BigInt(500);
}

export function computeUpgradedAbility(ability: Ability): Ability {
    return {
        effect: computeUpgradedEffect(ability.effect),
        on_energy: ability.on_energy.map(computeUpgradedEffect),
        generate_color: ability.generate_color,
        upgrade_level: ability.upgrade_level + BigInt(1),
    };
}

function computeUpgradedEffect(effect: { is_some: boolean, value: Effect }): { is_some: boolean, value: Effect } {
    if (!effect.is_some) {
        return effect;
    }
    return {
        is_some: true,
        value: {
            effect_type: effect.value.effect_type,
            amount: BigInt(Math.floor(1.3 * Number(effect.value.amount))),
            is_aoe: effect.value.is_aoe,
        }
    };
}