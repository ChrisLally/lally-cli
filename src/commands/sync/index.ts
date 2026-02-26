import { syncHelp } from "./help";
import { runSyncAction, runSyncDoctor, runSyncInit } from "./handlers";

export async function runSyncCommand(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(syncHelp());
    return 0;
  }

  if (command === "init") return runSyncInit(args);
  if (command === "doctor") return runSyncDoctor(args);
  if (command === "push") return runSyncAction("push", args);
  if (command === "pull") return runSyncAction("pull", args);

  console.error(`Unknown sync command: ${command}`);
  console.error(syncHelp());
  return 1;
}
