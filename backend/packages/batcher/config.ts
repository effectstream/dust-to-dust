import {
  type BatcherConfig,
  FileStorage,
  MidnightBalancingAdapter,
} from "@paimaexample/batcher";
import { readMidnightContract } from "@paimaexample/midnight-contracts/read-contract";
import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import * as path from "@std/path";
import process from "node:process";

const batchIntervalMs = 1000;
const port = Number(Deno.env.get("BATCHER_PORT") ?? "3334");

let midnightContractData: ReturnType<typeof readMidnightContract> | null = null;
try {
  midnightContractData = readMidnightContract(
    "contract-game2",
    {
      baseDir: path.resolve(import.meta.dirname!, "..", "midnight"),
      networkId: midnightNetworkConfig.id,
    },
  );
} catch (e) {
  console.warn(
    `Warning: Could not load contract address file: ${(e as Error).message}`,
  );
  console.warn(
    "   The standard midnight adapter will be disabled. " +
      "The midnight_balancing adapter (for delegated tx) will still work.",
  );
  throw e;
}

const zkConfigPath = midnightContractData?.zkConfigPath ??
  path.resolve(
    import.meta.dirname!,
    "..", "midnight", "contract-game2", "src", "managed"
  );

let seeds = process.env.MIDNIGHT_WALLET_SEEDS?.split(',');
if (midnightNetworkConfig.id === 'undeployed') {
  seeds = [midnightNetworkConfig.walletSeed!];
} else {
  if (!seeds || seeds.length === 0) {
    throw new Error('MIDNIGHT_WALLET_SEEDS is not set');
  }
}

const midnightBalancingAdapter = new MidnightBalancingAdapter(
  seeds,
  {
    syncProtocolName: 'parallelMidnight',
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
    walletNetworkId: midnightNetworkConfig.id,
    walletFundingTimeoutSeconds: 60 * 20,
    addShieldedPadding: false,
  },
);

export const config: BatcherConfig = {
  pollingIntervalMs: batchIntervalMs,
  adapters: {
    ...({ midnight_balancing: midnightBalancingAdapter }),
  },
  defaultTarget: "midnight_balancing",
  namespace: "",
  batchingCriteria: {
    ...({ midnight_balancing: { criteriaType: "time", timeWindowMs: batchIntervalMs } }),
  },
  confirmationLevel: "wait-effectstream-processed",
  enableHttpServer: true,
  enableEventSystem: true,
  port,
};

export const storage = new FileStorage("./batcher-data");

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

export function validateAndPrintBatcherEnv(): void {
  const networkId = midnightNetworkConfig.id as string;
  const isDeployed = networkId !== "undeployed";

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
      name: "MIDNIGHT_WALLET_SEEDS",
      value: process.env.MIDNIGHT_WALLET_SEEDS ?? "",
      isSet: !!process.env.MIDNIGHT_WALLET_SEEDS,
      secret: true,
      requiredWhenDeployed: true,
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
      name: "BATCHER_PORT",
      value: String(port),
      isSet: !!Deno.env.get("BATCHER_PORT"),
      secret: false,
      requiredWhenDeployed: false,
    },
  ];

  const errors = printEnvTable("Dust 2 Dust — Batcher Environment", entries);

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
