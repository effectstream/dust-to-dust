import {
  init,
  start,
  type StartConfigApiRouter,
  type StartConfigGameStateTransitions,
} from "@paimaexample/runtime";
import { main, suspend } from "effection";
import {
  toSyncProtocolWithNetwork,
  withEffectstreamStaticConfig,
} from "@paimaexample/config";
import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
} from "@paimaexample/config";
import type { GrammarDefinition } from "@paimaexample/concise";
import { type SyncStateUpdateStream, World } from "@paimaexample/coroutine";
import { PaimaSTM } from "@paimaexample/sm";
import type { BaseStfInput } from "@paimaexample/sm";
import { Type } from "@sinclair/typebox";
import {
  midnightNetworkConfig,
} from "@paimaexample/midnight-contracts/midnight-env";
import { PrimitiveTypeMidnightGeneric } from "@paimaexample/sm/builtin";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import * as path from "@std/path";
import { builtinGrammars } from "@paimaexample/sm/grammar";
import { valueToBigInt } from "@midnight-ntwrk/compact-runtime";
import {
  ensureTables,
  processLedgerSnapshot,
  setAddressNetworkId,
  getPlayers,
  getPlayerDetail,
  getActiveBattles,
  getActiveQuests,
  getGameStats,
  getLeaderboard,
  getUserLeaderboardStats,
  resolveUserIdentity,
  getAllAchievements,
  getUserAchievements,
} from "./game-db.ts";
import { seedAchievements } from "./achievements.ts";
import type { AlignedValue, StateValue } from "@midnight-ntwrk/ledger-v8";

// ---------------------------------------------------------------------------
// Re-exports for env-specific entry points
// ---------------------------------------------------------------------------
export {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
  midnightNetworkConfig,
  PrimitiveTypeMidnightGeneric,
};

// ---------------------------------------------------------------------------
// Environment validation & startup print
// ---------------------------------------------------------------------------

type EnvEntry = {
  name: string;
  value: string;
  isSet: boolean;
  secret: boolean;
  requiredWhenDeployed: boolean;
};

function printEnvTable(title: string, entries: EnvEntry[]): string[] {
  const errors: string[] = [];
  const nameW = Math.max(...entries.map((e) => e.name.length));
  const valW = 38;

  const lineW = nameW + valW + 16;
  const sep = "=".repeat(lineW);

  console.log(`\n${sep}`);
  console.log(`  ${title}`);
  console.log(sep);
  console.log(
    `  ${"Variable".padEnd(nameW)}  ${"Value".padEnd(valW)}  Status`,
  );
  console.log(`  ${"-".repeat(nameW)}  ${"-".repeat(valW)}  ----------`);

  for (const e of entries) {
    let display: string;
    let status: string;

    if (e.secret) {
      display = e.isSet ? "****" : "(not set)";
      status = e.isSet ? "set" : "(not set)";
    } else {
      display = e.value || "(not set)";
      if (display.length > valW) display = display.slice(0, valW - 3) + "...";
      status = e.isSet ? "overridden" : "default";
    }

    console.log(
      `  ${e.name.padEnd(nameW)}  ${display.padEnd(valW)}  ${status}`,
    );

    if (e.requiredWhenDeployed && !e.isSet && !e.value) {
      errors.push(`FATAL: ${e.name} is required for deployed networks but is not set.`);
    }
  }

  console.log(`${sep}\n`);
  return errors;
}

export function validateAndPrintNodeEnv(): void {
  const networkId = midnightNetworkConfig.id as string;
  const isDeployed = networkId !== "undeployed";

  // Configure Bech32 address encoding with the current network ID
  setAddressNetworkId(networkId);

  const entries: EnvEntry[] = [
    {
      name: "MIDNIGHT_NETWORK_ID",
      value: networkId,
      isSet: !!Deno.env.get("MIDNIGHT_NETWORK_ID"),
      secret: false,
      requiredWhenDeployed: false,
    },
    {
      name: "MIDNIGHT_WALLET_SEED",
      value: Deno.env.get("MIDNIGHT_WALLET_SEED") ?? "",
      isSet: !!Deno.env.get("MIDNIGHT_WALLET_SEED"),
      secret: true,
      requiredWhenDeployed: false,
    },
    {
      name: "MIDNIGHT_WALLET_MNEMONIC",
      value: Deno.env.get("MIDNIGHT_WALLET_MNEMONIC") ?? "",
      isSet: !!Deno.env.get("MIDNIGHT_WALLET_MNEMONIC")?.trim(),
      secret: true,
      requiredWhenDeployed: false,
    },
    {
      name: "MIDNIGHT_INDEXER_HTTP",
      value: midnightNetworkConfig.indexer,
      isSet: !!Deno.env.get("MIDNIGHT_INDEXER_HTTP"),
      secret: false,
      requiredWhenDeployed: false,
    },
    {
      name: "MIDNIGHT_INDEXER_WS",
      value: midnightNetworkConfig.indexerWS,
      isSet: !!Deno.env.get("MIDNIGHT_INDEXER_WS"),
      secret: false,
      requiredWhenDeployed: false,
    },
    {
      name: "MIDNIGHT_NODE_HTTP",
      value: midnightNetworkConfig.node,
      isSet: !!Deno.env.get("MIDNIGHT_NODE_HTTP"),
      secret: false,
      requiredWhenDeployed: false,
    },
    {
      name: "MIDNIGHT_PROOF_SERVER_URL",
      value: midnightNetworkConfig.proofServer,
      isSet: !!(Deno.env.get("MIDNIGHT_PROOF_SERVER_URL") || Deno.env.get("MIDNIGHT_PROOF_SERVER")),
      secret: false,
      requiredWhenDeployed: false,
    },
    {
      name: "BATCHER_URL",
      value: Deno.env.get("BATCHER_URL") || "http://localhost:3334",
      isSet: !!Deno.env.get("BATCHER_URL"),
      secret: false,
      requiredWhenDeployed: false,
    },
  ];

  const errors = printEnvTable("Dust 2 Dust — Node Environment", entries);

  if (isDeployed && !midnightNetworkConfig.walletSeed) {
    errors.push(
      `FATAL: For network '${networkId}', either MIDNIGHT_WALLET_SEED or MIDNIGHT_WALLET_MNEMONIC must be set.`,
    );
  }

  if (isDeployed && errors.length > 0) {
    for (const err of errors) console.error(err);
    Deno.exit(1);
  }
}

