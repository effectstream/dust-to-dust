import {
  ConfigBuilder,
  ConfigNetworkType,
  ConfigSyncProtocolType,
  midnightNetworkConfig,
  PrimitiveTypeMidnightGeneric,
  contractAddress,
  ledgerParser,
  startNode,
  validateAndPrintNodeEnv,
} from "./main.ts";

export const testnetConfig = new ConfigBuilder()
  .setNamespace(
    (builder) => builder.setSecurityNamespace("dust2dust"),
  )
  .buildNetworks((builder) =>
    builder
      .addNetwork({
        name: "ntp",
        type: ConfigNetworkType.NTP,
        startTime: new Date().getTime(),
        blockTimeMS: 1000,
      })
      .addNetwork({
        name: "midnight",
        type: ConfigNetworkType.MIDNIGHT,
        networkId: midnightNetworkConfig.id,
        nodeUrl: midnightNetworkConfig.node,
      })
  )
  .buildDeployments((builder) => builder)
  .buildSyncProtocols((builder) =>
    builder
      .addMain(
        (networks) => networks.ntp,
        (_network, _deployments) => ({
          name: "mainNtp",
          type: ConfigSyncProtocolType.NTP_MAIN,
          chainUri: "",
          startBlockHeight: 1,
          pollingInterval: 1000,
        }),
      )
      .addParallel(
        (networks) => (networks as any).midnight,
        (_network, _deployments) => ({
          name: "parallelMidnight",
          type: ConfigSyncProtocolType.MIDNIGHT_PARALLEL,
          startBlockHeight: 1,
          pollingInterval: 6000,
          delayMs: 0,
          stepSize: 2,
          indexer: midnightNetworkConfig.indexer,
          indexerWs: midnightNetworkConfig.indexerWS,
        }),
      )
  )
  .buildPrimitives((builder) =>
    builder
      .addPrimitive(
        (syncProtocols) => (syncProtocols as any).parallelMidnight,
        (_network, _deployments, _syncProtocol) => ({
          name: "MidnightContractState",
          type: PrimitiveTypeMidnightGeneric,
          startBlockHeight: 1,
          contractAddress,
          stateMachinePrefix: "midnightContractState",
          contract: { ledger: ledgerParser },
          networkId: midnightNetworkConfig.id,
        }),
      )
  )
  .build();

validateAndPrintNodeEnv();
startNode(testnetConfig);
