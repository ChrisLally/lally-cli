import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getStringFlag, hasFlag, parseArgs } from "./args";
import { findRepoRoot, loadConfig } from "./config";
import { runCommand } from "./exec";
import { syncHelp } from "./help";
import { printJson } from "./output";
import { getSyncSection, resolveTarget } from "./sync-shared";

/**
 * @description Validate a configured sync target and report operational readiness checks.
 */
export async function runSyncDoctor(args: string[]): Promise<number> {
  const { flags } = parseArgs(["doctor", ...args]);
  const targetName = getStringFlag(flags, "target");
  const json = hasFlag(flags, "json");

  if (!targetName) {
    console.error("Missing required flag: --target");
    console.error(syncHelp());
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const config = await loadConfig(repoRoot);

  let target;
  try {
    const sync = getSyncSection(config);
    target = resolveTarget(sync, targetName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) printJson({ ok: false, error: message });
    else console.error(message);
    return 1;
  }

  const prefixPath = resolve(repoRoot, target.prefix);
  const remoteCheck = runCommand("git", ["ls-remote", "--heads", target.remoteUrl], repoRoot);

  const checks = [
    {
      id: "prefix",
      ok: existsSync(prefixPath),
      message: existsSync(prefixPath) ? `prefix=${target.prefix}` : `Missing path: ${prefixPath}`,
    },
    {
      id: "remote-url",
      ok: Boolean(target.remoteUrl),
      message: target.remoteUrl ? `remote=${target.remoteUrl}` : "Missing remoteUrl",
    },
    {
      id: "remote-access",
      ok: remoteCheck.status === 0,
      message: remoteCheck.status === 0 ? "Remote reachable" : "Remote not reachable (check auth/url)",
    },
    {
      id: "mode",
      ok: target.mode === "snapshot" || target.mode === "history",
      message: `mode=${target.mode}`,
    },
  ];

  const ok = checks.every((check) => check.ok);
  if (json) {
    printJson({ ok, target: targetName, checks });
  } else {
    console.log(`Sync doctor for ${targetName}`);
    for (const check of checks) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.message}`);
    }
    console.log(ok ? "All checks passed." : "One or more checks failed.");
  }

  return ok ? 0 : 1;
}
