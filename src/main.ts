import { runAddCommand } from "./commands/add/index";
import { runCheckCommand } from "./commands/check/index";
import { runCleanCommand } from "./commands/clean/index";
import { runInitCommand } from "./commands/init/index";
import { runReleaseCommand } from "./commands/release/index";
import { runSyncCommand } from "./commands/sync/index";
import { runUpdateCommand } from "./commands/update/index";

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
  console.log("  lally <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  init      Initialize app config/presets");
  console.log("  add       Add scaffolds (fumadocs, db)");
  console.log("  check     Validate project setup (read-only)");
  console.log("  clean     Clean template leftovers (safe dry-run default)");
  console.log("  sync      Sync package/app slices to public repos");
  console.log("  update    Run maintenance/update utilities");
  console.log("  release   Publish @chris-lally packages");
  console.log("");
  console.log("Command usage:");
  console.log("  lally init [fumadocs/base-path] [--app <path>]");
  console.log("  lally add <namespace/item> [--app <path>]");
  console.log("  lally check fumadocs [--app <path>] [--strict-layout] [--json]");
  console.log("  lally clean fumadocs [--app <path>] [--keep <glob>] [--apply] [--delete]");
  console.log("  lally sync <init|doctor|push|pull> [options]");
  console.log("  lally update subtree --script <script-name> [--dir <path>] [--json]");
  console.log("  lally update layout --preset notebook-topnav [--app <path>]");
  console.log("  lally update readme --target <name> [--check]");
  console.log("  lally release <target> --tag <tag> [--dry-run] [--json]");
  console.log("");
  console.log("Examples:");
  console.log("  lally init fumadocs/base-path --app apps/web");
  console.log("  lally add fumadocs/sidebar-history");
  console.log("  lally add fumadocs/section --name handbook --app apps/web");
  console.log("  lally check fumadocs --app apps/web");
  console.log("  lally check fumadocs --app apps/web --strict-layout");
  console.log("  lally clean fumadocs --app apps/web");
  console.log("  lally clean fumadocs --app apps/web --apply");
  console.log("  lally add db/local-postgres --app apps/web");
  console.log("  lally sync doctor --target statements");
  console.log("  lally sync push --target statements");
  console.log("  lally update subtree --script sync-push.sh");
  console.log("  lally update subtree --target statements --action push");
  console.log("  lally update layout --preset notebook-topnav --app apps/web");
  console.log("  lally update readme --target cli");
  console.log("  lally release fumadocs --tag alpha --dry-run");
  console.log("");
  console.log("Notes:");
  console.log("  - Use --app when running from monorepo root.");
  console.log("  - `clean` is dry-run by default; add --apply to execute.");
  console.log("  - For detailed help: lally <command> --help");
}

export async function runCli(argv: string[]) {
  const { command, rest } = parseArgs(argv);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "init") {
    await runInitCommand(rest);
    return;
  }

  if (command === "add") {
    await runAddCommand(rest);
    return;
  }

  if (command === "check") {
    const code = await runCheckCommand(rest);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "clean") {
    const code = await runCleanCommand(rest);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "release") {
    const [target, ...releaseArgs] = rest;
    const code = await runReleaseCommand(target, releaseArgs);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "sync") {
    const [subcommand, ...syncArgs] = rest;
    const code = await runSyncCommand(subcommand, syncArgs);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "update") {
    const [subcommand, ...updateArgs] = rest;
    const code = await runUpdateCommand(subcommand, updateArgs);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (command === "project") {
    console.warn("`lally project` is deprecated. Use `lally update`.");
    const [subcommand, ...updateArgs] = rest;
    const code = await runUpdateCommand(subcommand, updateArgs);
    if (code !== 0) process.exitCode = code;
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.log("");
  printHelp();
  process.exitCode = 1;
}
