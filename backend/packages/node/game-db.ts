// ---------------------------------------------------------------------------
// game-db.ts — Database schema, ledger sync, and query functions
// ---------------------------------------------------------------------------

import { bech32m } from "npm:@scure/base@^2.0.0";
import {
  CompactTypeBoolean,
  CompactTypeEnum,
  CompactTypeField,
  CompactTypeUnsignedInteger,
  CompactTypeVector,
} from "@midnight-ntwrk/compact-runtime";

// Module-level network ID for Bech32 address encoding
let _networkId: string = "undeployed";

/** Set the Midnight network ID used for Bech32 address encoding. */
export function setAddressNetworkId(id: string): void {
  _networkId = id;
}

/** SCALE compact-encode a bigint (must match frontend bech32-utils.ts exactly). */
function scaleCompactEncode(value: bigint): Uint8Array {
  if (value < 64n) {
    return new Uint8Array([Number(value << 2n)]);
  } else if (value < 16384n) {
    const v = Number(value << 2n | 1n);
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  } else if (value < (1n << 30n)) {
    const v = Number(value << 2n | 2n);
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  } else {
    let v = value;
    const leBytes: number[] = [];
    while (v > 0n) {
      leBytes.push(Number(v & 0xffn));
      v >>= 8n;
    }
    const prefix = ((leBytes.length - 4) << 2) | 0b11;
    const result = new Uint8Array(1 + leBytes.length);
    result[0] = prefix;
    result.set(leBytes, 1);
    return result;
  }
}

/** Encode a bigint to Bech32m mn_dust address (matches frontend encoding). */
function toBech32mDust(value: bigint): string {
  const data = scaleCompactEncode(value);
  const networkSuffix = _networkId === "mainnet" ? "" : `_${_networkId}`;
  return bech32m.encode(`mn_dust${networkSuffix}`, bech32m.toWords(data), false);
}

/** Encode 64 raw bytes (coin_pub_key || enc_pub_key) as Bech32m mn_shield-addr string. */
function bytesToBech32Shield(data: Uint8Array): string {
  const networkSuffix = _networkId === "mainnet" ? "" : `_${_networkId}`;
  return bech32m.encode(`mn_shield-addr${networkSuffix}`, bech32m.toWords(data), false);
}

/** Convert a hex ledger key to a Bech32 mn_dust address.
 *  Indexer map keys are LE-byte hex (e.g. "0x2b9a...5f"), but the frontend's
 *  playerId bigint is the natural BE value. Reverse the 32 bytes to match. */
function hexToBech32(hexKey: string): string {
  const hex = (hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey).padStart(64, "0");
  const reversed = hex.match(/.{2}/g)!.reverse().join("");
  const value = BigInt("0x" + reversed);
  return toBech32mDust(value);
}

/** Convert a raw bigint (e.g. extracted from packed struct) to a Bech32 mn_dust address. */
function bigintToBech32(value: bigint): string {
  return toBech32mDust(value);
}

// ---------------------------------------------------------------------------
//
// Verified payload layout (from GAME_DB_DEBUG=1 output):
//
// payload["0"]:
//   [0] all_abilities        (Map<Field, Ability>)           — map[0], 9 keys
//   [1] ability_base_phys_id (scalar)
//   [2] ability_base_block_id (scalar)
//   [3] ability_base_fire_aoe_id (scalar)
//   [4] ability_base_ice_id (scalar)
//
// payload["1"]:
//   [0] ability_reward_id (scalar)
//   [1] ability_demo_starting_1_id (scalar)
//   [2] ability_demo_starting_2_id (scalar)
//   [3] ability_demo_starting_3_id (scalar)
//   [4] active_battle_states (Map<Field, BattleState>)       — map[1]
//   [5] active_battle_configs(Map<Field, BattleConfig>)      — map[2]
//   [6] quests               (Map<Field, QuestConfig>)       — map[3]
//   [7] players              (Map<Field, Player>)            — map[4]
//   [8] player_abilities     (Map<Field, Map<Field, Uint32>>)— map[5]
//   [9] player_boss_progress (Map<Field, Map<...>>)          — map[6]
//  [10] deployer (scalar)
//  [11] levels               (Map<Level, Map<...>>)          — map[7]
//  [12] bosses               (Map<Level, EnemiesConfig>)     — map[8]
//  [13] quest_durations      (Map<Level, Uint64>)            — map[9]
//  [14] delegations          (Map<Field, Field>)             — map[10]
//
// Struct values are packed as single LE-byte scalars by the Compact compiler.
// Player{gold: Uint<32>, rng: Bytes<32>} → gold is bits 0-31
// BattleState{round, deck_indices[3], damage_to_player, damage_to_enemy_0/1/2,
//             enemy_move_index_0/1/2} → all Uint<32>, each 32 bits
// BattleConfig{level, enemies, player_pub_key, loadout} → packed, config is huge
// QuestConfig{level, player_pub_key, loadout, start_time} → packed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Packed struct helpers
// ---------------------------------------------------------------------------

/** Extract a 32-bit unsigned field from a packed LE bigint at a given field index (0-based). */
function extractU32(packed: bigint, fieldIndex: number): number {
  return Number((packed >> BigInt(fieldIndex * 32)) & 0xFFFFFFFFn);
}

/** Extract a single byte from a packed LE bigint at a given byte offset. */
function extractByte(packed: bigint, byteOffset: number): number {
  return Number((packed >> BigInt(byteOffset * 8)) & 0xFFn);
}

/** Extract a 32-bit LE value from a packed bigint at a given byte offset. */
function extractU32AtByte(packed: bigint, byteOffset: number): number {
  return Number((packed >> BigInt(byteOffset * 8)) & 0xFFFFFFFFn);
}

// ---------------------------------------------------------------------------
// Ability struct extraction (31 bytes, LE packed)
// ---------------------------------------------------------------------------
// Byte layout (from Compact compiled alignment):
//   [0]     effect.is_some     (1 byte, Boolean)
//   [1]     effect.effect_type (1 byte, EFFECT_TYPE enum: 0=phys, 1=fire, 2=ice, 3=block)
//   [2-5]   effect.amount      (4 bytes, Uint<32> LE)
//   [6]     effect.is_aoe      (1 byte, Boolean)
//   [7-13]  on_energy[0]       (Maybe<Effect>, 7 bytes)
//   [14-20] on_energy[1]       (Maybe<Effect>, 7 bytes)
//   [21-27] on_energy[2]       (Maybe<Effect>, 7 bytes)
//   [28]    generate_color.is_some (1 byte)
//   [29]    generate_color.value   (1 byte, Uint<0..5>)
//   [30]    upgrade_level          (1 byte, Uint<0..5>)

interface ParsedAbility {
  hasEffect: boolean;
  effectType: number;  // 0=phys, 1=fire, 2=ice, 3=block
  effectAmount: number;
  isAoe: boolean;
  onEnergy: Array<{ hasEffect: boolean; effectType: number; effectAmount: number; isAoe: boolean }>;
  hasGenerateColor: boolean;
  generateColor: number;
  upgradeLevel: number;
}

function parseAbility(packed: bigint): ParsedAbility {
  const hasEffect = extractByte(packed, 0) !== 0;
  const effectType = extractByte(packed, 1);
  const effectAmount = extractU32AtByte(packed, 2);
  const isAoe = extractByte(packed, 6) !== 0;

  const onEnergy: ParsedAbility["onEnergy"] = [];
  for (let i = 0; i < 3; i++) {
    const base = 7 + i * 7;
    onEnergy.push({
      hasEffect: extractByte(packed, base) !== 0,
      effectType: extractByte(packed, base + 1),
      effectAmount: extractU32AtByte(packed, base + 2),
      isAoe: extractByte(packed, base + 6) !== 0,
    });
  }

  return {
    hasEffect,
    effectType,
    effectAmount,
    isAoe,
    onEnergy,
    hasGenerateColor: extractByte(packed, 28) !== 0,
    generateColor: extractByte(packed, 29),
    upgradeLevel: extractByte(packed, 30),
  };
}

/** Parse all abilities from the raw all_abilities map. */
function parseAllAbilities(allAbilities: Record<string, any>): Map<string, ParsedAbility> {
  const result = new Map<string, ParsedAbility>();
  for (const [abilityId, value] of Object.entries(allAbilities)) {
    result.set(abilityId, parseAbility(toBigInt(value)));
  }
  return result;
}

// ---------------------------------------------------------------------------
// BattleConfig loadout extraction (7 ability Field IDs)
// ---------------------------------------------------------------------------
// BattleConfig byte layout:
//   [0-7]     Level: biome(4) + difficulty(4)
//   [8-236]   EnemiesConfig: Vector<3, EnemyStats>(3×76) + count(1) = 229 bytes
//   [237-268] player_pub_key: Field (32 bytes)
//   [269-492] loadout: Vector<7, Field> (7×32 = 224 bytes)
//
// EnemyStats (76 bytes): boss_type(1) + enemy_type(4) + hp(4) +
//   moves(Vector<3, EnemyMove>)(3×20) + move_count(4) +
//   physical_def(1) + fire_def(1) + ice_def(1)
// EnemyMove (20 bytes): attack(4) + block_self(4) + block_allies(4) +
//   heal_self(4) + heal_allies(4)

const BATTLE_CONFIG_PUBKEY_START_BYTE = 237;  // 8 (Level) + 229 (EnemiesConfig)
const BATTLE_CONFIG_LOADOUT_START_BYTE = 269; // 237 + 32 (player_pub_key)
const FIELD_SIZE_BYTES = 32;
const FIELD_MASK_256 = (1n << 256n) - 1n;

/** Path B: extract player_pub_key from packed BattleConfig via byte offset.
 *  Note: this assumes the player_pub_key Field chunk is exactly 32 bytes. The
 *  Compact runtime trims trailing zero bytes from each Field atom (and decodeCell
 *  does NOT pad Field atoms, only `tag === 'bytes'` atoms), so a player_pub_key
 *  whose Fr value happens to have a high zero byte will read across the loadout
 *  boundary. Path A's descriptor walk catches this — see the warn logs. */
function extractPlayerPubKeyFromBattleConfig(configPacked: bigint): bigint {
  const bitOffset = BigInt(BATTLE_CONFIG_PUBKEY_START_BYTE * 8);
  return (configPacked >> bitOffset) & FIELD_MASK_256;
}

function extractLoadoutFromBattleConfig(configPacked: bigint): string[] {
  const loadout: string[] = [];
  for (let i = 0; i < 7; i++) {
    const bitOffset = BigInt((BATTLE_CONFIG_LOADOUT_START_BYTE + i * FIELD_SIZE_BYTES) * 8);
    const fieldVal = (configPacked >> bitOffset) & FIELD_MASK_256;
    // Indexer Field map keys are LE-byte hex, zero-padded to 32 bytes (see
    // hexToBech32 above). The extracted bigint is BE-natural, so reverse the
    // byte pairs and pad so lookups into allAbilities hit.
    const hexBE = fieldVal.toString(16).padStart(64, "0");
    const hexLE = hexBE.match(/.{2}/g)!.reverse().join("");
    loadout.push("0x" + hexLE);
  }
  return loadout;
}

// ---------------------------------------------------------------------------
// Path A: contract-derived type descriptors (BattleConfig / BattleState)
//
// Recreated from the compiled contract at
//   backend/packages/midnight/contract-game2/src/managed/game2/contract/index.js
// using @midnight-ntwrk/compact-runtime types. We can't `import` _descriptor_*
// directly because that file is regenerated by `npm run compact` and the
// internal `_descriptor_NN` consts are not exported. If you change the contract
// struct shapes, mirror the changes here and the syncBattles A-vs-B compare
// will yell loudly until they line up.
//
// Layout (matching _BattleConfig_0 / _BattleState_0 in index.js):
//   BattleConfig = Level + EnemiesConfig + player_pub_key:Field + PlayerLoadout
//   BattleState  = round + deck_indices(3) + dmg_player + dmg_e0..2 + move_idx0..2
// ---------------------------------------------------------------------------

const t_Field = CompactTypeField;                                          // _descriptor_0
const t_Uint32 = new CompactTypeUnsignedInteger(4294967295n, 4);           // _descriptor_1
const t_BossEnum = new CompactTypeEnum(2, 1);                              // _descriptor_4
const t_Uint8Max4 = new CompactTypeUnsignedInteger(4n, 1);                 // _descriptor_7

const t_Level = {
  alignment: () => t_Uint32.alignment().concat(t_Uint32.alignment()),
  fromValue: (v: any) => ({
    biome: t_Uint32.fromValue(v),
    difficulty: t_Uint32.fromValue(v),
  }),
};

// Note: CompactTypeVector requires a full CompactType (with `toValue`). We
// only ever decode here, so we cast to `any` to avoid duplicating toValue stubs.
const t_EnemyMove = {
  alignment: () =>
    t_Uint32.alignment()
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment()),
  fromValue: (v: any) => ({
    attack: t_Uint32.fromValue(v),
    block_self: t_Uint32.fromValue(v),
    block_allies: t_Uint32.fromValue(v),
    heal_self: t_Uint32.fromValue(v),
    heal_allies: t_Uint32.fromValue(v),
  }),
  toValue: (_v: any): any => { throw new Error("not implemented"); },
};
const t_EnemyMoves = new CompactTypeVector(3, t_EnemyMove as any);

