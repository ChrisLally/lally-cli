import { runCheckCommand } from "./check/index";
import { runCleanCommand } from "./clean/index";
import { runInitCommand } from "./init/index";
import { runFumadocsLayoutCommand } from "./layout";
import { addFumadocsSection, addPageShell, addSidebarHistory } from "./scaffold";
import { getStringFlag, looksLikeAppDirectory, looksLikeMonorepoRoot, parseArgs, resolveAppRoot } from "./app";

function fumadocsHelp(): string {
  return [
    "Usage:",
    "  lally fumadocs <init|section|page-shell|sidebar-history|check|clean|layout> [options]",
    "",
    "Examples:",
    "  lally fumadocs init --app apps/web",
    "  lally fumadocs section --name handbook --app apps/web",
    "  lally fumadocs check --app apps/web --strict-layout",
    "  lally fumadocs clean --app apps/web --apply",
  ].join("\n");
}

export async function runFumadocsCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(fumadocsHelp());
    return 0;
  }

  if (subcommand === "init") {
    await runInitCommand(["fumadocs/base-path", ...rest]);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  }

  if (subcommand === "check") {
    return runCheckCommand(["fumadocs", ...rest]);
  }

  if (subcommand === "clean") {
    return runCleanCommand(["fumadocs", ...rest]);
  }

  if (subcommand === "layout") {
    return runFumadocsLayoutCommand(rest);
  }

  const { flags } = parseArgs(["_", ...rest]);
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
    if (subcommand === "section") {
      const name = getStringFlag(flags, "name");
      if (!name) {
        console.error("Missing required flag: --name");
        return 1;
      }
      await addFumadocsSection(appRoot, name);
      return 0;
    }
    if (subcommand === "page-shell") {
      await addPageShell(appRoot);
      return 0;
    }
    if (subcommand === "sidebar-history") {
      await addSidebarHistory(appRoot);
      return 0;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  console.error(`Unknown fumadocs command: ${subcommand}`);
  console.error(fumadocsHelp());
  return 1;
}