export const grammar = {
  midnightContractState: builtinGrammars.midnightGeneric,
} as const satisfies GrammarDefinition;

export const contractAddress = readMidnightContract(
  "contract-game2",
  {
    baseDir: path.resolve(import.meta.dirname!, "..", "midnight"),
    networkId: midnightNetworkConfig.id,
  },
).contractAddress;

if (!contractAddress) {
  throw new Error("Contract address not found");
} else {
  console.log("Contract address found:", contractAddress);
}

// ---------------------------------------------------------------------------
// Ledger parser (shared across all environments)
// ---------------------------------------------------------------------------

function decodeCell(av: AlignedValue): number | bigint | string {
  const atom = av.alignment[0];

  if (atom?.tag !== 'atom') return alignedValueToHex(av);

  switch (atom.value.tag) {
    case 'field':
      return valueToBigInt(av.value);

    case 'bytes': {
      let result = 0n;
      let shift = 0n;
      for (let atomIdx = 0; atomIdx < av.value.length; atomIdx++) {
        const chunk = av.value[atomIdx];
        const atomAlign = av.alignment[atomIdx];
        for (let i = 0; i < chunk.length; i++) {
          result |= BigInt(chunk[i]) << shift;
          shift += 8n;
        }
        // Pad to declared atom width to preserve struct field boundaries.
        // The Compact runtime trims trailing zero bytes from each atom's chunk,
        // so a Uint<32> holding value 1 is [1] (1 byte) not [1,0,0,0] (4 bytes).
        // Without padding, extractU32() reads across compressed field boundaries.
        if (atomAlign?.tag === 'atom' && atomAlign.value?.tag === 'bytes') {
          const declaredLen = atomAlign.value.length;
          if (declaredLen > chunk.length) {
            shift += BigInt(declaredLen - chunk.length) * 8n;
          }
        }
      }
      return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result;
    }

    case 'compress':
      return alignedValueToHex(av);
  }
}

function alignedValueToHex(av: AlignedValue): string {
  return "0x" + av.value
    .map((chunk: Uint8Array) =>
      Array.from(chunk).map((b) => b.toString(16).padStart(2, "0")).join("")
    )
    .join("");
}