const t_EnemyStats = {
  alignment: () =>
    t_BossEnum.alignment()
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_EnemyMoves.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint8Max4.alignment())
      .concat(t_Uint8Max4.alignment())
      .concat(t_Uint8Max4.alignment()),
  fromValue: (v: any) => ({
    boss_type: t_BossEnum.fromValue(v),
    enemy_type: t_Uint32.fromValue(v),
    hp: t_Uint32.fromValue(v),
    moves: t_EnemyMoves.fromValue(v),
    move_count: t_Uint32.fromValue(v),
    physical_def: t_Uint8Max4.fromValue(v),
    fire_def: t_Uint8Max4.fromValue(v),
    ice_def: t_Uint8Max4.fromValue(v),
  }),
  toValue: (_v: any): any => { throw new Error("not implemented"); },
};
const t_EnemyStatsList = new CompactTypeVector(3, t_EnemyStats as any);

const t_EnemiesConfig = {
  alignment: () => t_EnemyStatsList.alignment().concat(t_Uint8Max4.alignment()),
  fromValue: (v: any) => ({
    stats: t_EnemyStatsList.fromValue(v),
    count: t_Uint8Max4.fromValue(v),
  }),
};

const t_LoadoutAbilities = new CompactTypeVector(7, t_Field);
const t_PlayerLoadout = {
  alignment: () => t_LoadoutAbilities.alignment(),
  fromValue: (v: any) => ({
    abilities: t_LoadoutAbilities.fromValue(v) as bigint[],
  }),
};

const t_BattleConfig = {
  alignment: () =>
    t_Level.alignment()
      .concat(t_EnemiesConfig.alignment())
      .concat(t_Field.alignment())
      .concat(t_PlayerLoadout.alignment()),
  fromValue: (v: any) => ({
    level: t_Level.fromValue(v),
    enemies: t_EnemiesConfig.fromValue(v),
    player_pub_key: t_Field.fromValue(v) as bigint,
    loadout: t_PlayerLoadout.fromValue(v),
  }),
};

const t_DeckIndices = new CompactTypeVector(3, t_Uint32);
const t_BattleState = {
  alignment: () =>
    t_Uint32.alignment()
      .concat(t_DeckIndices.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment())
      .concat(t_Uint32.alignment()),
  fromValue: (v: any) => ({
    round: t_Uint32.fromValue(v),
    deck_indices: t_DeckIndices.fromValue(v),
    damage_to_player: t_Uint32.fromValue(v),
    damage_to_enemy_0: t_Uint32.fromValue(v),
    damage_to_enemy_1: t_Uint32.fromValue(v),
    damage_to_enemy_2: t_Uint32.fromValue(v),
    enemy_move_index_0: t_Uint32.fromValue(v),
    enemy_move_index_1: t_Uint32.fromValue(v),
    enemy_move_index_2: t_Uint32.fromValue(v),
  }),
};

interface ParsedBattleConfig {
  level: { biome: bigint; difficulty: bigint };
  enemies: any;
  player_pub_key: bigint;
  loadout: { abilities: bigint[] };
}
interface ParsedBattleState {
  round: bigint;
  deck_indices: bigint[];
  damage_to_player: bigint;
  damage_to_enemy_0: bigint;
  damage_to_enemy_1: bigint;
  damage_to_enemy_2: bigint;
  enemy_move_index_0: bigint;
  enemy_move_index_1: bigint;
  enemy_move_index_2: bigint;
}

