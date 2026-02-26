import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getStringFlag, hasFlag, parseArgs } from "./args";
import { findRepoRoot, loadConfig, LallyConfig, SyncTarget, writeConfig } from "./config";
import { runCommand } from "./exec";
import { syncHelp } from "./help";
import { pullTarget, pushHistory, pushSnapshot } from "./native";
import { printJson } from "./output";
import { getBranch, getSyncSection, resolveTarget } from "./resolve";

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

  let target: SyncTarget;
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

export async function runSyncAction(action: "push" | "pull", args: string[]): Promise<number> {
  const { flags } = parseArgs([action, ...args]);
  const targetName = getStringFlag(flags, "target");
  const json = hasFlag(flags, "json");
  const dryRun = hasFlag(flags, "dry-run");

  if (!targetName) {
    console.error("Missing required flag: --target");
    console.error(syncHelp());
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const config = await loadConfig(repoRoot);

  let target: SyncTarget;
  try {
    const sync = getSyncSection(config);
    target = resolveTarget(sync, targetName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) printJson({ ok: false, error: message });
    else console.error(message);
    return 1;
  }

  if (dryRun) {
    const payload = {
      ok: true,
      dryRun: true,
      action,
      target: targetName,
      mode: target.mode,
      prefix: target.prefix,
      remoteUrl: target.remoteUrl,
      branch: getBranch(target),
    };
    if (json) printJson(payload);
    else console.log(`[dry-run] would run native ${action} (${target.mode}) for '${targetName}'`);
    return 0;
  }

  try {
    if (action === "push") {
      if (target.mode === "snapshot") await pushSnapshot(repoRoot, target);
      else pushHistory(repoRoot, targetName, target);
    } else {
      pullTarget(repoRoot, target);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) printJson({ ok: false, action, target: targetName, error: message });
    else console.error(message);
    return 1;
  }

  if (json) printJson({ ok: true, action, target: targetName, mode: target.mode });
  else console.log(`Sync ${action} complete for '${targetName}' (${target.mode}).`);

  return 0;
}