function uint8ArrayToHexString(u8: Uint8Array): string {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Wrapper marker for struct cells (multi-atom).
 *
 * Background: the framework JSON-roundtrips the parsed payload (see
 * paima sync-protocols/midnight/fetcher.ts), which destroys class identity
 * and converts Uint8Array atoms into plain `{0:b,1:b,...}` objects. To make
 * the raw atoms survive that roundtrip we encode them as hex strings and
 * use a sentinel field (`__cell: true`) instead of an instanceof check.
 *
 * Single-atom scalar cells (Field, Uint<N>, Boolean, Bytes<N> by themselves)
 * are NOT wrapped — they continue to come through as primitives so existing
 * consumers (`extractMaps`, `toBigInt`, `Number(qty)`, `Boolean(completed)`)
 * keep working unchanged.
 */
function parseStateValue(sv: StateValue): any {
  const t = sv.type();

  if (t === "null") return null;
  if (t === "cell") {
    const av = sv.asCell();
    const packed = decodeCell(av);
    if (av.value.length > 1) {
      return {
        __cell: true,
        packed,
        atomsHex: av.value.map(uint8ArrayToHexString),
      };
    }
    return packed;
  }
  if (t === "array") return sv.asArray()!.map(parseStateValue);

  if (t === "map") {
    const m = sv.asMap()!;
    return Object.fromEntries(
      m.keys().map((k) => [
        alignedValueToHex(k),
        parseStateValue(m.get(k)!)
      ])
    );
  }

  if (t === "boundedMerkleTree") return sv.asBoundedMerkleTree()!.toString(true);

  throw new Error(`Unhandled StateValue type: "${t}"`);
}

export const ledgerParser = (state: StateValue) => parseStateValue(state);

// Shared DB connection — set by apiRouter before any blocks are processed
let dbConn: any = null;

async function waitForDb() {
  while (!dbConn) {
    console.log("Waiting for db connection...");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Sequential queue: each DB write waits for the previous to finish,
// preventing concurrent writes across consecutive blocks.
let dbQueue = Promise.resolve();

const stm = new PaimaSTM<typeof grammar, {}>(grammar);
stm.addStateTransition("midnightContractState", function* (data) {
  const { payload } = data.parsedInput;

  try {
    yield* World.promise(waitForDb());
    dbQueue = dbQueue
      .then(async () => {
        const t0 = performance.now();
        await processLedgerSnapshot(dbConn, payload);
        const elapsed = (performance.now() - t0).toFixed(1);
        console.log(`[ledger] block processed at height ${data.blockHeight} in ${elapsed}ms`);
      })
      .catch((err) => {
        console.error("[game-db] processLedgerSnapshot failed:", err);
      });
  } catch (err) {
    console.error("[game-db] processLedgerSnapshot failed:", err);
  }
});

export const gameStateTransitions: StartConfigGameStateTransitions = function* (
  _blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  yield* stm.processInput(input);
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const apiRouter: StartConfigApiRouter = async function (
  server: any,
  db: any,
): Promise<void> {
  dbConn = db;
  await ensureTables(db);
  await seedAchievements(db);

  // --- existing primitive accounting endpoint ---
  server.get("/fetch-primitive-accounting", async () => {
    const result = await db.query(`SELECT * FROM effectstream.primitive_accounting`);
    return result.rows;
  });

  // --- GET /game/players ---
  server.get("/game/players", async () => {
    return getPlayers(db);
  });

  // --- GET /game/players/:id ---
  server.get("/game/players/:id", async (request: any) => {
    const { id } = request.params;
    const detail = await getPlayerDetail(db, id);
    if (!detail) return { error: "Player not found" };
    return detail;
  });

  // --- GET /game/battles ---
  server.get("/game/battles", async (request: any) => {
    const playerId = request.query?.player_id;
    return getActiveBattles(db, playerId);
  });

  // --- GET /game/quests ---
  server.get("/game/quests", async (request: any) => {
    const playerId = request.query?.player_id;
    return getActiveQuests(db, playerId);
  });

  // --- GET /game/stats ---
  server.get("/game/stats", async () => {
    return getGameStats(db);
  });

  // -----------------------------------------------------------------------
  // PRC-6 Metrics endpoints
  // -----------------------------------------------------------------------

  // --- GET /metrics ---
  server.get("/metrics", async () => {
    const achievements = await getAllAchievements(db);
    return {
      name: "Dust 2 Dust",
      description: "A singleplayer fully on-chain deck-building dungeon-crawler game built on the Midnight Network.",
      achievements: achievements.map((a: any) => ({
        name: a.name,
        displayName: a.display_name,
        description: a.description,
        category: a.category,
        isActive: a.is_active,
        percentCompleted: 0,
      })),
      channels: [
        {
          id: "leaderboard",
          name: "Boss Points",
          description: "Points earned from quest boss victories. Harder biomes and higher difficulties award more points.",
          scoreUnit: "Points",
          sortOrder: "DESC",
        },
      ],
    };
  });

  // --- GET /metrics/leaderboard ---
  server.get("/metrics/leaderboard", async (request: any) => {
    const { startDate, endDate, limit, offset } = request.query ?? {};
    return getLeaderboard(db, {
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  });

  // --- GET /metrics/users/:address ---
  server.get("/metrics/users/:address", async (request: any) => {
    const { address } = request.params;
    const { channel, startDate, endDate } = request.query ?? {};

    const identity = await resolveUserIdentity(db, address);
    const achievements = await getUserAchievements(db, identity.address);

    const response: Record<string, any> = { identity, achievements };

    // If channel param is provided, include channel stats
    if (channel === "leaderboard" || (Array.isArray(channel) && channel.includes("leaderboard"))) {
      const now = new Date();
      const end = endDate ?? now.toISOString();
      const start = startDate ?? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const stats = await getUserLeaderboardStats(db, identity.address, start, end);

      response.channels = {
        leaderboard: {
          startDate: start,
          endDate: end,
          stats: stats ?? { score: 0, rank: 0, matchesPlayed: 0 },
        },
      };
    }

    return response;
  });
};

// ---------------------------------------------------------------------------
// Node startup — called by env-specific entry points (main.dev.ts, etc.)
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export function startNode(envConfig: any): void {
  main(function* () {
    yield* init();
    console.log("Starting EffectStream Node");

    yield* withEffectstreamStaticConfig(envConfig, function* () {
      yield* start({
        appName: "dust2dust",
        appVersion: "1.0.0",
        syncInfo: toSyncProtocolWithNetwork(envConfig),
        gameStateTransitions,
        migrations: undefined,
        apiRouter,
        grammar,
      });
    });

    yield* suspend();
  });
}
