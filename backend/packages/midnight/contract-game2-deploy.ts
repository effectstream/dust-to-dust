/**
 * Deploy Game2 contract to the Midnight network.
 *
 * Deploys the contract with a stripped state (no verifier keys) first,
 * then inserts each verifier key one-by-one in separate maintenance
 * transactions to avoid exceeding block size limits.
 *
 * Supports resuming: saves progress to deployment-state.json so that
 * if interrupted, re-running picks up where it left off.
 */

import { midnightNetworkConfig } from "@paimaexample/midnight-contracts/midnight-env";
import { buildWalletFacade, getInitialShieldedState, configureMidnightNodeProviders, syncAndWaitForFunds } from "@paimaexample/midnight-contracts";
import {
  Contract,
  createGame2PrivateState,
  type Game2PrivateState,
  witnesses,
} from "./contract-game2/src/index.ts";
import { fromFileUrl, dirname, join } from "@std/path";
import { setNetworkId, getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CompiledContract, ContractExecutable } from "@midnight-ntwrk/compact-js";
import {
  ProvableCircuitId,
  VerifierKey,
} from "@midnight-ntwrk/compact-js/effect/Contract";
import {
  asContractAddress,
  exitResultOrError,
  makeContractExecutableRuntime,
} from "@midnight-ntwrk/midnight-js-types";
import { SucceedEntirely } from "@midnight-ntwrk/midnight-js-types";
import {
  ContractDeploy as LedgerV8ContractDeploy,
  ContractState as LedgerV8ContractState,
  Intent as LedgerV8Intent,
  Transaction as LedgerV8Transaction,
} from "@midnight-ntwrk/ledger-v8";
import { sampleSigningKey } from "@midnight-ntwrk/compact-runtime";
import type { NetworkId } from "@midnight-ntwrk/wallet-sdk-abstractions";

// ── Types ────────────────────────────────────────────────────────────────────

