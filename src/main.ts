import { runDbCommand } from "./commands/db/index";
import { runRepoCommand } from "./commands/repo/index";
import { runFumadocsCommand } from "./commands/fumadocs/index";
import { runSyncCommand } from "./commands/git/sync/index";
import { runOpensrcCommand } from "./commands/opensrc/index";
import { runReleaseCommand } from "./commands/npm/release/index";

type CliArgs = {
  command: string | undefined;
  rest: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const [command, ...rest] = argv;
  return { command, rest };
}

function printHelp() {
  console.log("lally");
  console.log("");
  console.log("Usage:");
  console.log("  lally <domain> <command> [options]");
  console.log("");
  console.log("Domains:");
  console.log("  opensrc   Fetch/list/remove source context via opensrc");
  console.log("  fumadocs  Fumadocs init/scaffold/check/clean/layout commands");
  console.log("  db        Database scaffolding commands");
  console.log("  repo      Repository maintenance commands");
  console.log("  git       Git-oriented sync workflows");
  console.log("  npm       npm release workflows");
  console.log("");
  console.log("Domain usage:");
  console.log("  lally opensrc <fetch|list|remove> [...args]");
  console.log("  lally fumadocs <init|section|page-shell|sidebar-history|check|clean|layout> [options]");
  console.log("  lally db <local-postgres|master-migration|seed-script> [options]");
  console.log("  lally repo <readme> [options]");
  console.log("  lally git sync <init|doctor|push|pull> [options]");
  console.log("  lally npm release <target> --tag <tag> [--dry-run] [--json]");
  console.log("");
  console.log("Examples:");
  console.log("  lally opensrc fetch zod github:shadcn-ui/ui --modify=false");
  console.log("  lally opensrc list");
  console.log("  lally opensrc remove zod");
  console.log("  lally fumadocs init --app apps/web");
  console.log("  lally fumadocs section --name handbook --app apps/web");
  console.log("  lally db local-postgres --app apps/web");
  console.log("  lally repo readme --target cli");
  console.log("  lally git sync doctor --target statements");
  console.log("  lally npm release cli --tag alpha --dry-run");
}

async function runOpenSrcDomain(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log("Usage: lally opensrc <fetch|list|remove> [...args]");
    return 0;
  }

  try {
    if (subcommand === "fetch") {
      runOpensrcCommand(rest, undefined);
      return 0;
    }

    if (subcommand === "list") {
      runOpensrcCommand(["list"], undefined);
      return 0;
    }

    if (subcommand === "remove") {
      runOpensrcCommand(["remove", ...rest], undefined);
      return 0;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  console.error(`Unknown opensrc command: ${subcommand}`);
  return 1;
}

export async function runCli(argv: string[]) {
  const { command, rest } = parseArgs(argv);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "opensrc") {
    const code = await runOpenSrcDomain(rest);
    if (code !== 0) process.exitCode = code;
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
      const code = await runSyncCommand(syncCommand, syncArgs);
      if (code !== 0) process.exitCode = code;
      return;
    }
    console.error(`Unknown git command: ${subcommand ?? "(missing)"}`);
    process.exitCode = 1;
    return;
  }

  if (command === "npm") {
    const [subcommand, ...npmArgs] = rest;
    if (subcommand === "release") {
      const [target, ...releaseArgs] = npmArgs;
      const code = await runReleaseCommand(target, releaseArgs);
      if (code !== 0) process.exitCode = code;
      return;
    }
    console.error(`Unknown npm command: ${subcommand ?? "(missing)"}`);
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log("");
  printHelp();
  process.exitCode = 1;
}
