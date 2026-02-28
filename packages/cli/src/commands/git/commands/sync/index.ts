import { runSyncAction } from "./action";
import { runSyncDoctor } from "./doctor";
import { syncHelp } from "./help";
import { runSyncInit } from "./init";

export type SyncCommandOptions = {
  generateReadme?: (targetName: string) => Promise<number>;
};

/**
 * @description Route sync subcommands to their concrete handlers.
 */
export async function runSyncCommand(
  command: string | undefined,
  args: string[],
  options?: SyncCommandOptions,
): Promise<number> {
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(syncHelp());
    return 0;
  }

  if (command === "init") return runSyncInit(args);
  if (command === "doctor") return runSyncDoctor(args);
  if (command === "push") return runSyncAction("push", args, options);
  if (command === "pull") return runSyncAction("pull", args, options);

  console.error(`Unknown sync command: ${command}`);
  console.error(syncHelp());
  return 1;
}
