import { runDbCommand } from "./commands/db";
import { runFumadocsCommand } from "./commands/fumadocs";
import { runSyncCommand } from "./commands/git";
import { runRepoCommand, runRepoReadmeCommand } from "./commands/repo";

type CliArgs = {
  command: string | undefined;
  rest: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  return { command, rest };
}

/**
 * @description Top-level command index and domain router for the lally CLI.
 */
function printHelp() {
  console.log("lally");
  console.log("");
  console.log("Usage:");
  console.log("  lally <domain> <command> [options]");
  console.log("");
  console.log("Domains:");
  console.log("  fumadocs  Fumadocs init/scaffold/check/clean/layout/generate commands");
  console.log("  db        Database scaffolding commands");
  console.log("  repo      Repository maintenance commands");
  console.log("  git       Git-oriented sync workflows");
  console.log("");
  console.log("Domain usage:");
  console.log("  lally fumadocs <init|section|page-shell|sidebar-history|check|clean|layout|generate> [options]");
  console.log("  lally db <local-postgres|master-migration|seed-script> [options]");
  console.log("  lally repo <readme> [options]");
  console.log("  lally git sync <init|doctor|push|pull> [options]");
  console.log("");
  console.log("Examples:");
  console.log("  lally fumadocs init --app apps/web");
  console.log("  lally fumadocs section --name handbook --app apps/web");
  console.log("  lally db local-postgres --app apps/web");
  console.log("  lally repo readme --target cli");
  console.log("  lally git sync doctor --target statements");
}

export async function runCli(argv: string[]) {
  const { command, rest } = parseArgs(argv);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "fumadocs") {
    const code = await runFumadocsCommand(rest);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "db") {
    const code = await runDbCommand(rest);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "repo") {
    const code = await runRepoCommand(rest);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "git") {
    const [subcommand, ...gitArgs] = rest;
    if (subcommand === "sync") {
      const [syncCommand, ...syncArgs] = gitArgs;
      const code = await runSyncCommand(syncCommand, syncArgs, {
        generateReadme: async (targetName: string) => runRepoReadmeCommand(["--target", targetName]),
      });
      if (code !== 0) process.exitCode = code;
      return;
    }
    console.error(`Unknown git command: ${subcommand ?? "(missing)"}`);
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log("");
  printHelp();
  process.exitCode = 1;
}
