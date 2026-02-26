import { addDbLocalPostgres, addDbMasterMigration, addDbSeedScript } from "./db";
import { addFumadocsSection, addPageShell, addSidebarHistory } from "./fumadocs";
import {
  getStringFlag,
  looksLikeAppDirectory,
  looksLikeMonorepoRoot,
  parseArgs,
  resolveAppRoot,
} from "./shared";

type AddItem =
  | "fumadocs/section"
  | "fumadocs/page-shell"
  | "fumadocs/sidebar-history"
  | "db/local-postgres"
  | "db/master-migration"
  | "db/seed-script";

const SUPPORTED_ITEMS: AddItem[] = [
  "fumadocs/section",
  "fumadocs/page-shell",
  "fumadocs/sidebar-history",
  "db/local-postgres",
  "db/master-migration",
  "db/seed-script",
];

function addHelp(): string {
  return [
    "Usage:",
    "  lally add <namespace/item> [--app <path>]",
    "",
    "Supported items:",
    "  fumadocs/section         Add a root section under content/<contentRoot>",
    "  fumadocs/page-shell      Add a notebook page shell component",
    "  fumadocs/sidebar-history Add global sidebar history banner wiring",
    "  db/local-postgres        Add local DB create/migrate/reset scripts",
    "  db/master-migration      Add db/migrations/tables.sql scaffold",
    "  db/seed-script           Add local seed script + package scripts",
    "",
    "Examples:",
    "  lally add fumadocs/section --name handbook --app apps/web",
    "  lally add fumadocs/page-shell --app apps/web",
    "  lally add db/local-postgres --app apps/web",
    "",
    "Notes:",
    "  - If run from monorepo root, pass --app.",
    "  - Uses lally.config.json fumadocs.basePath/contentRoot when available.",
  ].join("\n");
}

export async function runAddCommand(args: string[]) {
  const { item, flags } = parseArgs(args);

  if (!item || item === "--help" || item === "-h" || item === "help") {
    console.log(addHelp());
    if (!item || item === "--help" || item === "-h" || item === "help") {
      return;
    }
  }

  if (!item) {
    console.error("Missing item name.");
    console.error(addHelp());
    process.exitCode = 1;
    return;
  }

  if (!SUPPORTED_ITEMS.includes(item as AddItem)) {
    console.error(`Unsupported item: ${item}`);
    console.error(addHelp());
    process.exitCode = 1;
    return;
  }

  const appFlag = getStringFlag(flags, "app");
  const appRoot = resolveAppRoot(appFlag);

  if (!appFlag && looksLikeMonorepoRoot(process.cwd())) {
    console.error("Current directory looks like a monorepo root, not an app directory.");
    console.error("Use --app <path> (example: --app apps/web).");
    process.exitCode = 1;
    return;
  }

  if (!looksLikeAppDirectory(appRoot)) {
    console.error(`Target path does not look like an app directory: ${appRoot}`);
    console.error("Expected package.json plus app markers like next.config.*, src/app, or content.");
    process.exitCode = 1;
    return;
  }

  try {
    if (item === "fumadocs/section") {
      const name = getStringFlag(flags, "name");
      if (!name) {
        console.error("Missing required flag: --name");
        console.log("Usage: lally add fumadocs/section --name <section-name> [--app <path>]");
        process.exitCode = 1;
        return;
      }
      await addFumadocsSection(appRoot, name);
      return;
    }

    if (item === "fumadocs/page-shell") {
      await addPageShell(appRoot);
      return;
    }

    if (item === "fumadocs/sidebar-history") {
      await addSidebarHistory(appRoot);
      return;
    }

    if (item === "db/local-postgres") {
      await addDbLocalPostgres(appRoot);
      return;
    }

    if (item === "db/master-migration") {
      await addDbMasterMigration(appRoot);
      return;
    }

    if (item === "db/seed-script") {
      await addDbSeedScript(appRoot);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