function parseBattleConfigA(atoms: Uint8Array[] | null): ParsedBattleConfig | null {
  if (!atoms) return null;
  try {
    return t_BattleConfig.fromValue([...atoms]) as ParsedBattleConfig;
  } catch (e) {
    console.warn(`[game-db] Path A BattleConfig parse failed:`, e);
    return null;
  }
}
function parseBattleStateA(atoms: Uint8Array[] | null): ParsedBattleState | null {
  if (!atoms) return null;
  try {
    return t_BattleState.fromValue([...atoms]) as ParsedBattleState;
  } catch (e) {
    console.warn(`[game-db] Path A BattleState parse failed:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cell-wrapper helpers
//
// Multi-atom struct cells are emitted by parseStateValue (main.ts) as
//   { __cell: true, packed: bigint|number|string, atomsHex: string[] }
// after surviving the framework's JSON.parse(JSON.stringify(...)) roundtrip.
// Single-atom scalars (Field, Uint<N>, Boolean, Bytes<N> by themselves)
// remain primitives.
// ---------------------------------------------------------------------------

interface WrappedCell {
  __cell: true;
  packed: bigint | number | string;
  atomsHex: string[];
}

function isWrappedCell(value: unknown): value is WrappedCell {
  return value !== null
    && typeof value === "object"
    && (value as { __cell?: unknown }).__cell === true;
}

/** Decode the hex-encoded atoms back to Uint8Array[] for descriptor parsing. */
function getCellAtoms(value: unknown): Uint8Array[] | null {
  if (!isWrappedCell(value)) return null;
  return value.atomsHex.map(hexToUint8Array);
}

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return out;
}

/** Safely convert a value (number, bigint, string, or wrapped cell) to BigInt. */
function toBigInt(value: any): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (isWrappedCell(value)) return toBigInt(value.packed);
  return 0n;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureTables(db: any): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_players (
      player_id       TEXT PRIMARY KEY,
      gold            BIGINT NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_player_abilities (
      player_id       TEXT NOT NULL,
      ability_id      TEXT NOT NULL,
      quantity        INTEGER NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, ability_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_boss_progress (
      player_id       TEXT NOT NULL,
      biome           BIGINT NOT NULL,
      difficulty      BIGINT NOT NULL,
      completed       BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, biome, difficulty)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_battles (
      battle_id           TEXT PRIMARY KEY,
      player_id           TEXT NOT NULL,
      biome               BIGINT NOT NULL,
      difficulty          BIGINT NOT NULL,
      round               BIGINT NOT NULL DEFAULT 0,
      damage_to_player    BIGINT NOT NULL DEFAULT 0,
      damage_to_enemy_0   BIGINT NOT NULL DEFAULT 0,
      damage_to_enemy_1   BIGINT NOT NULL DEFAULT 0,
      damage_to_enemy_2   BIGINT NOT NULL DEFAULT 0,
      raw_state           TEXT,
      raw_config          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_quests (
      quest_id        TEXT PRIMARY KEY,
      player_id       TEXT NOT NULL,
      biome           BIGINT NOT NULL,
      difficulty      BIGINT NOT NULL,
      start_time      BIGINT NOT NULL,
      raw_config      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Track completed battles (wins/losses) for leaderboard scoring
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_battle_results (
      battle_id       TEXT PRIMARY KEY,
      player_id       TEXT NOT NULL,
      biome           BIGINT NOT NULL,
      difficulty      BIGINT NOT NULL,
      won             BOOLEAN NOT NULL,
      is_boss         BOOLEAN NOT NULL DEFAULT FALSE,
      points          INTEGER NOT NULL DEFAULT 0,
      ended_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Add columns for existing databases (no-op on fresh installs)
  await db.query(`ALTER TABLE d2d_battle_results ADD COLUMN IF NOT EXISTS is_boss BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE d2d_battle_results ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0`);

  // Delegation mapping: game address -> wallet address
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_delegations (
      from_address    TEXT PRIMARY KEY,
      to_address      TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Player stats (DB counters tracked via payload diffs)
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_player_stats (
      player_id           TEXT PRIMARY KEY,
      quests_completed    INTEGER NOT NULL DEFAULT 0,
      quests_failed       INTEGER NOT NULL DEFAULT 0,
      bosses_defeated     INTEGER NOT NULL DEFAULT 0,
      battles_won         INTEGER NOT NULL DEFAULT 0,
      battles_retreated   INTEGER NOT NULL DEFAULT 0,
      enemies_defeated    INTEGER NOT NULL DEFAULT 0,
      rounds_played       INTEGER NOT NULL DEFAULT 0,
      total_gold_earned   BIGINT NOT NULL DEFAULT 0,
      total_gold_spent    BIGINT NOT NULL DEFAULT 0,
      abilities_upgraded  INTEGER NOT NULL DEFAULT 0,
      abilities_sold      INTEGER NOT NULL DEFAULT 0,
      boss_win_streak     INTEGER NOT NULL DEFAULT 0,
      total_damage_dealt  BIGINT NOT NULL DEFAULT 0,
      phys_sold           INTEGER NOT NULL DEFAULT 0,
      fire_sold           INTEGER NOT NULL DEFAULT 0,
      ice_sold            INTEGER NOT NULL DEFAULT 0,
      block_sold          INTEGER NOT NULL DEFAULT 0,
      phys_upgraded       INTEGER NOT NULL DEFAULT 0,
      fire_upgraded       INTEGER NOT NULL DEFAULT 0,
      ice_upgraded        INTEGER NOT NULL DEFAULT 0,
      block_upgraded      INTEGER NOT NULL DEFAULT 0,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Track pending boss fights (quest finalized → boss battle in progress)
  // Used to detect losses and retreats when the battle resolves
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_pending_boss_fights (
      player_id       TEXT NOT NULL,
      biome           BIGINT NOT NULL,
      difficulty      BIGINT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, biome, difficulty)
    )
  `);

  // Track failed boss fights per player (for Persistence achievement)
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_boss_failures (
      player_id       TEXT NOT NULL,
      biome           BIGINT NOT NULL,
      difficulty      BIGINT NOT NULL,
      failed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, biome, difficulty)
    )
  `);

  // Achievement definitions (populated by migration)
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_achievements (
      name            TEXT PRIMARY KEY,
      display_name    TEXT NOT NULL,
      description     TEXT NOT NULL,
      category        TEXT NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  // Player achievements (unlocked)
  await db.query(`
    CREATE TABLE IF NOT EXISTS d2d_player_achievements (
      player_id       TEXT NOT NULL,
      achievement     TEXT NOT NULL REFERENCES d2d_achievements(name),
      unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, achievement)
    )
  `);

}

// ---------------------------------------------------------------------------
// Payload extraction
// ---------------------------------------------------------------------------

interface PayloadIndices {
  allAbilities: Record<string, any>;
  players: Record<string, any>;
  playerAbilities: Record<string, any>;
  playerBossProgress: Record<string, any>;
  activeBattleStates: Record<string, any>;
  activeBattleConfigs: Record<string, any>;
  quests: Record<string, any>;
  delegations: Record<string, any>;
}

let indicesLogged = false;
let debugDumped = false;

// Opt-in verbose debug logging. Set GAME_DB_DEBUG=1 in the node env to enable
// the full per-block payload dump and map-indices summary. Otherwise the node
// runs quiet in steady state.
const DEBUG_ENABLED = Deno.env.get("GAME_DB_DEBUG") === "1";

function extractMaps(payload: any): PayloadIndices | null {
  // Full payload dump — opt-in, first block only. The dump is ~40KB with
  // atomsHex arrays, so it's only useful when actively debugging a parsing
  // issue. Re-enable by setting GAME_DB_DEBUG=1.
  if (DEBUG_ENABLED && !debugDumped) {
    debugDumped = true;
    console.log("[game-db] DEBUG — raw payload structure:");
    const replacer = (_key: string, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value;
    console.log(JSON.stringify(payload, replacer, 2));
  }

  // Flatten payload entries (payload is { "0": [...], "1": [...] })
  const allEntries: any[] = [];
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const keys = Object.keys(payload).sort((a, b) => Number(a) - Number(b));
    for (const key of keys) {
      const val = payload[key];
      if (Array.isArray(val)) {
        allEntries.push(...val);
      } else {
        allEntries.push(val);
      }
    }
  } else if (Array.isArray(payload)) {
    for (const item of payload) {
      if (Array.isArray(item)) allEntries.push(...item);
      else allEntries.push(item);
    }
  }

  // Collect map-like objects (non-null, non-array, non-cell-wrapper) in order.
  // Wrapped cells (multi-atom struct scalars) look like objects but are not maps.
  const maps: Record<string, any>[] = [];
  for (const entry of allEntries) {
    if (
      entry !== null
      && typeof entry === "object"
      && !Array.isArray(entry)
      && !isWrappedCell(entry)
    ) {
      maps.push(entry);
    }
  }

  if (DEBUG_ENABLED && !indicesLogged) {
    indicesLogged = true;
    console.log(`[game-db] Found ${maps.length} map entries in payload, ${allEntries.length} total entries`);
    for (let i = 0; i < maps.length; i++) {
      console.log(`[game-db]   map[${i}]: ${Object.keys(maps[i]).length} keys`);
    }
  }

  if (maps.length < 7) {
    console.warn(`[game-db] Expected at least 7 maps in payload, got ${maps.length}. Skipping.`);
    return null;
  }

  // Verified map indices (see layout comment at top of file):
  //   map[0] = all_abilities        (8 keys)
  //   map[1] = active_battle_states (1 key)
  //   map[2] = active_battle_configs(1 key)
  //   map[3] = quests               (0 keys)
  //   map[4] = players              (1 key)
  //   map[5] = player_abilities     (1 key, nested maps)
  //   map[6] = player_boss_progress (1 key, nested maps)
  //   map[7] = levels               (12 keys)
  //   map[8] = bosses               (12 keys)
  //   map[9] = quest_durations
  //   map[10] = delegations
  return {
    allAbilities: maps[0] ?? {},
    activeBattleStates: maps[1] ?? {},
    activeBattleConfigs: maps[2] ?? {},
    quests: maps[3] ?? {},
    players: maps[4] ?? {},
    playerAbilities: maps[5] ?? {},
    playerBossProgress: maps[6] ?? {},
    delegations: maps[10] ?? {},
  };
}

// ---------------------------------------------------------------------------
// Snapshot deduplication
// ---------------------------------------------------------------------------

let lastSnapshotKey: string | null = null;

// ---------------------------------------------------------------------------
// Ledger snapshot processing
// ---------------------------------------------------------------------------

export async function processLedgerSnapshot(db: any, payload: any): Promise<void> {
  const extracted = extractMaps(payload);
  if (!extracted) return;

  const { allAbilities, players, playerAbilities, playerBossProgress, activeBattleStates, activeBattleConfigs, quests, delegations } = extracted;

  // Dedup: skip if nothing changed. Collapse wrapped cells to their packed
  // value so the snapshot key doesn't bloat with the per-atom hex array.
  const replacer = (_key: string, value: unknown) => {
    if (typeof value === "bigint") return value.toString();
    if (isWrappedCell(value)) {
      const p = value.packed;
      return typeof p === "bigint" ? p.toString() : p;
    }
    return value;
  };
  const snapshotKey = JSON.stringify({ players, activeBattleStates, quests, delegations }, replacer);
  if (snapshotKey === lastSnapshotKey) return;
  lastSnapshotKey = snapshotKey;

  const parsedAbilities = parseAllAbilities(allAbilities);

  // Capture old gold before syncPlayers mutates it, then derive gold delta per
  // player vs the snapshot. syncPlayerAbilities uses this to gate sell detection
  // — a sell is the only circuit that increases gold AND decreases inventory in
  // the same transition, so we only count inventory decreases as sells when the
  // player's gold also went up. Battles/quests decrease inventory (verify_loadout)
  // without touching gold; upgrades decrease both inventory and gold; rewards
  // increase gold without decreasing inventory — none of those get counted.
  const { rows: prevPlayerRows } = await db.query(
    `SELECT player_id, gold FROM d2d_players`,
  ) as { rows: Array<{ player_id: string; gold: string | number }> };
  const oldGoldByPlayer = new Map<string, number>(
    prevPlayerRows.map((r) => [r.player_id, Number(r.gold)]),
  );
  const goldDeltaByPlayer = new Map<string, number>();
  for (const [hexKey, val] of Object.entries(players)) {
    const playerId = hexToBech32(hexKey);
    const newGold = extractU32(toBigInt(val), 0);
    const oldGold = oldGoldByPlayer.get(playerId) ?? 0;
    goldDeltaByPlayer.set(playerId, newGold - oldGold);
  }

  await syncPlayers(db, players);
  await syncPlayerAbilities(db, playerAbilities, parsedAbilities, goldDeltaByPlayer);
  const newBossCompletions = await syncBossProgress(db, playerBossProgress);
  await syncBattles(db, activeBattleStates, activeBattleConfigs, newBossCompletions, parsedAbilities);
  await syncQuests(db, quests);
  await syncDelegations(db, delegations);
  await trackAbilityUpgrades(db, allAbilities, playerAbilities);
}

// Track new ability IDs in all_abilities as upgrades. The upgrader is the
// player whose player_abilities map contains the new ability ID after the
// snapshot — `upgrade_ability` removes the old ID and inserts the new one
// into exactly one player's inventory. New IDs that nobody owns (e.g.
// admin_register_ability) are skipped.
let previousAbilityIds: Set<string> | null = null;

async function trackAbilityUpgrades(
  db: any,
  allAbilities: Record<string, any>,
  playerAbilities: Record<string, any>,
): Promise<void> {
  const currentIds = new Set(Object.keys(allAbilities));
  if (previousAbilityIds === null) {
    previousAbilityIds = currentIds;
    return;
  }
  const newIds = [...currentIds].filter((id) => !previousAbilityIds!.has(id));
  previousAbilityIds = currentIds;
  if (newIds.length === 0) return;

  // Build a quick lookup: ability_id -> owning player (bech32). For each new
  // ability ID, find the single player who has it in their inventory.
  const ownerOf = (abilityId: string): string | null => {
    for (const [playerHex, abilities] of Object.entries(playerAbilities)) {
      if (abilities && typeof abilities === "object" && !Array.isArray(abilities)) {
        const qty = (abilities as Record<string, any>)[abilityId];
        if (qty != null) {
          // Could be a number, bigint, string, or wrapped cell — any non-null
          // entry means the player has at least one of this ability.
          return hexToBech32(playerHex);
        }
      }
    }
    return null;
  };

  // Aggregate per-player upgrade counts
  type UpgradeAgg = { total: number; byType: [number, number, number, number] };
  const perPlayer = new Map<string, UpgradeAgg>();
  for (const id of newIds) {
    const playerId = ownerOf(id);
    if (!playerId) continue; // admin register or stray — not an upgrade
    const ability = parseAbility(toBigInt(allAbilities[id]));
    if (!ability.hasEffect) continue;
    const agg = perPlayer.get(playerId) ?? { total: 0, byType: [0, 0, 0, 0] };
    agg.total += 1;
    agg.byType[ability.effectType] += 1;
    perPlayer.set(playerId, agg);
  }

  for (const [playerId, agg] of perPlayer) {
    const { rows } = await db.query(
      `INSERT INTO d2d_player_stats (player_id, abilities_upgraded, phys_upgraded, fire_upgraded, ice_upgraded, block_upgraded)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (player_id) DO UPDATE
         SET abilities_upgraded = d2d_player_stats.abilities_upgraded + $2,
             phys_upgraded = d2d_player_stats.phys_upgraded + $3,
             fire_upgraded = d2d_player_stats.fire_upgraded + $4,
             ice_upgraded = d2d_player_stats.ice_upgraded + $5,
             block_upgraded = d2d_player_stats.block_upgraded + $6,
             updated_at = now()
       RETURNING abilities_upgraded, phys_upgraded, fire_upgraded, ice_upgraded, block_upgraded`,
      [playerId, agg.total, agg.byType[0], agg.byType[1], agg.byType[2], agg.byType[3]],
    ) as { rows: Array<{ abilities_upgraded: number; phys_upgraded: number; fire_upgraded: number; ice_upgraded: number; block_upgraded: number }> };
    console.log(`[game-db] Player ${playerId.slice(0, 18)}... upgraded ${agg.total} (phys=${agg.byType[0]} fire=${agg.byType[1]} ice=${agg.byType[2]} block=${agg.byType[3]}), totals: upg=${rows[0].abilities_upgraded}`);
    await checkUpgradeAchievements(db, playerId, rows[0]);
  }
}

// ---------------------------------------------------------------------------
// Sync: Players
// ---------------------------------------------------------------------------

async function syncPlayers(
  db: any,
  playersMap: Record<string, any>,
): Promise<void> {
  const entries = Object.entries(playersMap);
  if (entries.length === 0) return;

  // Player is a packed struct: { gold: Uint<32>, rng: Bytes<32> }
  // gold occupies bits 0-31 of the packed LE value
  const parsed = entries.map(([hexKey, value]) => {
    const packed = toBigInt(value);
    const gold = extractU32(packed, 0);
    return { playerId: hexToBech32(hexKey), gold };
  });

  // Fetch known
  const ids = parsed.map((p) => p.playerId);
  const { rows: knownRows } = await db.query(
    `SELECT player_id, gold FROM d2d_players WHERE player_id = ANY($1)`,
    [ids],
  ) as { rows: Array<{ player_id: string; gold: number }> };
  const known = new Map(knownRows.map((r: any) => [r.player_id, Number(r.gold)]));

  // Diff
  const toUpsert = parsed.filter(
    (p) => known.get(p.playerId) === undefined || known.get(p.playerId) !== p.gold,
  );

  if (toUpsert.length === 0) return;

  const placeholders = toUpsert
    .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::bigint)`)
    .join(", ");
  const values = toUpsert.flatMap((p) => [p.playerId, String(p.gold)]);

  await db.query(
    `INSERT INTO d2d_players (player_id, gold)
     VALUES ${placeholders}
     ON CONFLICT (player_id) DO UPDATE
       SET gold = EXCLUDED.gold,
           updated_at = now()`,
    values,
  );

  // Track gold changes for economy achievements
  for (const p of toUpsert) {
    const oldGold = known.get(p.playerId);
    if (oldGold !== undefined) {
      const delta = p.gold - oldGold;
      if (delta > 0) {
        // Gold earned — pass as string to avoid pg int4 overflow
        const { rows } = await db.query(
          `INSERT INTO d2d_player_stats (player_id, total_gold_earned)
           VALUES ($1, $2::bigint)
           ON CONFLICT (player_id) DO UPDATE
             SET total_gold_earned = d2d_player_stats.total_gold_earned + $2::bigint,
                 updated_at = now()
           RETURNING total_gold_earned`,
          [p.playerId, String(delta)],
        ) as { rows: Array<{ total_gold_earned: number }> };
        await checkGoldEarnedAchievements(db, p.playerId, rows[0].total_gold_earned);
      } else if (delta < 0) {
        // Gold spent — pass as string to avoid pg int4 overflow
        const spent = -delta;
        const { rows } = await db.query(
          `INSERT INTO d2d_player_stats (player_id, total_gold_spent)
           VALUES ($1, $2::bigint)
           ON CONFLICT (player_id) DO UPDATE
             SET total_gold_spent = d2d_player_stats.total_gold_spent + $2::bigint,
                 updated_at = now()
           RETURNING total_gold_spent`,
          [p.playerId, String(spent)],
        ) as { rows: Array<{ total_gold_spent: number }> };
        await checkGoldSpentAchievements(db, p.playerId, rows[0].total_gold_spent);
      }
    }
  }

  console.log(`[game-db] Upserted ${toUpsert.length} player(s)`);
}

// ---------------------------------------------------------------------------
// Sync: Player Abilities
// ---------------------------------------------------------------------------

