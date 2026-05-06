/**
 * Shared content registration logic
 * Used by both CLI tools and Phaser app
 */

import { type DeployedGame2API } from 'game2-api';
import { BOSS_TYPE, type EnemiesConfig, type EnemyStats, type Level, pureCircuits } from 'game2-contract';
// import { type Logger } from 'pino';
type Logger = { 
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  log: (...args: any[]) => void;
}

// Biome IDs
export const BIOME_ID = {
  grasslands: 0,
  desert: 1,
  tundra: 2,
  cave: 3,
} as const;

// Quest duration config (in minutes)
// Base time per biome, plus offset per difficulty
const QUEST_BASE_MINUTES: Record<number, number> = {
  [BIOME_ID.grasslands]: 10,
  [BIOME_ID.desert]: 15,
  [BIOME_ID.tundra]: 20,
  [BIOME_ID.cave]: 30,
};

const QUEST_DIFFICULTY_OFFSET_MINUTES: Record<number, number> = {
  1: 0,
  2: 10,
  3: 20,
};

/**
 * Get quest duration in seconds for a given biome and difficulty.
 * Falls back to 1200s (20 min) if biome/difficulty not found.
 */
export function getQuestDurationSec(biome: number, difficulty: number): number {
  const base = QUEST_BASE_MINUTES[biome];
  const offset = QUEST_DIFFICULTY_OFFSET_MINUTES[difficulty];
  if (base === undefined || offset === undefined) return 1200;
  return (base + offset) * 60;
}

// Defense values
export const Def = {
  SUPEREFFECTIVE: 0n,
  EFFECTIVE: 1n,
  NEUTRAL: 2n,
  WEAK: 3n,
  IMMUNE: 4n,
} as const;

export type EnemyMoveConfig = {
  attack?: number;
  block_self?: number;
  block_allies?: number;
  heal_self?: number;
  heal_allies?: number;
};

export type EnemyStatsConfig = {
  boss_type?: BOSS_TYPE;
  enemy_type: number;
  hp: number;
  moves: EnemyMoveConfig[];
  physical_def: bigint;
  fire_def: bigint;
  ice_def: bigint;
};

export function configToEnemyStats(config: EnemyStatsConfig): EnemyStats {
  return {
    boss_type: config.boss_type ?? BOSS_TYPE.normal,
    enemy_type: BigInt(config.enemy_type),
    hp: BigInt(config.hp),
    moves: config.moves
      .map((move) => {
        return {
          attack: BigInt(move.attack ?? 0),
          block_self: BigInt(move.block_self ?? 0),
          block_allies: BigInt(move.block_allies ?? 0),
          heal_self: BigInt(move.heal_self ?? 0),
          heal_allies: BigInt(move.heal_allies ?? 0),
        };
      })
      .concat(new Array(3 - config.moves.length).fill(pureCircuits.filler_move())),
    move_count: BigInt(config.moves.length),
    physical_def: config.physical_def,
    fire_def: config.fire_def,
    ice_def: config.ice_def,
  };
}

export function makeEnemiesConfig(stats: EnemyStats[]): EnemiesConfig {
  const padding = new Array(3 - stats.length).fill(pureCircuits.filler_enemy_stats());
  return {
    stats: [...stats, ...padding],
    count: BigInt(stats.length),
  };
}

/**
 * Returns all content definitions: bosses, normal enemies, levels, and enemy configs.
 * Used by both registerStartingContent() and the JSON generator.
 */
