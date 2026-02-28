import { runRepoReadmeCommand } from "./readme";

/**
 * @description Repository maintenance commands, including README generation and checks.
 */
function repoHelp(): string {
  return [
    "Usage:",
    "  lally repo <readme> [options]",
    "",
    "Examples:",
    "  lally repo readme --target cli",
    "  lally repo readme --target cli --check",
    "  lally repo readme --target cli --print",
  ].join("\n");
}

export async function runRepoCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(repoHelp());
    return 0;
  }

  if (subcommand === "readme") {
    return runRepoReadmeCommand(rest);
  }

  console.error(`Unknown repo command: ${subcommand}`);
  console.error(repoHelp());
  return 1;
}
