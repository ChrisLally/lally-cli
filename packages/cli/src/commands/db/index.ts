import { addDbLocalPostgres, addDbMasterMigration, addDbSeedScript } from "./scaffold";
import { getStringFlag, looksLikeAppDirectory, looksLikeMonorepoRoot, parseArgs, resolveAppRoot } from "../app";

function dbHelp(): string {
  return [
    "Usage:",
    "  lally db <local-postgres|master-migration|seed-script> [--app <path>]",
    "",
    "Examples:",
    "  lally db local-postgres --app apps/web",
    "  lally db master-migration --app apps/web",
    "  lally db seed-script --app apps/web",
  ].join("\n");
}

export async function runDbCommand(args: string[]): Promise<number> {
  const { item, flags } = parseArgs(args);

  if (!item || item === "--help" || item === "-h" || item === "help") {
    console.log(dbHelp());
    return 0;
  }

  const appFlag = getStringFlag(flags, "app");
  const appRoot = resolveAppRoot(appFlag);

  if (!appFlag && looksLikeMonorepoRoot(process.cwd())) {
    console.error("Current directory looks like a monorepo root, not an app directory.");
    console.error("Use --app <path> (example: --app apps/web).");
    return 1;
  }

  if (!looksLikeAppDirectory(appRoot)) {
    console.error(`Target path does not look like an app directory: ${appRoot}`);
    console.error("Expected package.json plus app markers like next.config.*, src/app, or content.");
    return 1;
  }

  try {
    if (item === "local-postgres") {
      await addDbLocalPostgres(appRoot);
      return 0;
    }
    if (item === "master-migration") {
      await addDbMasterMigration(appRoot);
      return 0;
    }
    if (item === "seed-script") {
      await addDbSeedScript(appRoot);
      return 0;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  console.error(`Unknown db command: ${item}`);
  console.error(dbHelp());
  return 1;
}