async function syncPlayerAbilities(
  db: any,
  abilitiesMap: Record<string, any>,
  parsedAbilities: Map<string, ParsedAbility>,
  goldDeltaByPlayer: Map<string, number>,
): Promise<void> {
  // abilitiesMap: hexPlayerId -> { abilityId -> quantity }
  const entries: Array<{ playerId: string; abilityId: string; quantity: number }> = [];

  for (const [hexKey, innerMap] of Object.entries(abilitiesMap)) {
    const playerId = hexToBech32(hexKey);
    if (innerMap && typeof innerMap === "object" && !Array.isArray(innerMap)) {
      for (const [abilityId, qty] of Object.entries(innerMap)) {
        entries.push({ playerId, abilityId, quantity: Number(qty) });
      }
    }
  }

  if (entries.length === 0) return;

  // Fetch known
  const playerIds = [...new Set(entries.map((e) => e.playerId))];
  const { rows: knownRows } = await db.query(
    `SELECT player_id, ability_id, quantity FROM d2d_player_abilities WHERE player_id = ANY($1)`,
    [playerIds],
  ) as { rows: Array<{ player_id: string; ability_id: string; quantity: number }> };
  const knownMap = new Map(
    knownRows.map((r: any) => [`${r.player_id}:${r.ability_id}`, Number(r.quantity)]),
  );

  // Diff
  const toUpsert = entries.filter(
    (e) => knownMap.get(`${e.playerId}:${e.abilityId}`) !== e.quantity,
  );

  if (toUpsert.length === 0) return;

  const placeholders = toUpsert
    .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
    .join(", ");
  const values = toUpsert.flatMap((e) => [e.playerId, e.abilityId, e.quantity]);

  await db.query(
    `INSERT INTO d2d_player_abilities (player_id, ability_id, quantity)
     VALUES ${placeholders}
     ON CONFLICT (player_id, ability_id) DO UPDATE
       SET quantity = EXCLUDED.quantity,
           updated_at = now()`,
    values,
  );

  // Remove abilities no longer on-chain for these players
  const onChainKeys = new Set(entries.map((e) => `${e.playerId}:${e.abilityId}`));
  const toDelete = knownRows.filter(
    (r: any) => !onChainKeys.has(`${r.player_id}:${r.ability_id}`) && playerIds.includes(r.player_id),
  );
  if (toDelete.length > 0) {
    for (const row of toDelete) {
      await db.query(
        `DELETE FROM d2d_player_abilities WHERE player_id = $1 AND ability_id = $2`,
        [row.player_id, row.ability_id],
      );
    }
  }

  // Track ability sells by type: abilities whose quantity decreased
  //
  // Signal: sell_ability is the only circuit that both increases gold AND
  // decreases inventory in the same transition. verify_loadout (battle/quest
  // start) decreases inventory without touching gold, upgrade_ability decreases
  // both, and battle rewards increase gold without decreasing inventory. So we
  // only count inventory decreases as sells when the player's gold ALSO went
  // up in the same snapshot. This keeps battles/quests out of sell accounting
  // entirely, which is the desired semantics.
  for (const playerId of playerIds) {
    const goldDelta = goldDeltaByPlayer.get(playerId) ?? 0;
    if (goldDelta <= 0) continue; // no sell possible without a gold increase

    let soldCount = 0;
    const soldByType = [0, 0, 0, 0]; // phys, fire, ice, block
    // knownRows is the DB pre-state. Walking it covers both "quantity dropped"
    // and "row fully removed" cases in one pass: for fully-removed rows,
    // entries.find() returns undefined, currentQty is 0, and the full oldQty
    // is counted. A second pass over toDelete would double-count every removal.
    for (const known of knownRows.filter((r: any) => r.player_id === playerId)) {
      const currentEntry = entries.find((e) => e.playerId === playerId && e.abilityId === known.ability_id);
      const currentQty = currentEntry?.quantity ?? 0;
      const oldQty = Number(known.quantity);
      if (currentQty < oldQty) {
        const delta = oldQty - currentQty;
        soldCount += delta;
        const ability = parsedAbilities.get(known.ability_id);
        if (ability?.hasEffect) soldByType[ability.effectType] += delta;
      }
    }
    if (soldCount > 0) {
      const { rows } = await db.query(
        `INSERT INTO d2d_player_stats (player_id, abilities_sold, phys_sold, fire_sold, ice_sold, block_sold)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (player_id) DO UPDATE
           SET abilities_sold = d2d_player_stats.abilities_sold + $2,
               phys_sold = d2d_player_stats.phys_sold + $3,
               fire_sold = d2d_player_stats.fire_sold + $4,
               ice_sold = d2d_player_stats.ice_sold + $5,
               block_sold = d2d_player_stats.block_sold + $6,
               updated_at = now()
         RETURNING abilities_sold, phys_sold, fire_sold, ice_sold, block_sold`,
        [playerId, soldCount, soldByType[0], soldByType[1], soldByType[2], soldByType[3]],
      ) as { rows: Array<{ abilities_sold: number; phys_sold: number; fire_sold: number; ice_sold: number; block_sold: number }> };
      await checkSellAchievements(db, playerId, rows[0]);
    }
  }

  console.log(`[game-db] Upserted ${toUpsert.length} player ability entries, removed ${toDelete.length}`);

  // Check spirit collection achievements per player
  for (const playerId of playerIds) {
    const playerEntries = entries.filter((e) => e.playerId === playerId);
    await checkSpiritCollectionAchievements(db, playerId, playerEntries, parsedAbilities);
  }
}

// ---------------------------------------------------------------------------
// Sync: Boss Progress
// ---------------------------------------------------------------------------

type BossCompletion = { playerId: string; biome: number; difficulty: number };

async function syncBossProgress(
  db: any,
  progressMap: Record<string, any>,
): Promise<BossCompletion[]> {
  // progressMap: hexPlayerId -> { biome -> { difficulty -> completed } }
  const entries: Array<{ playerId: string; biome: number; difficulty: number; completed: boolean }> = [];

  for (const [hexKey, biomeMap] of Object.entries(progressMap)) {
    const playerId = hexToBech32(hexKey);
    if (biomeMap && typeof biomeMap === "object" && !Array.isArray(biomeMap)) {
      for (const [biomeKey, diffMap] of Object.entries(biomeMap)) {
        if (diffMap && typeof diffMap === "object" && !Array.isArray(diffMap)) {
          for (const [diffKey, completed] of Object.entries(diffMap as Record<string, any>)) {
            // Keys are hex strings like "0x" (=0), "0x01" (=1) — parse with parseInt
            const biome = parseInt(biomeKey, 16) || 0;
            const difficulty = parseInt(diffKey, 16) || 0;
            entries.push({
              playerId,
              biome,
              difficulty,
              completed: Boolean(completed),
            });
          }
        }
      }
    }
  }

  if (entries.length === 0) return [];

  // Detect newly completed bosses (was false/missing, now true)
  let newBossCompletions: BossCompletion[] = [];
  const completedEntries = entries.filter((e) => e.completed);
  if (completedEntries.length > 0) {
    const playerIds = [...new Set(completedEntries.map((e) => e.playerId))];
    const { rows: existingRows } = await db.query(
      `SELECT player_id, biome, difficulty, completed FROM d2d_boss_progress WHERE player_id = ANY($1)`,
      [playerIds],
    ) as { rows: Array<{ player_id: string; biome: number; difficulty: number; completed: boolean }> };
    const existingSet = new Set(
      existingRows.filter((r: any) => r.completed).map((r: any) => `${r.player_id}:${r.biome}:${r.difficulty}`),
    );

    // Count new completions per player and collect for battle correlation
    const newCompletions = new Map<string, number>();
    for (const entry of completedEntries) {
      const key = `${entry.playerId}:${entry.biome}:${entry.difficulty}`;
      if (!existingSet.has(key)) {
        newCompletions.set(entry.playerId, (newCompletions.get(entry.playerId) ?? 0) + 1);
        newBossCompletions.push({ playerId: entry.playerId, biome: entry.biome, difficulty: entry.difficulty });
      }
    }

    // Increment quests_completed counters and check achievements
    for (const [playerId, count] of newCompletions) {
      const { rows } = await db.query(
        `INSERT INTO d2d_player_stats (player_id, quests_completed)
         VALUES ($1, $2)
         ON CONFLICT (player_id) DO UPDATE
           SET quests_completed = d2d_player_stats.quests_completed + $2,
               updated_at = now()
         RETURNING quests_completed`,
        [playerId, count],
      ) as { rows: Array<{ quests_completed: number }> };
      const total = rows[0].quests_completed;
      console.log(`[game-db] Player ${playerId.slice(0, 10)}... completed ${count} new quest(s), total: ${total}`);

      await checkQuestCompletionAchievements(db, playerId, total);
    }
  }

  const placeholders = entries
    .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(", ");
  const values = entries.flatMap((e) => [e.playerId, String(e.biome), String(e.difficulty), e.completed]);

  await db.query(
    `INSERT INTO d2d_boss_progress (player_id, biome, difficulty, completed)
     VALUES ${placeholders}
     ON CONFLICT (player_id, biome, difficulty) DO UPDATE
       SET completed = EXCLUDED.completed,
           updated_at = now()`,
    values,
  );

  // Check biome mastery achievements (snapshot-based, read fresh DB state)
  const playerIds = [...new Set(entries.map((e) => e.playerId))];
  for (const playerId of playerIds) {
    await checkBiomeMasteryAchievements(db, playerId);
  }

  return newBossCompletions;
}

// ---------------------------------------------------------------------------
// Boss point scoring
// ---------------------------------------------------------------------------

const BIOME_BASE_POINTS = [10, 20, 30, 50]; // grasslands, desert, tundra, cave

function calculateBossPoints(biome: number, difficulty: number): number {
  const base = BIOME_BASE_POINTS[biome] ?? 10;
  return base * Math.max(difficulty, 1);
}

// ---------------------------------------------------------------------------
// Record battle results (shared by both zero-active and normal paths)
// ---------------------------------------------------------------------------

type StaleBattle = {
  battle_id: string; player_id: string; biome: number; difficulty: number;
  round: number; damage_to_player: number;
  damage_to_enemy_0: number; damage_to_enemy_1: number; damage_to_enemy_2: number;
  raw_config: string;
};

async function recordBattleResults(
  db: any,
  staleBattles: StaleBattle[],
  newBossCompletions: BossCompletion[],
  parsedAbilities: Map<string, ParsedAbility>,
): Promise<void> {
  // Index boss completions by (player, level) so multi-player same-block
  // completions don't collide on a shared `biome:difficulty` key.
  const bossCompletionsByPlayerLevel = new Map<string, BossCompletion>();
  for (const bc of newBossCompletions) {
    bossCompletionsByPlayerLevel.set(`${bc.playerId}:${bc.biome}:${bc.difficulty}`, bc);
  }

  console.log(`[game-db] recordBattleResults: ${staleBattles.length} stale, ${newBossCompletions.length} boss completions`);

  for (const stale of staleBattles) {
    // syncBattles validates biome/difficulty and writes the real Bech32
    // player_id at insert time, so by the time a row reaches d2d_battles
    // these are guaranteed valid. No fallback heuristics needed.
    const playerId = stale.player_id;
    const biome = Number(stale.biome);
    const difficulty = Number(stale.difficulty);
    const totalDmg = Number(stale.damage_to_enemy_0) + Number(stale.damage_to_enemy_1) + Number(stale.damage_to_enemy_2);
    const dmgToPlayer = Number(stale.damage_to_player);
    const round = Number(stale.round);
    const playerLevelKey = `${playerId}:${biome}:${difficulty}`;
    const battleTag = stale.battle_id.slice(0, 16);

    const bossCompletion = bossCompletionsByPlayerLevel.get(playerLevelKey);
    const isBossFightWin = !!bossCompletion;

    // Was this a boss fight? Either we have a fresh completion or there's a
    // pending boss fight row for THIS player at THIS level. Looking up by
    // (player, biome, difficulty) — keyed on player_id from the post-1b fix —
    // is what stops the old "any retreat at any level for any player" false
    // positive that inflated battles_retreated.
    let wasBossFight = isBossFightWin;
    if (!wasBossFight) {
      const { rows: pendingRows } = await db.query(
        `SELECT 1 FROM d2d_pending_boss_fights WHERE player_id = $1 AND biome = $2 AND difficulty = $3`,
        [playerId, biome, difficulty],
      ) as { rows: Array<unknown> };
      wasBossFight = pendingRows.length > 0;
    }

    const configBigint = toBigInt(stale.raw_config ?? "0");

    if (isBossFightWin) {
      // ----- Boss won -----
      const points = calculateBossPoints(biome, difficulty);
      console.log(`[game-db]   battle ${battleTag}... BOSS WIN biome=${biome} diff=${difficulty} points=${points} player=${playerId.slice(0, 20)}...`);

      await db.query(
        `INSERT INTO d2d_battle_results (battle_id, player_id, biome, difficulty, won, is_boss, points)
         VALUES ($1, $2, $3, $4, TRUE, TRUE, $5)
         ON CONFLICT (battle_id) DO NOTHING`,
        [stale.battle_id, playerId, biome, difficulty, points],
      );
      await db.query(
        `INSERT INTO d2d_player_stats (player_id, bosses_defeated)
         VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE
           SET bosses_defeated = d2d_player_stats.bosses_defeated + 1,
               updated_at = now()`,
        [playerId],
      );
      await db.query(
        `DELETE FROM d2d_pending_boss_fights WHERE player_id = $1 AND biome = $2 AND difficulty = $3`,
        [playerId, biome, difficulty],
      );
      await checkBossCombatAchievements(db, playerId, dmgToPlayer, round, biome, difficulty);
      // Boss wins also count as battle wins
      await checkBattleWinAchievements(db, playerId, dmgToPlayer, round, totalDmg, configBigint, parsedAbilities);
      bossCompletionsByPlayerLevel.delete(playerLevelKey);
    } else if (wasBossFight) {
      // ----- Boss ended without a `newBossCompletions` entry -----
      // `newBossCompletions` only fires on a false→true transition of
      // player_boss_progress. A player re-beating a boss they already
      // cleared has the flag stay `true`, so the first-win branch never
      // fires for replay wins — they look identical to losses at this
      // point. Consult d2d_boss_progress: if the flag is already true and
      // the battle ended with damage dealt, it's a replay-win, not a loss.
      const { rows: progressRows } = await db.query(
        `SELECT 1 FROM d2d_boss_progress WHERE player_id = $1 AND biome = $2 AND difficulty = $3 AND completed = TRUE`,
        [playerId, biome, difficulty],
      ) as { rows: Array<unknown> };
      const wasAlreadyCompleted = progressRows.length > 0;

      if (wasAlreadyCompleted && totalDmg > 0) {
        // Replay-win: boss already cleared, damage dealt, battle ended.
        const points = calculateBossPoints(biome, difficulty);
        console.log(`[game-db]   battle ${battleTag}... BOSS REPLAY-WIN biome=${biome} diff=${difficulty} dmg=${totalDmg} points=${points} player=${playerId.slice(0, 20)}...`);

        await db.query(
          `INSERT INTO d2d_battle_results (battle_id, player_id, biome, difficulty, won, is_boss, points)
           VALUES ($1, $2, $3, $4, TRUE, TRUE, $5)
           ON CONFLICT (battle_id) DO NOTHING`,
          [stale.battle_id, playerId, biome, difficulty, points],
        );
        // Still count each boss kill toward the defeated counter, so
        // `bosses_defeated` reflects actual victories, not just first-evers.
        // Replays don't flip player_boss_progress, so syncBossProgress
        // cannot increment quests_completed for them — do it here instead
        // so quest-milestone achievements fire past the first-clear cap.
        const { rows: questRows } = await db.query(
          `INSERT INTO d2d_player_stats (player_id, bosses_defeated, quests_completed)
           VALUES ($1, 1, 1)
           ON CONFLICT (player_id) DO UPDATE
             SET bosses_defeated = d2d_player_stats.bosses_defeated + 1,
                 quests_completed = d2d_player_stats.quests_completed + 1,
                 updated_at = now()
           RETURNING quests_completed`,
          [playerId],
        ) as { rows: Array<{ quests_completed: number }> };
        await checkQuestCompletionAchievements(db, playerId, questRows[0].quests_completed);
        await checkBossCombatAchievements(db, playerId, dmgToPlayer, round, biome, difficulty);
        await checkBattleWinAchievements(db, playerId, dmgToPlayer, round, totalDmg, configBigint, parsedAbilities);
      } else if (totalDmg > 0) {
        console.log(`[game-db]   battle ${battleTag}... BOSS LOSS biome=${biome} diff=${difficulty} dmg=${totalDmg} player=${playerId.slice(0, 20)}...`);
        await checkBossLossAchievements(db, playerId, biome, difficulty);
      } else {
        console.log(`[game-db]   battle ${battleTag}... BOSS RETREAT biome=${biome} diff=${difficulty} player=${playerId.slice(0, 20)}...`);
        await checkBossRetreatAchievements(db, playerId);
      }
      await db.query(
        `DELETE FROM d2d_pending_boss_fights WHERE player_id = $1 AND biome = $2 AND difficulty = $3`,
        [playerId, biome, difficulty],
      );
    } else if (totalDmg > 0) {
      // ----- Normal battle won -----
      console.log(`[game-db]   battle ${battleTag}... NORMAL WIN biome=${biome} diff=${difficulty} dmg=${totalDmg} player=${playerId.slice(0, 20)}...`);
      await db.query(
        `INSERT INTO d2d_battle_results (battle_id, player_id, biome, difficulty, won, is_boss, points)
         VALUES ($1, $2, $3, $4, TRUE, FALSE, 0)
         ON CONFLICT (battle_id) DO NOTHING`,
        [stale.battle_id, playerId, biome, difficulty],
      );
      await checkBattleWinAchievements(db, playerId, dmgToPlayer, round, totalDmg, configBigint, parsedAbilities);
    } else {
      // ----- Normal-battle retreat — no counter touched -----
      console.log(`[game-db]   battle ${battleTag}... normal retreat (0 dmg, no pending boss) biome=${biome} diff=${difficulty} player=${playerId.slice(0, 20)}...`);
    }
  }
  console.log(`[game-db] Recorded ${staleBattles.length} battle result(s)`);
}

