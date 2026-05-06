import {
  OrchestratorConfig,
  start,
} from "@paimaexample/orchestrator";
import { ComponentNames } from "@paimaexample/log";
import { Value } from "@sinclair/typebox/value";
import { launchMidnight } from "@paimaexample/orchestrator/start-midnight";

const config = Value.Parse(OrchestratorConfig, {
  packageName: "@paimaexample",
  // logs: "stdout",
  processes: {
    [ComponentNames.EFFECTSTREAM_PGLITE]: true,
    [ComponentNames.COLLECTOR]: false,
    [ComponentNames.TMUX]: true,
    [ComponentNames.TUI]: true,
  },

  processesToLaunch: [
    ...launchMidnight("@dust2dust-backend/midnight-contracts").map(p => {
      p.logsStartDisabled = false;
      p.disableStderr = false;
      p.logs = 'raw';
      return p;
    }),
    {
      name: "batcher",
      args: ["task", "-f", "@dust2dust-backend/batcher", "start"],
      waitToExit: false,
      type: "system-dependency",
      link: "http://localhost:3334",
      stopProcessAtPort: [3334],
      dependsOn: [ComponentNames.MIDNIGHT_CONTRACT],
    },
  ],
});

await start(config);
