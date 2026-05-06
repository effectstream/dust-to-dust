/**
 * Generates game-content.json from the content definitions.
 * This JSON is consumed by the backend admin script (Deno) so it doesn't
 * need to import the full frontend content package.
 *
 * Usage: npx tsx src/generate-json.ts [--minimal]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getContentDefinitions, configToEnemyStats, makeEnemiesConfig, getQuestDurationSec, BIOME_ID } from './register.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const minimalOnly = process.argv.includes('--minimal');
const { levels, enemyConfigs } = getContentDefinitions(minimalOnly);

// Resolve all content into contract-ready types
const resolvedLevels = levels.map(([level, enemies]) => ({
  level: { biome: Number(level.biome), difficulty: Number(level.difficulty) },
  enemies: toSerializable(makeEnemiesConfig(enemies.map(configToEnemyStats))),
}));

const resolvedEnemyConfigs = enemyConfigs.map(([level, enemies]) => ({
  level: { biome: Number(level.biome), difficulty: Number(level.difficulty) },
  enemies: toSerializable(makeEnemiesConfig(enemies.map(configToEnemyStats))),
}));

function toSerializable(obj: unknown): unknown {
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(toSerializable);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = toSerializable(v);
    }
    return result;
  }
  return obj;
}

// Generate quest durations for all biome/difficulty combinations
const biomes = minimalOnly ? [BIOME_ID.grasslands] : Object.values(BIOME_ID);
const difficulties = minimalOnly ? [1] : [1, 2, 3];
const questDurations = biomes.flatMap(biome =>
  difficulties.map(diff => ({
    level: { biome, difficulty: diff },
    durationSec: getQuestDurationSec(biome, diff),
  }))
);

const output = { levels: resolvedLevels, enemyConfigs: resolvedEnemyConfigs, questDurations };

const outDir = join(__dirname, '..', 'dist');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'game-content.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

console.log(`Wrote ${resolvedLevels.length} levels and ${resolvedEnemyConfigs.length} enemy configs to ${outPath}`);