// ---------------------------------------------------------------------------
// Record boss wins that had no matching battle in d2d_battles
// (fresh DB catchup, or battle was never tracked)
// ---------------------------------------------------------------------------

async function recordOrphanedBossCompletions(
  db: any,
  newBossCompletions: BossCompletion[],
): Promise<void> {
  for (const bc of newBossCompletions) {
    // Check if this boss completion was already recorded by recordBattleResults
    const { rows: existing } = await db.query(
      `SELECT 1 FROM d2d_battle_results WHERE player_id = $1 AND biome = $2 AND difficulty = $3 AND is_boss = TRUE`,
      [bc.playerId, bc.biome, bc.difficulty],
    ) as { rows: Array<unknown> };
    if (existing.length > 0) continue;

    const points = calculateBossPoints(bc.biome, bc.difficulty);
    const battleId = `boss-${bc.playerId.slice(0, 20)}-${bc.biome}-${bc.difficulty}-${Date.now()}`;

    console.log(`[game-db] Recording orphaned boss win: player=${bc.playerId.slice(0, 20)}... biome=${bc.biome} diff=${bc.difficulty} points=${points}`);

    await db.query(
      `INSERT INTO d2d_battle_results (battle_id, player_id, biome, difficulty, won, is_boss, points)
       VALUES ($1, $2, $3, $4, TRUE, TRUE, $5)
       ON CONFLICT (battle_id) DO NOTHING`,
      [battleId, bc.playerId, bc.biome, bc.difficulty, points],
    );

    await db.query(
      `INSERT INTO d2d_player_stats (player_id, bosses_defeated)
       VALUES ($1, 1)
       ON CONFLICT (player_id) DO UPDATE
         SET bosses_defeated = d2d_player_stats.bosses_defeated + 1,
             updated_at = now()`,
      [bc.playerId],
    );

    // Clean up any pending boss fight entry
    await db.query(
      `DELETE FROM d2d_pending_boss_fights WHERE player_id = $1 AND biome = $2 AND difficulty = $3`,
      [bc.playerId, bc.biome, bc.difficulty],
    );
  }
}

// ---------------------------------------------------------------------------
// Sync: Battles
// ---------------------------------------------------------------------------

async function syncBattles(
  db: any,
  battleStates: Record<string, any>,
  battleConfigs: Record<string, any>,
  newBossCompletions: BossCompletion[],
  parsedAbilities: Map<string, ParsedAbility>,
): Promise<void> {
  const stateKeys = Object.keys(battleStates);
  const configKeys = Object.keys(battleConfigs);
  if (DEBUG_ENABLED && (stateKeys.length > 0 || configKeys.length > 0)) {
    console.log(`[game-db] syncBattles: stateKeys=[${stateKeys.map(k => k.slice(0, 16)).join(', ')}] configKeys=[${configKeys.map(k => k.slice(0, 16)).join(', ')}]`);
  }
  const battleIds = new Set([
    ...stateKeys,
    ...configKeys,
  ]);

  if (battleIds.size === 0) {
    // No active battles — but there may be stale battles that need result recording
    // (e.g. boss fight just ended, leaving zero active battles)
    const { rows: staleBattlesAll } = await db.query(
      `SELECT battle_id, player_id, biome, difficulty, round, damage_to_player, damage_to_enemy_0, damage_to_enemy_1, damage_to_enemy_2, raw_config
       FROM d2d_battles`,
    ) as { rows: Array<{
      battle_id: string; player_id: string; biome: number; difficulty: number;
      round: number; damage_to_player: number;
      damage_to_enemy_0: number; damage_to_enemy_1: number; damage_to_enemy_2: number;
      raw_config: string;
    }> };
    if (staleBattlesAll.length > 0) {
      await recordBattleResults(db, staleBattlesAll, newBossCompletions, parsedAbilities);
    }
    // Handle boss completions that had no matching battle in d2d_battles
    // (e.g. node started after the battle already ended, or fresh DB catchup)
    if (newBossCompletions.length > 0) {
      await recordOrphanedBossCompletions(db, newBossCompletions);
    }
    await db.query(`DELETE FROM d2d_battles`);
    lastBattleLog.clear(); // all battles gone — drop per-battle log cache
    return;
  }

  // BattleState is packed LE: each Uint<32> field = 32 bits
  //   field 0: round
  //   field 1-3: deck_indices[0..2]
  //   field 4: damage_to_player
  //   field 5-7: damage_to_enemy_0..2
  //   field 8-10: enemy_move_index_0..2
  //
  // BattleConfig is packed LE:
  //   bytes 0-7    : Level (biome:Uint<32> + difficulty:Uint<32>)
  //   bytes 8-236  : EnemiesConfig (3 × EnemyStats(76) + count(1) = 229 bytes)
  //   bytes 237-268: player_pub_key (Field, treated as 32 LE bytes for Path B)
  //   bytes 269-492: loadout (Vector<7, Field>, 7 × 32 bytes)
  //
  // Path B = byte-offset extraction (the original hand-rolled approach,
  //          extended here to also extract player_pub_key).
  // Path A = walk through the contract type descriptors (recreated above
  //          from the compiled contract). Used as a sanity check.
  // We use Path B for the live values and warn if A and B disagree.
  // See A-vs-B compare logs below — paste them when verifying.

  const toUpsert: Array<{
    battleId: string;
    playerId: string;
    biome: number;
    difficulty: number;
    round: number;
    damageToPlayer: number;
    damageToEnemy0: number;
    damageToEnemy1: number;
    damageToEnemy2: number;
    rawState: string;
    rawConfig: string;
  }> = [];

  for (const battleId of battleIds) {
    const stateVal = battleStates[battleId];
    const configVal = battleConfigs[battleId];

    // Skip battles where one side is missing (key in states but not configs, or vice versa)
    if (stateVal == null || configVal == null) {
      console.warn(`[game-db] Skipping battle ${battleId.slice(0, 16)}...: missing ${stateVal == null ? 'state' : 'config'}`);
      continue;
    }

    const statePacked = toBigInt(stateVal);
    const configPacked = toBigInt(configVal);
    const battleTag = battleId.slice(0, 16);

    // ----- Path B: byte-offset extraction -----
    const round_B = extractU32(statePacked, 0);
    const damageToPlayer_B = extractU32(statePacked, 4);
    const dmg0_B = extractU32(statePacked, 5);
    const dmg1_B = extractU32(statePacked, 6);
    const dmg2_B = extractU32(statePacked, 7);
    const biome_B = extractU32(configPacked, 0);
    const difficulty_B = extractU32(configPacked, 1);
    const playerKey_B = extractPlayerPubKeyFromBattleConfig(configPacked);
    const loadout_B = extractLoadoutFromBattleConfig(configPacked);

    // ----- Path A: contract descriptor walk -----
    const configAtoms = getCellAtoms(configVal);
    const stateAtoms = getCellAtoms(stateVal);
    const parsedConfig_A = parseBattleConfigA(configAtoms);
    const parsedState_A = parseBattleStateA(stateAtoms);

    // ----- Log B + A only when the observable state actually changes -----
    // Idle battles would otherwise print 2 lines per block forever. We track
    // the last logged (round, damage_*) per battle_id and suppress duplicates.
    // biome/difficulty/pkey/loadout are static for the life of a battle — if
    // any of those differ it's a different battle with the same id, which
    // would itself be a bug worth seeing, so we include them in the key too.
    const changeKey =
      `${biome_B}:${difficulty_B}:${round_B}:${damageToPlayer_B}:` +
      `${dmg0_B}:${dmg1_B}:${dmg2_B}:${playerKey_B.toString(16)}:` +
      loadout_B.join(",");
    const changed = lastBattleLog.get(battleId) !== changeKey;
    if (changed) {
      lastBattleLog.set(battleId, changeKey);
      const fmtKey = (k: bigint) => "0x" + k.toString(16).padStart(64, "0");
      // Print the live values (Path B) on every observable change. Path A
      // is only a validator and prints only on mismatch below — A and B
      // have agreed on every run since the comparison was added.
      console.log(
        `[battle ${battleTag}] biome=${biome_B} diff=${difficulty_B} ` +
        `round=${round_B} dmgP=${damageToPlayer_B} dmgE=[${dmg0_B},${dmg1_B},${dmg2_B}] ` +
        `pkey=${fmtKey(playerKey_B)} ` +
        `loadout=[${loadout_B.join(", ")}]`,
      );

      // Compare A vs B and warn on mismatch (only runs on change, equivalent
      // to running every block since unchanged state can't introduce a new
      // discrepancy).
      if (parsedConfig_A && parsedState_A) {
        const mismatches: string[] = [];
        const cmpInt = (name: string, b: number | bigint, a: number | bigint) => {
          if (BigInt(b) !== BigInt(a)) mismatches.push(`${name}: B=${b} A=${a}`);
        };
        cmpInt("biome", biome_B, parsedConfig_A.level.biome);
        cmpInt("difficulty", difficulty_B, parsedConfig_A.level.difficulty);
        cmpInt("round", round_B, parsedState_A.round);
        cmpInt("dmg_player", damageToPlayer_B, parsedState_A.damage_to_player);
        cmpInt("dmg_e0", dmg0_B, parsedState_A.damage_to_enemy_0);
        cmpInt("dmg_e1", dmg1_B, parsedState_A.damage_to_enemy_1);
        cmpInt("dmg_e2", dmg2_B, parsedState_A.damage_to_enemy_2);
        cmpInt("player_pub_key", playerKey_B, parsedConfig_A.player_pub_key);
        for (let i = 0; i < 7; i++) {
          // Path A gives BE-natural bigints; loadout_B holds LE-byte hex
          // strings (for allAbilities lookup), so re-derive the raw bigint
          // from configPacked directly to compare on the same footing.
          const bitOffset = BigInt((BATTLE_CONFIG_LOADOUT_START_BYTE + i * FIELD_SIZE_BYTES) * 8);
          const rawB = (configPacked >> bitOffset) & FIELD_MASK_256;
          const aVal = parsedConfig_A.loadout.abilities[i];
          cmpInt(`loadout[${i}]`, rawB, aVal);
        }
        if (mismatches.length > 0) {
          console.warn(`[game-db] WARN battle ${battleTag} Path A vs B mismatch:`);
          for (const m of mismatches) console.warn(`    ${m}`);
        }
      } else {
        // Lost the validator — raw atoms weren't available, can't cross-check
        console.warn(`[game-db] WARN battle ${battleTag} Path A unavailable (no atoms), cannot validate`);
      }
    }

    // ----- Validate (Path B values are the live ones) -----
    if (biome_B > 3 || difficulty_B < 1 || difficulty_B > 3) {
      console.warn(`[game-db] Skipping battle ${battleTag}: invalid biome=${biome_B} difficulty=${difficulty_B}`);
      continue;
    }

    // Resolve player_id from Path B's player_pub_key.
    // (Per current instruction: use B for live calculations; A is the validator.)
    const playerId = bigintToBech32(playerKey_B);

    toUpsert.push({
      battleId,
      playerId,
      biome: biome_B,
      difficulty: difficulty_B,
      round: round_B,
      damageToPlayer: damageToPlayer_B,
      damageToEnemy0: dmg0_B,
      damageToEnemy1: dmg1_B,
      damageToEnemy2: dmg2_B,
      rawState: statePacked.toString(),
      rawConfig: configPacked.toString(),
    });
  }

  if (toUpsert.length > 0) {
    const placeholders = toUpsert
      .map((_, i) => {
        const base = i * 11;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
      })
      .join(", ");
    const values = toUpsert.flatMap((b) => [
      b.battleId, b.playerId, String(b.biome), String(b.difficulty),
      String(b.round), String(b.damageToPlayer), String(b.damageToEnemy0), String(b.damageToEnemy1), String(b.damageToEnemy2),
      b.rawState, b.rawConfig,
    ]);

    await db.query(
      `INSERT INTO d2d_battles (battle_id, player_id, biome, difficulty, round, damage_to_player, damage_to_enemy_0, damage_to_enemy_1, damage_to_enemy_2, raw_state, raw_config)
       VALUES ${placeholders}
       ON CONFLICT (battle_id) DO UPDATE
         SET player_id = EXCLUDED.player_id,
             biome = EXCLUDED.biome,
             difficulty = EXCLUDED.difficulty,
             round = EXCLUDED.round,
             damage_to_player = EXCLUDED.damage_to_player,
             damage_to_enemy_0 = EXCLUDED.damage_to_enemy_0,
             damage_to_enemy_1 = EXCLUDED.damage_to_enemy_1,
             damage_to_enemy_2 = EXCLUDED.damage_to_enemy_2,
             raw_state = EXCLUDED.raw_state,
             raw_config = EXCLUDED.raw_config,
             updated_at = now()`,
      values,
    );

    // Detect battles that have left the chain (completed or retreated)
    // Before deleting, record results for leaderboard
    const activeBattleIds = toUpsert.map((b) => b.battleId);
    const { rows: staleBattles } = await db.query(
      `SELECT battle_id, player_id, biome, difficulty, round, damage_to_player, damage_to_enemy_0, damage_to_enemy_1, damage_to_enemy_2, raw_config
       FROM d2d_battles WHERE NOT (battle_id = ANY($1))`,
      [activeBattleIds],
    ) as { rows: Array<{
      battle_id: string; player_id: string; biome: number; difficulty: number;
      round: number; damage_to_player: number;
      damage_to_enemy_0: number; damage_to_enemy_1: number; damage_to_enemy_2: number;
      raw_config: string;
    }> };

    if (staleBattles.length > 0) {
      await recordBattleResults(db, staleBattles, newBossCompletions, parsedAbilities);
    }
    // Handle boss completions that had no matching stale battle
    if (newBossCompletions.length > 0) {
      await recordOrphanedBossCompletions(db, newBossCompletions);
    }

    // Remove battles no longer on-chain
    await db.query(
      `DELETE FROM d2d_battles WHERE NOT (battle_id = ANY($1))`,
      [activeBattleIds],
    );
    // Drop log-dedup cache entries for battles that are no longer active.
    for (const stale of staleBattles) lastBattleLog.delete(stale.battle_id);

    if (DEBUG_ENABLED) console.log(`[game-db] Synced ${toUpsert.length} battle(s)`);
  }
}

