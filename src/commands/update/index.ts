import { runUpdateLayoutCommand } from "./fumadocs/layout";
import { updateHelp } from "./help";
import { runUpdateReadmeCommand } from "./docs/readme";
import { runUpdateSubtreeCommand } from "./subtree";

export async function runUpdateCommand(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(updateHelp());
    return 0;
  }

  if (command === "readme") {
    return runUpdateReadmeCommand(args);
  }

  if (command === "layout") {
    return runUpdateLayoutCommand(args);
  }

  if (command !== "subtree") {
    console.error(`Unknown update command: ${command}`);
    console.error(updateHelp());
    return 1;
  }
  return runUpdateSubtreeCommand(args);
}
