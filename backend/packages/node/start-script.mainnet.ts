import {
  OrchestratorConfig,
  start,
} from "@paimaexample/orchestrator";
import { ComponentNames } from "@paimaexample/log";
import { Value } from "@sinclair/typebox/value";

// Mainnet: no local Midnight services (node/indexer/proof-server).
// Only EffectStream DB + Batcher are launched locally.
const config = Value.Parse(OrchestratorConfig, {
  packageName: "@paimaexample",
  logs: "stdout",
  processes: {
    [ComponentNames.EFFECTSTREAM_PGLITE]: false,
    [ComponentNames.COLLECTOR]: false,
    [ComponentNames.TMUX]: false,
    [ComponentNames.TUI]: false,
    [ComponentNames.LOKI]: false,
  },

  processesToLaunch: [],
});

await start(config);