export function getContentDefinitions(minimalOnly: boolean) {
  // BOSSES
  const dragon: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 0,
    hp: 300,
    moves: [{ attack: 30 }, { attack: 15, block_self: 15 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.WEAK,
    ice_def: Def.EFFECTIVE,
  };
  const dragonStrong: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 0,
    hp: 450,
    moves: [{ attack: 45 }, { attack: 22, block_self: 22 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.WEAK,
    ice_def: Def.EFFECTIVE,
  };
  const dragonElite: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 0,
    hp: 600,
    moves: [{ attack: 60 }, { attack: 30, block_self: 30 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.WEAK,
    ice_def: Def.EFFECTIVE,
  };

  const enigma: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 1,
    hp: 42,
    moves: [{ attack: 30, block_self: 30 }],
    physical_def: Def.WEAK,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const enigmaStrong: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 1,
    hp: 64,
    moves: [{ attack: 45, block_self: 45 }],
    physical_def: Def.WEAK,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const enigmaElite: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 1,
    hp: 86,
    moves: [{ attack: 60, block_self: 60 }],
    physical_def: Def.WEAK,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };

  const abominable: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 2,
    hp: 400,
    moves: [{ attack: 20, block_self: 20 }, { attack: 30 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.SUPEREFFECTIVE,
    ice_def: Def.WEAK,
  };
  const abominableStrong: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 2,
    hp: 600,
    moves: [{ attack: 30, block_self: 30 }, { attack: 45 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.SUPEREFFECTIVE,
    ice_def: Def.WEAK,
  };
  const abominableElite: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 2,
    hp: 800,
    moves: [{ attack: 40, block_self: 40 }, { attack: 60 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.SUPEREFFECTIVE,
    ice_def: Def.WEAK,
  };

  const sphinx: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 3,
    hp: 400,
    moves: [{ attack: 35, block_self: 10 }, { attack: 20, block_self: 20 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const sphinxStrong: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 3,
    hp: 600,
    moves: [{ attack: 50, block_self: 15 }, { attack: 30, block_self: 30 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const sphinxElite: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 3,
    hp: 800,
    moves: [{ attack: 70, block_self: 20 }, { attack: 40, block_self: 40 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };

  // MINI-BOSSES
  const goblinChief: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 9,
    hp: 140,
    moves: [{ attack: 10, block_self: 15 }, { attack: 25 }, { attack: 15, block_self: 10 }],
    physical_def: Def.EFFECTIVE,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.EFFECTIVE,
  };

  const tentacles: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 10,
    hp: 90,
    moves: [{ attack: 15, heal_self: 12 }, { block_self: 15, heal_self: 12 }, { attack: 10, block_self: 5, heal_self: 12 }],
    physical_def: Def.WEAK,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.NEUTRAL,
  };

  const hellspawn: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 6,
    hp: 90,
    moves: [{ attack: 40 }, { attack: 30, heal_self: 12 }],
    physical_def: Def.IMMUNE,
    fire_def: Def.WEAK,
    ice_def: Def.SUPEREFFECTIVE,
  };
  const hellspawnStrong: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 6,
    hp: 140,
    moves: [{ attack: 60 }, { attack: 45, heal_self: 15 }],
    physical_def: Def.IMMUNE,
    fire_def: Def.WEAK,
    ice_def: Def.SUPEREFFECTIVE,
  };
  const hellspawnElite: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 6,
    hp: 185,
    moves: [{ attack: 80 }, { attack: 60, heal_self: 20 }],
    physical_def: Def.IMMUNE,
    fire_def: Def.WEAK,
    ice_def: Def.SUPEREFFECTIVE,
  };

  const iceGolem: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 5,
    hp: 90,
    moves: [{ attack: 5, block_self: 15 }, { block_self: 40 }, { attack: 10, block_self: 10 }],
    physical_def: Def.WEAK,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.IMMUNE,
  };
  const iceGolemStrong: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 5,
    hp: 140,
    moves: [{ attack: 8, block_self: 22 }, { block_self: 60 }, { attack: 15, block_self: 15 }],
    physical_def: Def.WEAK,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.IMMUNE,
  };
  const iceGolemElite: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.miniboss,
    enemy_type: 5,
    hp: 185,
    moves: [{ attack: 10, block_self: 30 }, { block_self: 80 }, { attack: 20, block_self: 20 }],
    physical_def: Def.WEAK,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.IMMUNE,
  };

  // NORMAL ENEMIES
  const goblin: EnemyStatsConfig = {
    boss_type: BOSS_TYPE.boss,
    enemy_type: 0,
    hp: 35,
    moves: [{ attack: 5, block_self: 5 }, { attack: 10 }, { block_self: 10 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const goblinStrong: EnemyStatsConfig = {
    enemy_type: 0,
    hp: 50,
    moves: [{ attack: 10, block_self: 5 }, { attack: 15 }, { block_self: 15 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const goblinElite: EnemyStatsConfig = {
    enemy_type: 0,
    hp: 70,
    moves: [{ attack: 10, block_self: 10 }, { attack: 20 }, { block_self: 20 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };

  const fireSprite: EnemyStatsConfig = {
    enemy_type: 1,
    hp: 30,
    moves: [{ attack: 20 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.IMMUNE,
    ice_def: Def.EFFECTIVE,
  };
  const fireSpriteStrong: EnemyStatsConfig = {
    enemy_type: 1,
    hp: 45,
    moves: [{ attack: 30 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.IMMUNE,
    ice_def: Def.EFFECTIVE,
  };
  const fireSpriteElite: EnemyStatsConfig = {
    enemy_type: 1,
    hp: 60,
    moves: [{ attack: 40 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.IMMUNE,
    ice_def: Def.EFFECTIVE,
  };

  const coyote: EnemyStatsConfig = {
    enemy_type: 3,
    hp: 60,
    moves: [{ attack: 20 }],
    physical_def: Def.EFFECTIVE,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const coyoteStrong: EnemyStatsConfig = {
    enemy_type: 3,
    hp: 85,
    moves: [{ attack: 30 }],
    physical_def: Def.EFFECTIVE,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const coyoteElite: EnemyStatsConfig = {
    enemy_type: 3,
    hp: 115,
    moves: [{ attack: 40 }],
    physical_def: Def.EFFECTIVE,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };

  const pyramid: EnemyStatsConfig = {
    enemy_type: 4,
    hp: 60,
    moves: [{ attack: 20 }, { block_allies: 10 }, { heal_allies: 10 }],
    physical_def: Def.IMMUNE,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.EFFECTIVE,
  };
  const pyramidStrong: EnemyStatsConfig = {
    enemy_type: 4,
    hp: 85,
    moves: [{ attack: 30 }, { block_allies: 15 }, { heal_allies: 15 }],
    physical_def: Def.IMMUNE,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.EFFECTIVE,
  };
  const pyramidElite: EnemyStatsConfig = {
    enemy_type: 4,
    hp: 115,
    moves: [{ attack: 40 }, { block_allies: 20 }, { heal_allies: 20 }],
    physical_def: Def.IMMUNE,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.EFFECTIVE,
  };

  const goblinPriest: EnemyStatsConfig = {
    enemy_type: 7,
    hp: 35,
    moves: [{ block_self: 5, block_allies: 10 }, { heal_allies: 15 }, { attack: 10, block_allies: 5 }],
    physical_def: Def.SUPEREFFECTIVE,
    fire_def: Def.WEAK,
    ice_def: Def.WEAK,
  };
  const goblinPriestStrong: EnemyStatsConfig = {
    enemy_type: 7,
    hp: 50,
    moves: [{ block_self: 7, block_allies: 15 }, { heal_allies: 22 }, { attack: 15, block_allies: 8 }],
    physical_def: Def.SUPEREFFECTIVE,
    fire_def: Def.WEAK,
    ice_def: Def.WEAK,
  };
  const goblinPriestElite: EnemyStatsConfig = {
    enemy_type: 7,
    hp: 70,
    moves: [{ attack: 20, block_allies: 10 }, { heal_allies: 30 }, { block_self: 10, block_allies: 20 }],
    physical_def: Def.SUPEREFFECTIVE,
    fire_def: Def.WEAK,
    ice_def: Def.WEAK,
  };

  const goblinSwordmaster: EnemyStatsConfig = {
    enemy_type: 8,
    hp: 23,
    moves: [{ attack: 10, block_self: 2 }, { attack: 10 }, { attack: 15 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const goblinSwordmasterStrong: EnemyStatsConfig = {
    enemy_type: 8,
    hp: 40,
    moves: [{ attack: 25, block_self: 5 }, { attack: 15 }, { attack: 20 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };
  const goblinSwordmasterElite: EnemyStatsConfig = {
    enemy_type: 8,
    hp: 60,
    moves: [{ attack: 45, block_self: 9 }, { attack: 20 }, { attack: 30 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.NEUTRAL,
    ice_def: Def.NEUTRAL,
  };

  const snowman: EnemyStatsConfig = {
    enemy_type: 3,
    hp: 30,
    moves: [{ attack: 20 }, { attack: 15, block_self: 5 }, { attack: 10 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.WEAK,
  };
  const snowmanStrong: EnemyStatsConfig = {
    enemy_type: 3,
    hp: 45,
    moves: [{ attack: 30 }, { attack: 20, block_self: 8 }, { attack: 15 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.WEAK,
  };
  const snowmanElite: EnemyStatsConfig = {
    enemy_type: 3,
    hp: 60,
    moves: [{ attack: 40 }, { attack: 30, block_self: 10 }, { attack: 20 }],
    physical_def: Def.NEUTRAL,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.WEAK,
  };

  const tentacle: EnemyStatsConfig = {
    enemy_type: 11,
    hp: 35,
    moves: [{ attack: 10, heal_self: 5 }, { block_self: 10, heal_self: 5 }, { attack: 5, block_self: 5, heal_self: 5 }],
    physical_def: Def.WEAK,
    fire_def: Def.EFFECTIVE,
    ice_def: Def.NEUTRAL,
  };

  // Define all level configurations
  const grass1 = { biome: BigInt(BIOME_ID.grasslands), difficulty: BigInt(1) };
  const grass2 = { biome: BigInt(BIOME_ID.grasslands), difficulty: BigInt(2) };
  const grass3 = { biome: BigInt(BIOME_ID.grasslands), difficulty: BigInt(3) };
  const desert1 = { biome: BigInt(BIOME_ID.desert), difficulty: BigInt(1) };
  const desert2 = { biome: BigInt(BIOME_ID.desert), difficulty: BigInt(2) };
  const desert3 = { biome: BigInt(BIOME_ID.desert), difficulty: BigInt(3) };
  const tundra1 = { biome: BigInt(BIOME_ID.tundra), difficulty: BigInt(1) };
  const tundra2 = { biome: BigInt(BIOME_ID.tundra), difficulty: BigInt(2) };
  const tundra3 = { biome: BigInt(BIOME_ID.tundra), difficulty: BigInt(3) };
  const cave1 = { biome: BigInt(BIOME_ID.cave), difficulty: BigInt(1) };
  const cave2 = { biome: BigInt(BIOME_ID.cave), difficulty: BigInt(2) };
  const cave3 = { biome: BigInt(BIOME_ID.cave), difficulty: BigInt(3) };

  const levels: [Level, EnemyStatsConfig[]][] = [[grass1, [dragon]]];
  const enemyConfigs: [Level, EnemyStatsConfig[]][] = [
    // TODO: change back to 3x goblin once damage icons work
    [grass1, [goblin, goblinPriest]],
  ];

  // Register full content if not minimal
  if (!minimalOnly) {
    levels.push(
      // Grasslands
      // [grass1, [dragon]], // grass1 IS ALREADY ADDED ABOVE IN `levels` DEFINITION SO THIS IS UNNEEDED. 
      [grass2, [dragonStrong]],
      [grass3, [dragonElite]],

      // Desert
      [desert1, [sphinx]],
      [desert2, [sphinxStrong]],
      [desert3, [sphinxElite]],

      // Tundra
      [tundra1, [abominable]],
      [tundra2, [abominableStrong]],
      [tundra3, [abominableElite]],

      // Cave
      [cave1, [enigma]],
      [cave2, [enigmaStrong]],
      [cave3, [enigmaElite]]
    );

    enemyConfigs.push(
      // Grasslands
      [grass1, [snowman, fireSprite]],
      [grass1, [goblinSwordmaster, goblin, goblinSwordmaster]],
      [grass1, [tentacle, goblin]],
      [grass1, [goblinPriest, goblinSwordmaster]],
      [grass1, [goblinChief]], // miniboss

      [grass2, [goblinStrong, goblinPriestStrong, goblinStrong]],
      [grass2, [snowmanStrong, fireSpriteStrong]],
      [grass2, [iceGolemStrong, goblinStrong]], // miniboss
      [grass2, [goblinSwordmasterStrong, goblinSwordmasterStrong, goblinPriestStrong]],

      [grass3, [goblinElite, goblinPriestElite, goblinElite]],
      [grass3, [snowmanElite, fireSpriteElite]],
      [grass3, [iceGolemElite, goblinElite]], // miniboss
      [grass3, [goblinSwordmasterElite, goblinSwordmasterElite, goblinSwordmasterElite]],

      // Desert
      [desert1, [fireSprite, fireSprite]],
      [desert1, [goblin, fireSprite, coyote]],
      [desert1, [pyramid, coyote, goblinPriest]],
      [desert1, [hellspawn, coyote]], // miniboss
      [desert1, [goblinSwordmaster, coyote, goblinSwordmaster]],

      [desert2, [fireSpriteStrong, fireSpriteStrong, coyoteStrong]],
      [desert2, [goblinStrong, fireSpriteStrong, goblinPriestStrong]],
      [desert2, [goblinStrong, fireSpriteStrong, pyramidStrong]],
      [desert2, [fireSpriteStrong, fireSpriteStrong, goblinStrong]],
      [desert2, [hellspawnStrong, coyoteStrong]], // miniboss
      [desert2, [goblinSwordmasterStrong, pyramidStrong, goblinSwordmasterStrong]],

      [desert3, [fireSpriteElite, fireSpriteElite]],
      [desert3, [goblinElite, fireSpriteElite, coyoteElite]],
      [desert3, [fireSpriteElite, goblinPriestElite, goblinElite]],
      [desert3, [fireSpriteElite, pyramidElite, goblinElite]],
      [desert3, [hellspawnElite, coyoteElite]], // miniboss
      [desert3, [goblinSwordmasterElite, coyoteElite, goblinSwordmasterElite]],

      // Tundra
      [tundra1, [snowman, snowman, snowman]],
      [tundra1, [iceGolem, snowman]], // miniboss

      [tundra2, [snowmanStrong, snowmanStrong, snowmanStrong]],
      [tundra2, [iceGolemStrong, snowmanStrong]], // miniboss
      [tundra2, [iceGolemStrong, iceGolemStrong]], // miniboss

      [tundra3, [snowmanElite, snowmanElite, snowmanElite]],
      [tundra3, [iceGolemElite, snowmanElite]], // miniboss
      [tundra3, [iceGolemElite, iceGolemElite]], // miniboss

      // Cave
      [cave1, [goblin, fireSprite, goblin]],
      [cave1, [goblin, goblin, goblin]],
      [cave1, [goblin, goblinPriest, goblin]],
      [cave1, [goblin, hellspawn]], // miniboss
      [cave1, [goblin, hellspawn, goblinPriest]], // miniboss
      [cave1, [goblinSwordmaster, goblinSwordmaster, goblinPriest]],
      [cave1, [tentacles]], // miniboss

      [cave2, [goblinStrong, fireSpriteStrong, goblinStrong]],
      [cave2, [goblinStrong, goblinStrong, goblinStrong]],
      [cave2, [goblinStrong, goblinPriestStrong, goblinStrong]],
      [cave2, [iceGolemStrong, fireSpriteStrong]], // miniboss
      [cave2, [hellspawnStrong, goblinStrong, goblinPriestStrong]], // miniboss
      [cave2, [goblinSwordmasterStrong, goblinSwordmasterStrong, goblinSwordmasterStrong]],

      [cave3, [goblinElite, fireSpriteElite, goblinElite]],
      [cave3, [goblinElite, goblinElite, goblinElite]],
      [cave3, [goblinElite, goblinPriestElite, goblinElite]],
      [cave3, [iceGolemElite, fireSpriteElite]], // miniboss
      [cave3, [hellspawnElite, goblinElite]], // miniboss
      [cave3, [hellspawnElite, goblinElite, goblinPriestElite]], // miniboss
      [cave3, [goblinSwordmasterElite, goblinPriestElite, goblinSwordmasterElite]]
    );
  }

  return { levels, enemyConfigs };
}

/**
 * Register all game content - bosses, levels, and enemy configurations
 * @param api - The deployed Game API
 * @param minimalOnly - If true, only register minimal content (Grasslands Frontiers)
 * @param logger - Logger for progress messages
 */
export async function registerStartingContent(
  api: DeployedGame2API,
  minimalOnly: boolean,
  logger: Logger | Pick<Console, 'log'> | { info: (msg: string) => void }
): Promise<void> {
  const log = (msg: string) => {
    if ('info' in logger && typeof logger.info === 'function') {
      logger.info(msg);
    } else if ('log' in logger && typeof logger.log === 'function') {
      logger.log(msg);
    }
  };

  const { levels, enemyConfigs } = getContentDefinitions(minimalOnly);

  log(`Starting content registration (${minimalOnly ? 'minimal' : 'full'} mode)`);
  log(`Registering ${levels.length} levels...`);

  for (let i = 0; i < levels.length; ++i) {
    log(`  Level ${i + 1} / ${levels.length}`);
    await api.admin_level_new(levels[i][0], makeEnemiesConfig(levels[i][1].map(configToEnemyStats)));
  }

  log(`Registering ${enemyConfigs.length} enemy configurations...`);
  for (let i = 0; i < enemyConfigs.length; ++i) {
    log(`  Enemy config ${i + 1} / ${enemyConfigs.length}`);
    await api.admin_level_add_config(
      enemyConfigs[i][0],
      makeEnemiesConfig(enemyConfigs[i][1].map(configToEnemyStats))
    );
  }

  // Register quest durations for all level combinations
  const biomes = minimalOnly ? [BIOME_ID.grasslands] : Object.values(BIOME_ID);
  const difficulties = minimalOnly ? [1] : [1, 2, 3];
  log(`Registering quest durations for ${biomes.length} biomes x ${difficulties.length} difficulties...`);
  for (const biome of biomes) {
    for (const diff of difficulties) {
      const level = { biome: BigInt(biome), difficulty: BigInt(diff) };
      const durationSec = getQuestDurationSec(biome, diff);
      log(`  Quest duration for biome ${biome} difficulty ${diff}: ${durationSec}s (${durationSec / 60}m)`);
      await api.admin_set_quest_duration(level, BigInt(durationSec));
    }
  }

  log(`Content registration complete! Registered ${levels.length} levels and ${enemyConfigs.length} enemy configs.`);
}