// ---------------------------------------------------------------------------
// Sync: Quests
// ---------------------------------------------------------------------------

async function syncQuests(
  db: any,
  questsMap: Record<string, any>,
): Promise<void> {
  const entries = Object.entries(questsMap);

  if (entries.length === 0) {
    // No active quests — clean up stale DB entries
    await db.query(`DELETE FROM d2d_quests`);
    return;
  }

  // QuestConfig is packed LE:
  //   field 0: biome (Uint<32>)
  //   field 1: difficulty (Uint<32>)
  //   then player_pub_key (Field), loadout (7 Fields), start_time (Uint<64>)
  //
  // start_time is at the end after variable-width fields, so we store
  // raw_config and extract what we can from the leading bits.

  const toUpsert: Array<{
    questId: string;
    playerId: string;
    biome: number;
    difficulty: number;
    startTime: number;
    rawConfig: string;
  }> = [];

  for (const [questId, value] of entries) {
    const packed = toBigInt(value);
    const biome = extractU32(packed, 0);
    const difficulty = extractU32(packed, 1);

    // player_pub_key and start_time offsets depend on struct packing;
    // store raw for now
    toUpsert.push({
      questId,
      playerId: "unknown",
      biome,
      difficulty,
      startTime: 0,
      rawConfig: packed.toString(),
    });
  }

  if (toUpsert.length > 0) {
    const placeholders = toUpsert
      .map((_, i) => {
        const base = i * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      })
      .join(", ");
    const values = toUpsert.flatMap((q) => [
      q.questId, q.playerId, String(q.biome), String(q.difficulty), String(q.startTime), q.rawConfig,
    ]);

    await db.query(
      `INSERT INTO d2d_quests (quest_id, player_id, biome, difficulty, start_time, raw_config)
       VALUES ${placeholders}
       ON CONFLICT (quest_id) DO UPDATE
         SET player_id = EXCLUDED.player_id,
             biome = EXCLUDED.biome,
             difficulty = EXCLUDED.difficulty,
             start_time = EXCLUDED.start_time,
             raw_config = EXCLUDED.raw_config,
             updated_at = now()`,
      values,
    );

    // Detect quests that just disappeared (finalized → boss fight started)
    const activeQuestIds = toUpsert.map((q) => q.questId);
    const { rows: departedQuests } = await db.query(
      `SELECT quest_id, raw_config, biome, difficulty FROM d2d_quests WHERE NOT (quest_id = ANY($1))`,
      [activeQuestIds],
    ) as { rows: Array<{ quest_id: string; raw_config: string; biome: number; difficulty: number }> };

    if (departedQuests.length > 0) {
      const PLAYER_KEY_MASK = (1n << 256n) - 1n;
      for (const dq of departedQuests) {
        // Extract player_pub_key from the stored raw_config and convert to Bech32
        const packed = toBigInt(dq.raw_config);
        const playerKeyBigint = (packed >> 64n) & PLAYER_KEY_MASK;
        const playerKeyBech32 = bigintToBech32(playerKeyBigint);
        // Check if this player exists in our DB (player_id is now Bech32)
        const { rows: matchRows } = await db.query(
          `SELECT player_id FROM d2d_players WHERE player_id = $1`,
          [playerKeyBech32],
        ) as { rows: Array<{ player_id: string }> };
        if (matchRows.length > 0) {
          const playerId = matchRows[0].player_id;
          await db.query(
            `INSERT INTO d2d_pending_boss_fights (player_id, biome, difficulty)
             VALUES ($1, $2, $3)
             ON CONFLICT (player_id, biome, difficulty) DO NOTHING`,
            [playerId, dq.biome, dq.difficulty],
          );
          console.log(`[game-db] Pending boss fight for ${playerId.slice(0, 18)}... biome=${dq.biome} diff=${dq.difficulty}`);
        }
      }
    }

    // Remove quests no longer on-chain
    await db.query(
      `DELETE FROM d2d_quests WHERE NOT (quest_id = ANY($1))`,
      [activeQuestIds],
    );

    if (DEBUG_ENABLED) console.log(`[game-db] Synced ${toUpsert.length} quest(s)`);
  }

  // Check Multitasker: 3 quests active simultaneously for same player
  // Extract player_pub_key from packed QuestConfig (bits 64-319, a 256-bit Field)
  const PLAYER_KEY_MASK2 = (1n << 256n) - 1n;
  const questsByPlayer = new Map<string, number>();
  for (const [_, value] of entries) {
    const packed = toBigInt(value);
    const playerKeyBech32 = bigintToBech32((packed >> 64n) & PLAYER_KEY_MASK2);
    questsByPlayer.set(playerKeyBech32, (questsByPlayer.get(playerKeyBech32) ?? 0) + 1);
  }
  for (const [playerBech32, count] of questsByPlayer) {
    if (count >= 3) {
      // player_id is Bech32 — direct match against d2d_players
      const { rows } = await db.query(
        `SELECT player_id FROM d2d_players WHERE player_id = $1`,
        [playerBech32],
      ) as { rows: Array<{ player_id: string }> };
      if (rows.length > 0) {
        await grantAchievement(db, rows[0].player_id, "multitasker");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Query functions (for API endpoints)
// ---------------------------------------------------------------------------

export async function getPlayers(db: any): Promise<any[]> {
  const { rows } = await db.query(
    `SELECT player_id, gold, updated_at FROM d2d_players ORDER BY updated_at DESC`,
  );
  return rows;
}

export async function getPlayerDetail(db: any, playerId: string): Promise<any> {
  const { rows: playerRows } = await db.query(
    `SELECT player_id, gold, updated_at FROM d2d_players WHERE player_id = $1`,
    [playerId],
  );
  if (playerRows.length === 0) return null;

  const { rows: abilityRows } = await db.query(
    `SELECT ability_id, quantity FROM d2d_player_abilities WHERE player_id = $1`,
    [playerId],
  );

  const { rows: progressRows } = await db.query(
    `SELECT biome, difficulty, completed FROM d2d_boss_progress WHERE player_id = $1`,
    [playerId],
  );

  return {
    ...playerRows[0],
    abilities: abilityRows,
    bossProgress: progressRows,
  };
}

export async function getActiveBattles(db: any, playerId?: string): Promise<any[]> {
  if (playerId) {
    const { rows } = await db.query(
      `SELECT * FROM d2d_battles WHERE player_id = $1 ORDER BY updated_at DESC`,
      [playerId],
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT * FROM d2d_battles ORDER BY updated_at DESC`,
  );
  return rows;
}

export async function getActiveQuests(db: any, playerId?: string): Promise<any[]> {
  if (playerId) {
    const { rows } = await db.query(
      `SELECT * FROM d2d_quests WHERE player_id = $1 ORDER BY updated_at DESC`,
      [playerId],
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT * FROM d2d_quests ORDER BY updated_at DESC`,
  );
  return rows;
}

export async function getGameStats(db: any): Promise<any> {
  const { rows: [playerCount] } = await db.query(`SELECT COUNT(*)::int AS count FROM d2d_players`);
  const { rows: [battleCount] } = await db.query(`SELECT COUNT(*)::int AS count FROM d2d_battles`);
  const { rows: [questCount] } = await db.query(`SELECT COUNT(*)::int AS count FROM d2d_quests`);

  return {
    totalPlayers: playerCount?.count ?? 0,
    activeBattles: battleCount?.count ?? 0,
    activeQuests: questCount?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Sync: Delegations
// ---------------------------------------------------------------------------

async function syncDelegations(
  db: any,
  delegationsMap: Record<string, any>,
): Promise<void> {
  const entries = Object.entries(delegationsMap);
  if (entries.length === 0) return;

  const parsed: Array<{ fromAddr: string; toAddr: string }> = [];
  for (const [fromAddr, toValue] of entries) {
    // toValue is ShieldedAddressData { data: Bytes<64> }, emitted by the indexer
    // as a decimal BigInt string representing the 64 bytes in LE order (same
    // convention as the map keys). Parse → 64 BE bytes → reverse to natural
    // order → bech32m-encode.
    let value: bigint;
    try {
      value = typeof toValue === "bigint" ? toValue : BigInt(toValue);
    } catch (e) {
      console.warn(`[syncDelegations] ${fromAddr}: BigInt parse failed:`, e);
      continue;
    }
    const hex = value.toString(16).padStart(128, "0");
    if (hex.length > 128) {
      console.warn(`[syncDelegations] ${fromAddr}: value too large, ${hex.length} hex chars; skipping`);
      continue;
    }
    const leBytes = hexToUint8Array(hex);
    const addrBytes = new Uint8Array(Array.from(leBytes).reverse());

    parsed.push({
      fromAddr: hexToBech32(fromAddr),
      toAddr: bytesToBech32Shield(addrBytes),
    });
  }
  if (parsed.length === 0) return;

  // Check existing
  const fromKeys = parsed.map((e) => e.fromAddr);
  const { rows: existing } = await db.query(
    `SELECT from_address, to_address FROM d2d_delegations WHERE from_address = ANY($1)`,
    [fromKeys],
  ) as { rows: Array<{ from_address: string; to_address: string }> };
  const existingMap = new Map(existing.map((r: any) => [r.from_address, r.to_address]));

  // Find new or changed delegations
  const toUpsert = parsed.filter((e) => existingMap.get(e.fromAddr) !== e.toAddr);

  if (toUpsert.length === 0) return;

  const placeholders = toUpsert
    .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
    .join(", ");
  const values = toUpsert.flatMap((u) => [u.fromAddr, u.toAddr]);

  await db.query(
    `INSERT INTO d2d_delegations (from_address, to_address)
     VALUES ${placeholders}
     ON CONFLICT (from_address) DO UPDATE
       SET to_address = EXCLUDED.to_address,
           updated_at = now()`,
    values,
  );

  console.log(`[game-db] Upserted ${toUpsert.length} delegation(s)`);
}

// ---------------------------------------------------------------------------
// Leaderboard queries (PRC-6)
// ---------------------------------------------------------------------------

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface LeaderboardParams {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  score: number;
}

export interface LeaderboardResult {
  channel: string;
  startDate: string;
  endDate: string;
  totalPlayers: number;
  totalScore: number;
  entries: LeaderboardEntry[];
}

export async function getLeaderboard(
  db: any,
  params: LeaderboardParams,
): Promise<LeaderboardResult> {
  const now = new Date();
  const endDate = params.endDate ?? now.toISOString();
  const startDate = params.startDate ?? new Date(now.getTime() - ONE_YEAR_MS).toISOString();
  const limit = Math.min(params.limit ?? 50, 1000);
  const offset = params.offset ?? 0;

  const { rows } = await db.query(
    `SELECT
       COALESCE(d.to_address, p.player_id)                        AS address,
       COALESCE(SUM(r.points), 0)::int                            AS score,
       RANK() OVER (ORDER BY COALESCE(SUM(r.points), 0) DESC)::int AS rank
     FROM d2d_players p
     LEFT JOIN d2d_battle_results r
       ON r.player_id = p.player_id
       AND r.won = TRUE
       AND r.points > 0
       AND r.ended_at >= $1
       AND r.ended_at <= $2
     LEFT JOIN d2d_delegations d ON p.player_id = d.from_address
     GROUP BY COALESCE(d.to_address, p.player_id)
     ORDER BY score DESC, address ASC
     LIMIT $3 OFFSET $4`,
    [startDate, endDate, limit, offset],
  ) as { rows: Array<{ address: string; score: number; rank: number }> };

  const entries: LeaderboardEntry[] = rows.map((r: any) => ({
    rank: Number(r.rank),
    address: r.address,
    score: Number(r.score),
  }));

  const totalScore = entries.reduce((sum, e) => sum + e.score, 0);

  return {
    channel: "leaderboard",
    startDate,
    endDate,
    totalPlayers: entries.length,
    totalScore,
    entries,
  };
}

export interface UserChannelStats {
  score: number;
  rank: number;
  matchesPlayed: number;
}

export async function getUserLeaderboardStats(
  db: any,
  address: string,
  startDate: string,
  endDate: string,
): Promise<UserChannelStats | null> {
  const { rows } = await db.query(
    `WITH delegated_keys AS (
       SELECT from_address FROM d2d_delegations WHERE to_address = $3
       UNION ALL
       SELECT $3
     ),
     ranked AS (
       SELECT
         COALESCE(d.to_address, p.player_id)                        AS address,
         COALESCE(SUM(r.points), 0)::int                            AS score,
         RANK() OVER (ORDER BY COALESCE(SUM(r.points), 0) DESC)::int AS rank
       FROM d2d_players p
       LEFT JOIN d2d_battle_results r
         ON r.player_id = p.player_id
         AND r.won = TRUE
         AND r.points > 0
         AND r.ended_at >= $1
         AND r.ended_at <= $2
       LEFT JOIN d2d_delegations d ON p.player_id = d.from_address
       GROUP BY COALESCE(d.to_address, p.player_id)
     )
     SELECT
       r.score,
       r.rank,
       (SELECT COUNT(*)::int FROM d2d_battle_results br
        WHERE br.player_id IN (SELECT from_address FROM delegated_keys)
          AND br.ended_at >= $1 AND br.ended_at <= $2) AS matches_played
     FROM ranked r
     WHERE r.address = $3`,
    [startDate, endDate, address],
  ) as { rows: Array<{ score: number; rank: number; matches_played: number }> };

  if (rows.length === 0) return null;

  return {
    score: Number(rows[0].score),
    rank: Number(rows[0].rank),
    matchesPlayed: Number(rows[0].matches_played),
  };
}

export interface UserIdentity {
  address: string;
  delegatedFrom: string[];
}

export async function resolveUserIdentity(
  db: any,
  address: string,
): Promise<UserIdentity> {
  // Check if this address has delegated to another
  const { rows: asDelegator } = await db.query(
    `SELECT to_address FROM d2d_delegations WHERE from_address = $1`,
    [address],
  ) as { rows: Array<{ to_address: string }> };

  // Check if this address is one that others delegate to
  const { rows: asDelegatee } = await db.query(
    `SELECT from_address FROM d2d_delegations WHERE to_address = $1`,
    [address],
  ) as { rows: Array<{ from_address: string }> };

  return {
    address: asDelegator.length > 0 ? asDelegator[0].to_address : address,
    delegatedFrom: asDelegatee.map((r: any) => r.from_address),
  };
}

// ---------------------------------------------------------------------------
// Achievement granting
// ---------------------------------------------------------------------------

async function grantAchievement(db: any, playerId: string, achievementName: string): Promise<boolean> {
  // Use RETURNING so the success check is driver-agnostic — some pg drivers
  // don't populate `rowCount` for INSERT ... ON CONFLICT DO NOTHING.
  const { rows } = await db.query(
    `INSERT INTO d2d_player_achievements (player_id, achievement)
     VALUES ($1, $2)
     ON CONFLICT (player_id, achievement) DO NOTHING
     RETURNING player_id`,
    [playerId, achievementName],
  ) as { rows: Array<{ player_id: string }> };
  if (rows.length > 0) {
    console.log(`[achievements] Unlocked "${achievementName}" for ${playerId}`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Achievement checks
// ---------------------------------------------------------------------------

const QUEST_COMPLETION_THRESHOLDS: Array<[number, string]> = [
  [1, "first_quest"],
  [5, "novice_explorer"],
  [10, "seasoned_adventurer"],
  [15, "experienced_adventurer"],
  [20, "skilled_explorer"],
  [25, "expert_explorer"],
  [30, "veteran_explorer"],
  [50, "quest_master"],
  [100, "legendary_explorer"],
];

async function checkQuestCompletionAchievements(db: any, playerId: string, questsCompleted: number): Promise<void> {
  for (const [threshold, name] of QUEST_COMPLETION_THRESHOLDS) {
    if (questsCompleted >= threshold) {
      await grantAchievement(db, playerId, name);
    }
  }
}

const BATTLE_WON_THRESHOLDS: Array<[number, string]> = [
  [1, "first_blood"],
  [50, "battle_hardened"],
  [100, "warmonger"],
  [250, "grizzled_veteran"],
];

const ENEMIES_DEFEATED_THRESHOLDS: Array<[number, string]> = [
  [100, "slayer"],
  [500, "annihilator"],
];

async function checkBattleWinAchievements(db: any, playerId: string, dmgToPlayer: number, round: number, totalDmg: number, rawConfig: bigint, parsedAbilities: Map<string, ParsedAbility>): Promise<void> {
  // Increment battles_won, rounds_played, enemies_defeated
  // Estimate enemies defeated: each enemy with damage > 0 is considered killed in a won battle
  // (simplified — true count would need HP comparison)
  const enemiesKilled = (totalDmg > 0 ? 1 : 0) + // at least 1 if battle was won
    0; // conservative estimate; we refine later if we can read enemy count
  // For now, count as 1-3 enemies based on which damage fields are > 0
  // (read from the stale battle data, but we only have totalDmg here)
  // Actually we'll just use 1 per won battle as minimum — can refine later

  const { rows } = await db.query(
    `INSERT INTO d2d_player_stats (player_id, battles_won, rounds_played, enemies_defeated)
     VALUES ($1, 1, $2, 1)
     ON CONFLICT (player_id) DO UPDATE
       SET battles_won = d2d_player_stats.battles_won + 1,
           rounds_played = d2d_player_stats.rounds_played + $2,
           enemies_defeated = d2d_player_stats.enemies_defeated + 1,
           updated_at = now()
     RETURNING battles_won, rounds_played, enemies_defeated`,
    [playerId, round],
  ) as { rows: Array<{ battles_won: number; rounds_played: number; enemies_defeated: number }> };
  const stats = rows[0];

  // Battle milestone achievements
  for (const [threshold, name] of BATTLE_WON_THRESHOLDS) {
    if (stats.battles_won >= threshold) await grantAchievement(db, playerId, name);
  }

  // Combat totals
  for (const [threshold, name] of ENEMIES_DEFEATED_THRESHOLDS) {
    if (stats.enemies_defeated >= threshold) await grantAchievement(db, playerId, name);
  }
  if (stats.rounds_played >= 500) await grantAchievement(db, playerId, "round_veteran");

  // Battle feats (per-battle checks)
  if (round === 1) await grantAchievement(db, playerId, "speed_demon");
  if (round >= 10) await grantAchievement(db, playerId, "marathon_fight");
  if (dmgToPlayer === 0) {
    // Untouchable requires 3-enemy battle — we can't easily determine enemy count
    // from totalDmg alone, but we grant it if damage to player is 0
    // TODO: refine with enemy count from BattleConfig if extractable
    await grantAchievement(db, playerId, "untouchable");
  }
  if (dmgToPlayer >= 95) await grantAchievement(db, playerId, "survivor");

  // Damage output achievements
  if (totalDmg >= 300) await grantAchievement(db, playerId, "damage_dealer");
  if (totalDmg >= 600) await grantAchievement(db, playerId, "overwhelming_force");

  // Devastator: cumulative damage across all battles
  const { rows: dmgRows } = await db.query(
    `INSERT INTO d2d_player_stats (player_id, total_damage_dealt)
     VALUES ($1, $2)
     ON CONFLICT (player_id) DO UPDATE
       SET total_damage_dealt = d2d_player_stats.total_damage_dealt + $2,
           updated_at = now()
     RETURNING total_damage_dealt`,
    [playerId, totalDmg],
  ) as { rows: Array<{ total_damage_dealt: number }> };
  if (dmgRows[0].total_damage_dealt >= 10000) await grantAchievement(db, playerId, "devastator");

  // Loadout-based achievements: extract 7 ability IDs from BattleConfig
  const loadoutIds = extractLoadoutFromBattleConfig(rawConfig);
  const loadoutAbilities = loadoutIds.map((id) => parsedAbilities.get(id)).filter((a): a is ParsedAbility => !!a);

  if (loadoutAbilities.length === 7) {
    const attackTypes = loadoutAbilities.filter((a) => a.hasEffect && a.effectType <= 2).map((a) => a.effectType);
    const allTypes = loadoutAbilities.filter((a) => a.hasEffect).map((a) => a.effectType);
    const uniqueAttackTypes = new Set(attackTypes);

    // Mono Fire: all 7 are fire attack
    if (allTypes.length === 7 && allTypes.every((t) => t === 1)) await grantAchievement(db, playerId, "mono_fire");
    // Mono Ice: all 7 are ice attack
    if (allTypes.length === 7 && allTypes.every((t) => t === 2)) await grantAchievement(db, playerId, "mono_ice");
    // Mono Physical: all 7 are phys attack
    if (allTypes.length === 7 && allTypes.every((t) => t === 0)) await grantAchievement(db, playerId, "mono_physical");
    // Glass Cannon: no block abilities in loadout
    if (!allTypes.includes(3)) await grantAchievement(db, playerId, "glass_cannon");
    // Balanced Fighter: all 3 attack elements present
    if (uniqueAttackTypes.has(0) && uniqueAttackTypes.has(1) && uniqueAttackTypes.has(2)) await grantAchievement(db, playerId, "balanced_fighter");
    // Elemental Focus: all attack abilities share the same element
    if (attackTypes.length > 0 && uniqueAttackTypes.size === 1) await grantAchievement(db, playerId, "elemental_focus");
    // Fortified: 3+ block abilities
    if (allTypes.filter((t) => t === 3).length >= 3) await grantAchievement(db, playerId, "fortified");
    // Power Surge: any loadout ability at 3 stars
    if (loadoutAbilities.some((a) => a.upgradeLevel === 3)) await grantAchievement(db, playerId, "power_surge");

    // Overcharged: 3+ loadout abilities sharing the same energy color
    const colorCounts = new Map<number, number>();
    for (const a of loadoutAbilities) {
      if (a.hasGenerateColor) colorCounts.set(a.generateColor, (colorCounts.get(a.generateColor) ?? 0) + 1);
    }
    for (const count of colorCounts.values()) {
      if (count >= 3) { await grantAchievement(db, playerId, "overcharged"); break; }
    }
  }
}

const GOLD_EARNED_THRESHOLDS: Array<[number, string]> = [
  [1, "first_coin"],
  [500, "treasure_hunter"],
  [2000, "golden_hoard"],
  [10000, "dragons_vault"],
];

async function checkGoldEarnedAchievements(db: any, playerId: string, totalGoldEarned: number): Promise<void> {
  for (const [threshold, name] of GOLD_EARNED_THRESHOLDS) {
    if (totalGoldEarned >= threshold) await grantAchievement(db, playerId, name);
  }
}

async function checkGoldSpentAchievements(db: any, playerId: string, totalGoldSpent: number): Promise<void> {
  if (totalGoldSpent >= 1000) await grantAchievement(db, playerId, "big_spender");
}

const UPGRADE_THRESHOLDS: Array<[number, string]> = [
  [1, "apprentice_smith"],
  [10, "journeyman_smith"],
  [25, "master_smith"],
];

async function checkUpgradeAchievements(db: any, playerId: string, stats: { abilities_upgraded: number; phys_upgraded: number; fire_upgraded: number; ice_upgraded: number; block_upgraded: number }): Promise<void> {
  for (const [threshold, name] of UPGRADE_THRESHOLDS) {
    if (stats.abilities_upgraded >= threshold) await grantAchievement(db, playerId, name);
  }
  if (stats.fire_upgraded >= 10) await grantAchievement(db, playerId, "pyro_forger");
  if (stats.ice_upgraded >= 10) await grantAchievement(db, playerId, "cryo_forger");
  if (stats.phys_upgraded >= 10) await grantAchievement(db, playerId, "weapons_forger");
  if (stats.block_upgraded >= 10) await grantAchievement(db, playerId, "shield_forger");
}

async function checkSellAchievements(db: any, playerId: string, stats: { abilities_sold: number; phys_sold: number; fire_sold: number; ice_sold: number; block_sold: number }): Promise<void> {
  if (stats.abilities_sold >= 10) await grantAchievement(db, playerId, "merchant");
  if (stats.abilities_sold >= 50) await grantAchievement(db, playerId, "spirit_trader");
  if (stats.fire_sold >= 15) await grantAchievement(db, playerId, "fire_sale");
  if (stats.ice_sold >= 15) await grantAchievement(db, playerId, "cold_surplus");
  if (stats.phys_sold >= 15) await grantAchievement(db, playerId, "disarmed");
  if (stats.block_sold >= 15) await grantAchievement(db, playerId, "shields_down");
}

async function checkSpiritCollectionAchievements(
  db: any,
  playerId: string,
  playerEntries: Array<{ abilityId: string; quantity: number }>,
  parsedAbilities: Map<string, ParsedAbility>,
): Promise<void> {
  const totalSpirits = playerEntries.reduce((sum, e) => sum + e.quantity, 0);

  // Spirit collection milestones
  if (totalSpirits >= 25) await grantAchievement(db, playerId, "spirit_collector");
  if (totalSpirits >= 50) await grantAchievement(db, playerId, "spirit_hoarder");

  // Upgrade Quality achievements (snapshot-based)
  let countUpgrade2 = 0;
  let countUpgrade3 = 0;
  const maxUpgradeByType = new Map<number, number>(); // effectType -> max upgrade_level
  let hasAoe3 = 0;
  const colorCounts = new Map<number, number>(); // generate_color -> count

  for (const entry of playerEntries) {
    if (entry.quantity <= 0) continue;
    const ability = parsedAbilities.get(entry.abilityId);
    if (!ability) continue;

    if (ability.upgradeLevel >= 2) countUpgrade2++;
    if (ability.upgradeLevel === 3) countUpgrade3++;

    if (ability.hasEffect && ability.upgradeLevel >= 1) {
      const prev = maxUpgradeByType.get(ability.effectType) ?? 0;
      if (ability.upgradeLevel > prev) maxUpgradeByType.set(ability.effectType, ability.upgradeLevel);
    }

    if (ability.isAoe && entry.quantity > 0) hasAoe3++;
    if (ability.hasGenerateColor) {
      colorCounts.set(ability.generateColor, (colorCounts.get(ability.generateColor) ?? 0) + entry.quantity);
    }
  }

  // Rising Star: own a spirit at 2+ stars
  if (countUpgrade2 > 0) await grantAchievement(db, playerId, "rising_star");
  // Perfection: own a spirit at 3 stars
  if (countUpgrade3 > 0) await grantAchievement(db, playerId, "perfection");
  // Master Forger: own 3+ at 3 stars
  if (countUpgrade3 >= 3) await grantAchievement(db, playerId, "master_forger");
  // Max Power: 3-star spirit of every attack element
  const has3StarPhys = [...parsedAbilities.entries()].some(([id, a]) => a.upgradeLevel === 3 && a.hasEffect && a.effectType === 0 && playerEntries.some(e => e.abilityId === id && e.quantity > 0));
  const has3StarFire = [...parsedAbilities.entries()].some(([id, a]) => a.upgradeLevel === 3 && a.hasEffect && a.effectType === 1 && playerEntries.some(e => e.abilityId === id && e.quantity > 0));
  const has3StarIce = [...parsedAbilities.entries()].some(([id, a]) => a.upgradeLevel === 3 && a.hasEffect && a.effectType === 2 && playerEntries.some(e => e.abilityId === id && e.quantity > 0));
  if (has3StarPhys && has3StarFire && has3StarIce) await grantAchievement(db, playerId, "max_power");

  // Full Spectrum: upgraded (1+ star) ability of every effect type
  if (maxUpgradeByType.has(0) && maxUpgradeByType.has(1) && maxUpgradeByType.has(2) && maxUpgradeByType.has(3)) {
    await grantAchievement(db, playerId, "full_spectrum");
  }

  // Energy Specialist: 3+ abilities generating the same energy color
  for (const count of colorCounts.values()) {
    if (count >= 3) { await grantAchievement(db, playerId, "energy_specialist"); break; }
  }

  // AOE Arsenal: own 3+ AOE abilities
  if (hasAoe3 >= 3) await grantAchievement(db, playerId, "aoe_arsenal");
}

async function checkBossLossAchievements(db: any, playerId: string, biome: number, difficulty: number): Promise<void> {
  // Fallen Hero: lose a boss fight
  await db.query(
    `INSERT INTO d2d_player_stats (player_id, quests_failed)
     VALUES ($1, 1)
     ON CONFLICT (player_id) DO UPDATE
       SET quests_failed = d2d_player_stats.quests_failed + 1,
           updated_at = now()`,
    [playerId],
  );
  await grantAchievement(db, playerId, "fallen_hero");

  // Record the failure for Persistence tracking
  await db.query(
    `INSERT INTO d2d_boss_failures (player_id, biome, difficulty)
     VALUES ($1, $2, $3)
     ON CONFLICT (player_id, biome, difficulty) DO UPDATE
       SET failed_at = now()`,
    [playerId, biome, difficulty],
  );
  console.log(`[game-db] Boss fight lost for ${playerId.slice(0, 10)}... biome=${biome} diff=${difficulty}`);

  // Persistence: check if the player previously failed this boss but has now beaten it
  // (checked on win side — see checkBossCombatAchievements)
}

async function checkBossRetreatAchievements(db: any, playerId: string): Promise<void> {
  // Tactical Retreat: retreat from a boss fight
  await db.query(
    `INSERT INTO d2d_player_stats (player_id, battles_retreated, boss_win_streak)
     VALUES ($1, 1, 0)
     ON CONFLICT (player_id) DO UPDATE
       SET battles_retreated = d2d_player_stats.battles_retreated + 1,
           boss_win_streak = 0,
           updated_at = now()`,
    [playerId],
  );
  await grantAchievement(db, playerId, "tactical_retreat");
  console.log(`[game-db] Boss retreat for ${playerId.slice(0, 10)}... (streak reset)`);
}

async function checkBossCombatAchievements(db: any, playerId: string, damageToPlayer: number, _round: number, biome: number, difficulty: number): Promise<void> {
  // Flawless Victory: beat a boss taking 0 damage
  if (damageToPlayer === 0) {
    await grantAchievement(db, playerId, "flawless_victory");
  }
  // Close Call: beat a boss with 90+ damage taken
  if (damageToPlayer >= 90) {
    await grantAchievement(db, playerId, "close_call");
  }
  // No Retreat: 10 boss wins in a row without retreating (streak-based)
  // Increment streak on boss win
  const { rows } = await db.query(
    `INSERT INTO d2d_player_stats (player_id, boss_win_streak)
     VALUES ($1, 1)
     ON CONFLICT (player_id) DO UPDATE
       SET boss_win_streak = d2d_player_stats.boss_win_streak + 1,
           updated_at = now()
     RETURNING boss_win_streak`,
    [playerId],
  ) as { rows: Array<{ boss_win_streak: number }> };
  if (rows[0].boss_win_streak >= 10) {
    await grantAchievement(db, playerId, "no_retreat");
  }
  // Persistence: previously failed this boss, now beat it
  const { rows: failRows } = await db.query(
    `SELECT 1 FROM d2d_boss_failures WHERE player_id = $1 AND biome = $2 AND difficulty = $3`,
    [playerId, biome, difficulty],
  );
  if (failRows.length > 0) {
    await grantAchievement(db, playerId, "persistence");
  }
}

// Biome IDs: grasslands=0, desert=1, tundra=2, cave=3. Difficulties: 1, 2, 3.
const BIOME_CONQUEROR_MAP: Record<number, string> = {
  0: "grasslands_conqueror",
  1: "desert_conqueror",
  2: "tundra_conqueror",
  3: "cave_conqueror",
};

// Per-player log dedup: only log `[biome-mastery]` when the completed-level
// set actually changes. Fills on the first call per player, quiet afterwards.
const lastBiomeMasteryLog = new Map<string, string>();

// Per-battle log dedup: only print the B/A compare lines in `syncBattles`
// when the observable state changes. Cleared when a battle becomes stale.
// See usage site in syncBattles for the key shape.
const lastBattleLog = new Map<string, string>();

async function checkBiomeMasteryAchievements(db: any, playerId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT biome, difficulty, completed FROM d2d_boss_progress WHERE player_id = $1 AND completed = TRUE`,
    [playerId],
  ) as { rows: Array<{ biome: number | string; difficulty: number | string; completed: boolean }> };

  // biome/difficulty are BIGINT in the schema — the pg driver returns them as
  // STRINGS, not numbers. Coerce everything up front so downstream comparisons
  // work regardless of driver quirks.
  const normalized = rows.map((r) => ({
    biome: Number(r.biome),
    difficulty: Number(r.difficulty),
  }));

  const levelsKey = normalized.map((r) => `${r.biome}:${r.difficulty}`).sort().join(",");
  if (lastBiomeMasteryLog.get(playerId) !== levelsKey) {
    lastBiomeMasteryLog.set(playerId, levelsKey);
    console.log(
      `[biome-mastery] player=${playerId} rows=${normalized.length} levels=[${levelsKey}]`,
    );
  }

  // Build set of completed biome:difficulty pairs
  const completed = new Set(normalized.map((r) => `${r.biome}:${r.difficulty}`));

  // Per-biome conqueror: all 3 difficulties completed
  let biomesFullyCompleted = 0;
  for (const [biome, achievement] of Object.entries(BIOME_CONQUEROR_MAP)) {
    const allThree = [1, 2, 3].every((d) => completed.has(`${biome}:${d}`));
    if (allThree) {
      await grantAchievement(db, playerId, achievement);
      biomesFullyCompleted++;
    }
  }

  // World Conqueror: all 4 biomes at all 3 difficulties
  if (biomesFullyCompleted === 4) {
    await grantAchievement(db, playerId, "world_conqueror");
  }

  // Difficulty progression: any biome at difficulty N
  const diffsSeen = new Set(normalized.map((r) => r.difficulty));
  if (diffsSeen.has(1)) await grantAchievement(db, playerId, "frontier_scout");
  if (diffsSeen.has(2)) await grantAchievement(db, playerId, "interior_breacher");
  if (diffsSeen.has(3)) await grantAchievement(db, playerId, "stronghold_crusher");
}

// ---------------------------------------------------------------------------
// Achievement queries
// ---------------------------------------------------------------------------

export async function getAllAchievements(db: any): Promise<any[]> {
  const { rows } = await db.query(
    `SELECT name, display_name, description, category, is_active FROM d2d_achievements ORDER BY name`,
  );
  return rows;
}

export async function getUserAchievements(db: any, address: string): Promise<string[]> {
  // Resolve through delegations: find all game keys that delegate to this address
  const { rows } = await db.query(
    `SELECT DISTINCT pa.achievement
     FROM d2d_player_achievements pa
     WHERE pa.player_id = $1
        OR pa.player_id IN (SELECT from_address FROM d2d_delegations WHERE to_address = $1)
     ORDER BY pa.achievement`,
    [address],
  );
  return rows.map((r: any) => r.achievement);
}
