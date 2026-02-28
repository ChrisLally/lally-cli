import { resolve } from "node:path";
import { initFumadocsBasePath } from "./presets/fumadocs-base-path";
import {
  createBaseConfig,
  getStringFlag,
  looksLikeAppDirectory,
  looksLikeMonorepoRoot,
  parseInitArgs,
} from "./shared";

function initHelp(): string {
  return [
    "Usage:",
    "  lally init [preset] [--app <path>]",
    "",
    "Presets:",
    "  fumadocs/base-path   Initialize content root + Next basePath from lally.config.json",
    "",
    "Examples:",
    "  lally init --app apps/web",
    "  lally init fumadocs/base-path --app apps/web",
    "",
    "Notes:",
    "  - If run from monorepo root, pass --app.",
    "  - Uses lally.config.json fumadocs.basePath/contentRoot defaults.",
  ].join("\n");
}

export async function runInitCommand(args: string[]) {
  const { preset, flags } = parseInitArgs(args);
  const helpFlag = flags.get("help") === true;

  if (helpFlag || preset === "--help" || preset === "-h" || preset === "help") {
    console.log(initHelp());
    return;
  }

  const appFlag = getStringFlag(flags, "app");
  const appRoot = resolve(process.cwd(), appFlag ?? ".");

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

  if (!preset) {
    try {
      await createBaseConfig(appRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    }
    return;
  }

  try {
    if (preset === "fumadocs/base-path") {
      await initFumadocsBasePath(appRoot);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown init preset: ${preset}`);
  console.error(initHelp());
  process.exitCode = 1;
}
