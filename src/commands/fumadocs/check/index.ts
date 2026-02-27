import { resolve } from "node:path";
import { runFumadocsChecks } from "./targets/fumadocs";
import {
  checkHelp,
  getStringFlag,
  hasFlag,
  looksLikeAppDirectory,
  looksLikeMonorepoRoot,
  parseArgs,
} from "./shared";

export async function runCheckCommand(args: string[]): Promise<number> {
  const { target, flags } = parseArgs(args);

  if (!target || target === "--help" || target === "-h" || target === "help") {
    console.log(checkHelp());
    return 0;
  }

  if (target !== "fumadocs") {
    console.error(`Unknown check target: ${target}`);
    console.error(checkHelp());
    return 1;
  }

  const appFlag = getStringFlag(flags, "app");
  const appRoot = resolve(process.cwd(), appFlag ?? ".");
  const json = hasFlag(flags, "json");
  const strictLayout = hasFlag(flags, "strict-layout");

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

  const results = await runFumadocsChecks(appRoot, strictLayout);
  const ok = results.every((result) => result.ok);

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok,
          appRoot,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Fumadocs check for ${appRoot}`);
    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id}: ${result.message}`);
    }
    console.log(ok ? "All checks passed." : "One or more checks failed.");
  }

  return ok ? 0 : 1;
}