interface DeploymentState {
  contractAddress: string;
  deployedCircuits: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const TTL_DURATION_MS = 60 * 60 * 1000;
const CONTRACT_NAME = "contract-game2";

/** Order in which verifier keys are inserted */
const CIRCUIT_PRIORITY = [
  "register_new_player",
  "start_new_battle",
  "combat_round",
  "retreat_from_battle",
  "start_new_quest",
  "is_quest_ready",
  "finalize_quest",
  "sell_ability",
  "upgrade_ability",
  "admin_level_new",
  "admin_level_add_config",
  "admin_set_quest_duration",
  "register_delegation",
];

// ── Env → frontend file mapping ─────────────────────────────────────────────

type EnvMapping = {
  envFile: string;
  addressExport: string;
};

const ENV_MAP: Record<string, EnvMapping> = {
  undeployed: {
    envFile: ".env.undeployed",
    addressExport: "UNDEPLOYED_CONTRACT_ADDRESS",
  },
  preprod: {
    envFile: ".env.preprod",
    addressExport: "PREPROD_CONTRACT_ADDRESS",
  },
  preview: {
    envFile: ".env.preview",
    addressExport: "PREVIEW_CONTRACT_ADDRESS",
  },
  mainnet: {
    envFile: ".env.mainnet",
    addressExport: "MAINNET_CONTRACT_ADDRESS",
  },
};

function getEnvMapping(networkId: string): EnvMapping {
  const mapping = ENV_MAP[networkId];
  if (!mapping) {
    throw new Error(
      `No frontend env mapping for MIDNIGHT_NETWORK_ID="${networkId}". ` +
      `Valid values: ${Object.keys(ENV_MAP).join(", ")}`,
    );
  }
  return mapping;
}

if (midnightNetworkConfig.id === "mainnet") {
  if (!Deno.env.get("MIDNIGHT_NODE_URL")) {
    throw new Error("MIDNIGHT_NODE_URL is not set");
  }
  midnightNetworkConfig.node = Deno.env.get("MIDNIGHT_NODE_URL")!;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTtl(): Date {
  return new Date(Date.now() + TTL_DURATION_MS);
}

function hasManagedArtifacts(dir: string): boolean {
  const requiredDirs = ["contract", "compiler"];
  try {
    return requiredDirs.every((name) => {
      const stats = Deno.statSync(join(dir, name));
      return stats.isDirectory;
    });
  } catch {
    return false;
  }
}

function findCompilerSubdirectory(managedDir: string): string {
  try {
    for (const entry of Deno.readDirSync(managedDir)) {
      if (!entry.isDirectory) continue;
      const candidate = join(managedDir, entry.name);
      if (hasManagedArtifacts(candidate)) {
        return entry.name;
      }
    }
  } catch (_error) {
    throw new Error(`Managed directory not found: ${managedDir}`);
  }
  if (hasManagedArtifacts(managedDir)) {
    return "";
  }
  throw new Error(
    `No compiler artifacts found in managed directory: ${managedDir}.`,
  );
}

// ── Update frontend files ───────────────────────────────────────────────────

async function updateFrontendEnv(contractAddress: string): Promise<void> {
  const networkId = midnightNetworkConfig.id;
  const mapping = getEnvMapping(networkId);

  const here = dirname(fromFileUrl(import.meta.url));
  const root = join(here, "../../..");

  const envPath = join(root, "frontend/src/phaser", mapping.envFile);
  try {
    const envContent = await Deno.readTextFile(envPath);
    if (envContent.match(/^VITE_CONTRACT_ADDRESS=/m)) {
      const updatedEnv = envContent.replace(
        /^VITE_CONTRACT_ADDRESS=.*$/m,
        `VITE_CONTRACT_ADDRESS=${contractAddress}`,
      );
      await Deno.writeTextFile(envPath, updatedEnv);
    } else {
      await Deno.writeTextFile(envPath, envContent.trimEnd() + `\nVITE_CONTRACT_ADDRESS=${contractAddress}\n`);
    }
    console.log(`Updated ${envPath} with VITE_CONTRACT_ADDRESS=${contractAddress}`);
  } catch (e) {
    console.warn(`Could not update ${envPath}: ${(e as Error).message}`);
  }

  const addrPath = join(root, "frontend/src/phaser/src/contract-addresses.ts");
  try {
    const addrContent = await Deno.readTextFile(addrPath);
    const exportPattern = new RegExp(
      `^export const ${mapping.addressExport} = '.*';$`,
      "m",
    );
    const updatedAddr = addrContent.replace(
      exportPattern,
      `export const ${mapping.addressExport} = '${contractAddress}';`,
    );
    await Deno.writeTextFile(addrPath, updatedAddr);
    console.log(`Updated ${addrPath} with ${mapping.addressExport}=${contractAddress}`);
  } catch (e) {
    console.warn(`Could not update ${addrPath}: ${(e as Error).message}`);
  }
}

// ── Insert a single verifier key via maintenance transaction ────────────────

async function submitInsertVerifierKeyTx(
  providers: any,
  compiledContract: any,
  contractAddress: string,
  circuitId: string,
  verifierKey: unknown,
  walletResult: any,
) {
  const contractState = await providers.publicDataProvider.queryContractState(
    contractAddress as any,
  );
  if (!contractState) {
    throw new Error(
      `No contract state found on chain for address '${contractAddress}'`,
    );
  }

  const signingKey = await providers.privateStateProvider.getSigningKey(
    contractAddress,
  );
  if (!signingKey) {
    throw new Error(
      `Signing key for contract address '${contractAddress}' not found`,
    );
  }

  const contractExec = ContractExecutable.make(compiledContract);
  const contractRuntime = makeContractExecutableRuntime(
    providers.zkConfigProvider,
    {
      coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      signingKey,
    },
  );

  const exitResult = await contractRuntime.runPromiseExit(
    (contractExec as any).addOrReplaceContractOperation(
      ProvableCircuitId(circuitId as any),
      VerifierKey(verifierKey as Uint8Array),
      {
        address: asContractAddress(contractAddress),
        contractState,
      },
    ),
  );
  const maintenanceResult = exitResultOrError(exitResult as any) as any;
  const unprovenTx = LedgerV8Transaction.fromParts(
    getNetworkId(),
    undefined,
    undefined,
    LedgerV8Intent.new(createTtl()).addMaintenanceUpdate(
      maintenanceResult.public.maintenanceUpdate,
    ),
  );

  const recipe = await walletResult.wallet.balanceUnprovenTransaction(
    unprovenTx as any,
    {
      shieldedSecretKeys: walletResult.walletZswapSecretKeys as any,
      dustSecretKey: walletResult.walletDustSecretKey as any,
    },
    { ttl: createTtl() },
  );

  const signedRecipe = await walletResult.wallet.signRecipe(
    recipe,
    (payload: any) => walletResult.unshieldedKeystore.signData(payload),
  );

  const finalizedTx = await walletResult.wallet.finalizeRecipe(signedRecipe);
  const txId = await walletResult.wallet.submitTransaction(finalizedTx);
  return await providers.publicDataProvider.watchForTxData(txId);
}

// ── Circuit-by-circuit deploy ───────────────────────────────────────────────

async function deployWithLimitedVerifierKeys(
  providers: any,
  compiledContract: any,
  initialPrivateState: Game2PrivateState,
  walletResult: any,
  stateFilePath: string,
): Promise<string> {
  let deploymentState: DeploymentState = {
    contractAddress: "",
    deployedCircuits: [],
  };

  // Check for resumable state
  try {
    const content = await Deno.readTextFile(stateFilePath);
    deploymentState = JSON.parse(content);
    console.log(
      `[INFO] Resuming deployment for contract: ${deploymentState.contractAddress}`,
    );
  } catch (_error) {
    // No existing state, start fresh
  }

  let contractAddress = deploymentState.contractAddress;

  if (!contractAddress) {
    const signingKey = sampleSigningKey();
    const coinPublicKey = providers.walletProvider.getCoinPublicKey().toString();

    // Step 1: Initialize the contract to get valid state
    const contractExec = ContractExecutable.make(compiledContract);
    const contractRuntime = makeContractExecutableRuntime(
      providers.zkConfigProvider,
      { coinPublicKey, signingKey },
    );

    console.log("[INFO] Running contract initialization...");
    const exitResult = await contractRuntime.runPromiseExit(
      (contractExec as any).initialize(initialPrivateState),
    );

    let initResult: any;
    try {
      initResult = exitResultOrError(exitResult);
    } catch (error) {
      const err = error as any;
      if (err?.["_tag"] === "ContractRuntimeError" && err?.cause?.name === "CompactError") {
        throw new Error(err.cause.message);
      }
      throw error;
    }

    const privateState = initResult.private.privateState;
    const derivedSigningKey = initResult.private.signingKey;
    const fullContractState = initResult.public.contractState;

    // Step 2: Convert to ledger ContractState
    const fullLedgerState = LedgerV8ContractState.deserialize(
      fullContractState.serialize(),
    );
    console.log(`[INFO] Full state has ${fullLedgerState.operations().length} operations`);

    // Step 3: Create stripped ContractState (data + maintenance authority, NO verifier keys)
    const strippedState = new LedgerV8ContractState();
    strippedState.data = fullLedgerState.data;
    strippedState.maintenanceAuthority = fullLedgerState.maintenanceAuthority;
    console.log("[INFO] Created stripped contract state (no verifier keys)");

    // Step 4: Build and submit deploy transaction
    const contractDeploy = new LedgerV8ContractDeploy(strippedState);
    contractAddress = contractDeploy.address;

    const intent = LedgerV8Intent.new(createTtl()).addDeploy(contractDeploy);
    const unprovenTx = LedgerV8Transaction.fromParts(
      getNetworkId(),
      undefined,
      undefined,
      intent,
    );

    console.log(`[INFO] Deploy tx built for contract address: ${contractAddress}`);

    const recipe = await walletResult.wallet.balanceUnprovenTransaction(
      unprovenTx as any,
      {
        shieldedSecretKeys: walletResult.walletZswapSecretKeys as any,
        dustSecretKey: walletResult.walletDustSecretKey as any,
      },
      { ttl: createTtl() },
    );

    const signedRecipe = await walletResult.wallet.signRecipe(
      recipe,
      (payload: any) => walletResult.unshieldedKeystore.signData(payload),
    );

    const finalizedTx = await walletResult.wallet.finalizeRecipe(signedRecipe);

    console.log("[INFO] Submitting deploy transaction...");
    const txId = await walletResult.wallet.submitTransaction(finalizedTx);
    console.log(`[INFO] Deploy transaction submitted, txId: ${txId}`);

    const finalizedTxData = await providers.publicDataProvider.watchForTxData(txId);
    if (finalizedTxData.status !== SucceedEntirely) {
      throw new Error(`Deployment failed with status ${finalizedTxData.status}`);
    }
    console.log("[INFO] Deploy transaction finalized on-chain.");

    // Save private state and signing key first (before saving deployment state)
    try {
      (providers.privateStateProvider as any).setContractAddress(contractAddress);
      await providers.privateStateProvider.set("game2PrivateState", privateState);
      await providers.privateStateProvider.setSigningKey(contractAddress, derivedSigningKey);
      console.log("[INFO] Private state and signing key saved.");
    } catch (e) {
      console.warn(`[WARN] Could not save private state: ${(e as Error).message}`);
      // Continue — VK insertion doesn't need private state in LevelDB,
      // we'll use a fresh signing key approach below.
    }

    // Save deployment progress state
    deploymentState.contractAddress = contractAddress;
    await Deno.writeTextFile(stateFilePath, JSON.stringify(deploymentState, null, 2));
  } else {
    // Resuming — we need to ensure signing key is available.
    // Re-derive and save it since it may not have been persisted.
    const signingKey = sampleSigningKey();
    try {
      await providers.privateStateProvider.setSigningKey(contractAddress, signingKey);
      console.log("[INFO] Re-saved signing key for resumed deployment.");
    } catch (e) {
      console.warn(`[WARN] Could not save signing key: ${(e as Error).message}`);
    }
  }

  // Step 5: Insert verifier keys one-by-one
  const allVerifierKeysMap = await providers.zkConfigProvider.getVerifierKeys(
    CIRCUIT_PRIORITY as any,
  );
  const verifierKeys = Array.from(allVerifierKeysMap as any) as [string, unknown][];

  // Sort by priority
  verifierKeys.sort((a, b) => {
    const idxA = CIRCUIT_PRIORITY.indexOf(a[0]);
    const idxB = CIRCUIT_PRIORITY.indexOf(b[0]);
    if (idxA === -1 && idxB === -1) return 0;
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });

  console.log(`[INFO] Inserting ${verifierKeys.length} verifier keys individually...`);

  for (const [circuitId, verifierKey] of verifierKeys) {
    if (deploymentState.deployedCircuits.includes(circuitId as string)) {
      console.log(`[INFO] Skipping already deployed circuit: ${circuitId}`);
      continue;
    }

    console.log(`[INFO] Inserting verifier key for circuit: ${circuitId}`);

    let retries = 3;
    while (retries > 0) {
      try {
        const submitResult = await submitInsertVerifierKeyTx(
          providers,
          compiledContract,
          contractAddress,
          circuitId,
          verifierKey,
          walletResult,
        );

        if (submitResult.status !== SucceedEntirely) {
          throw new Error(
            `Insert verifier key failed for ${circuitId} with status ${submitResult.status}`,
          );
        }
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        console.warn(
          `[WARN] Retry inserting ${circuitId} (${3 - retries}/3): ${(error as Error).message}`,
        );
        await new Promise((r) => setTimeout(r, 2000 * (3 - retries)));
      }
    }

    console.log(`[INFO] Verifier key inserted for circuit: ${circuitId}`);
    deploymentState.deployedCircuits.push(circuitId as string);
    await Deno.writeTextFile(stateFilePath, JSON.stringify(deploymentState, null, 2));
  }

  console.log("[INFO] All verifier keys inserted successfully.");

  // Clean up state file
  try {
    await Deno.remove(stateFilePath);
  } catch (_e) {
    // Ignore
  }

  return contractAddress;
}

// ── Main ────────────────────────────────────────────────────────────────────

const command = Deno.args[0];

if (command === "patch-frontend-env") {
  const { readMidnightContract } = await import("@paimaexample/midnight-contracts/read-contract");
  const data = readMidnightContract(CONTRACT_NAME, {
    baseDir: dirname(fromFileUrl(import.meta.url)),
    networkId: midnightNetworkConfig.id,
  });
  if (!data.contractAddress) {
    console.error("No deployed contract address found for network:", midnightNetworkConfig.id);
    Deno.exit(1);
  }
  console.log(`Patching frontend env for network "${midnightNetworkConfig.id}" with address: ${data.contractAddress}`);
  await updateFrontendEnv(data.contractAddress);
  Deno.exit(0);
}

// ── Deploy ──────────────────────────────────────────────────────────────────

console.log("Deploying contract with network config:", midnightNetworkConfig);

const resolvedNetworkId = midnightNetworkConfig.id as NetworkId.NetworkId;
setNetworkId(resolvedNetworkId);

// Set default storage password if not set
if (!Deno.env.get("MIDNIGHT_STORAGE_PASSWORD")) {
  Deno.env.set("MIDNIGHT_STORAGE_PASSWORD", "YourPasswordMy1!");
  console.log("[INFO] MIDNIGHT_STORAGE_PASSWORD not set, using default for local dev");
}

const here = dirname(fromFileUrl(import.meta.url));
const managedDir = join(here, CONTRACT_NAME, "src/managed");
const compilerSubdir = findCompilerSubdirectory(managedDir);
const zkConfigPath = join(here, CONTRACT_NAME, "src/managed", compilerSubdir);
const stateFilePath = join(here, "deployment-state.json");

// Build wallet
console.log("[INFO] Building wallet...");
const walletResult = await buildWalletFacade(
  {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  },
  midnightNetworkConfig.walletSeed!,
  resolvedNetworkId,
);

const initialState = await getInitialShieldedState(walletResult.wallet.shielded);
const walletAddress = initialState.address.coinPublicKeyString();
console.log(`[INFO] Wallet address: ${walletAddress}`);
console.log(`[INFO] Dust address: ${walletResult.dustAddress}`);

// Wait for wallet to sync and have funds
console.log("[INFO] Waiting for wallet to sync and receive funds...");
const { shieldedBalance, unshieldedBalance, dustBalance } = await syncAndWaitForFunds(
  walletResult.wallet,
);
console.log(`[INFO] Balances — shielded: ${shieldedBalance}, unshielded: ${unshieldedBalance}, dust: ${dustBalance}`);
console.log("[INFO] Wallet built successfully.");

// Configure providers
console.log("[INFO] Configuring providers...");
const providers = configureMidnightNodeProviders(
  walletResult.wallet,
  walletResult.zswapSecretKeys,
  walletResult.walletZswapSecretKeys,
  walletResult.dustSecretKey,
  walletResult.walletDustSecretKey,
  {
    indexer: midnightNetworkConfig.indexer,
    indexerWS: midnightNetworkConfig.indexerWS,
    node: midnightNetworkConfig.node,
    proofServer: midnightNetworkConfig.proofServer,
  },
  "game2-private-state-deploy",
  zkConfigPath,
  walletResult.unshieldedKeystore,
);
console.log("[INFO] Providers configured.");

// Create compiled contract
const compiledContract = CompiledContract.make(CONTRACT_NAME, Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets(managedDir),
);

const initialPrivateState = createGame2PrivateState(
  crypto.getRandomValues(new Uint8Array(32)),
) as Game2PrivateState;

try {
  const contractAddress = await deployWithLimitedVerifierKeys(
    providers,
    compiledContract,
    initialPrivateState,
    walletResult,
    stateFilePath,
  );

  console.log(`\n[INFO] Deployment successful. Contract address: ${contractAddress}`);
  await updateFrontendEnv(contractAddress);

  // Save contract address to file
  const networkSuffix = `.${resolvedNetworkId}`;
  const outputPath = join(here, `contract-game2${networkSuffix}.json`);
  await Deno.writeTextFile(outputPath, JSON.stringify({ contractAddress }, null, 2));
  console.log(`[INFO] Contract address saved to ${outputPath}`);

  Deno.exit(0);
} catch (e) {
  console.error("[ERROR] Deployment failed:", e);
  Deno.exit(1);
} finally {
  try {
    await walletResult.wallet.stop();
  } catch (_e) {
    // Ignore
  }
}
