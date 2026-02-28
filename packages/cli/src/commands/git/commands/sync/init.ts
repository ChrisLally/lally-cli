import { getStringFlag, parseArgs } from "./args";
import { findRepoRoot, loadConfig, LallyConfig, writeConfig } from "./config";
import { syncHelp } from "./help";

/**
 * @description Create or update a sync target entry in lally.config.json.
 */
export async function runSyncInit(args: string[]): Promise<number> {
  const { flags } = parseArgs(["init", ...args]);
  const target = getStringFlag(flags, "target");
  const prefix = getStringFlag(flags, "prefix");
  const remoteUrl = getStringFlag(flags, "remote");
  const branch = getStringFlag(flags, "branch") ?? "main";
  const modeRaw = getStringFlag(flags, "mode") ?? "history";

  if (!target || !prefix || !remoteUrl) {
    console.error("Missing required flags: --target, --prefix, --remote");
    console.error(syncHelp());
    return 1;
  }

  if (modeRaw !== "snapshot" && modeRaw !== "history") {
    console.error(`Invalid --mode: ${modeRaw}`);
    console.error("Allowed modes: snapshot, history");
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const config = await loadConfig(repoRoot);
  const sync = config.sync ?? { targets: {} };
  const nextTargets = { ...(sync.targets ?? {}) };
  nextTargets[target] = {
    prefix,
    remoteUrl,
    branch,
    mode: modeRaw,
  };

  const nextConfig: LallyConfig = {
    ...config,
    sync: {
      targets: nextTargets,
    },
  };

  await writeConfig(repoRoot, nextConfig);
  console.log(`Configured sync target '${target}' in lally.config.json`);
  return 0;
}
