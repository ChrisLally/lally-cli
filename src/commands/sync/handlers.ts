import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getStringFlag, hasFlag, parseArgs } from "./args";
import { findRepoRoot, loadConfig, LallyConfig, SyncTarget, writeConfig } from "./config";
import { runCommand } from "./exec";
import { syncHelp } from "./help";
import { pullTarget, pushHistory, pushSnapshot } from "./native";
import { printJson } from "./output";
import { getBranch, getSyncSection, resolveTarget } from "./resolve";

type SyncRelease = {
  tagName: string | null;
  releaseVersion: string | null;
};

/**
 * @description Compute the next alpha prerelease version from the current semver.
 */
function nextAlphaVersion(current: string): string {
  const alpha = current.match(/^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/);
  if (alpha) {
    const [, major, minor, patch, n] = alpha;
    return `${major}.${minor}.${patch}-alpha.${Number(n) + 1}`;
  }

  const base = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (base) {
    return `${base[1]}.${base[2]}.${base[3]}-alpha.1`;
  }

  throw new Error(`Unsupported package version for alpha release: ${current}`);
}

/**
 * @description Resolve tag/release metadata from user tag input (explicit tag or alpha shorthand).
 */
async function resolveReleaseFromTagInput(
  repoRoot: string,
  targetName: string,
  target: SyncTarget,
  tagInput: string | null,
): Promise<SyncRelease> {
  if (!tagInput) return { tagName: null, releaseVersion: null };
  if (tagInput !== "alpha") return { tagName: tagInput, releaseVersion: null };

  if (target.mode !== "snapshot") {
    throw new Error("--tag alpha requires snapshot mode");
  }

  const packageJsonPath = resolve(repoRoot, target.prefix, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`--tag alpha requires a package.json under target prefix: ${packageJsonPath}`);
  }

  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  const currentVersion = pkg.version;
  if (!currentVersion) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  const releaseVersion = nextAlphaVersion(currentVersion);
  return {
    tagName: `${targetName}-v${releaseVersion}`,
    releaseVersion,
  };
}

/**
 * @description Update local package.json version under the sync target prefix.
 */
async function updateLocalPackageVersion(repoRoot: string, target: SyncTarget, version: string): Promise<void> {
  const packageJsonPath = resolve(repoRoot, target.prefix, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Cannot update local version, package.json not found: ${packageJsonPath}`);
  }

  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  pkg.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

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

/**
 * @description Execute native push/pull flows for a sync target with optional tag handling.
 */
export async function runSyncAction(action: "push" | "pull", args: string[]): Promise<number> {
  const { flags } = parseArgs([action, ...args]);
  const targetName = getStringFlag(flags, "target");
  const tagInput = getStringFlag(flags, "tag");
  const json = hasFlag(flags, "json");
  const dryRun = hasFlag(flags, "dry-run");

  if (!targetName) {
    console.error("Missing required flag: --target");
    console.error(syncHelp());
    return 1;
  }

  if (action === "pull" && tagInput) {
    const message = "--tag is only supported for sync push";
    if (json) printJson({ ok: false, error: message });
    else console.error(message);
    return 1;
  }

  const repoRoot = findRepoRoot(process.cwd());
  const config = await loadConfig(repoRoot);

  let target: SyncTarget;
  let release: SyncRelease = { tagName: null, releaseVersion: null };
  try {
    const sync = getSyncSection(config);
    target = resolveTarget(sync, targetName);
    release = await resolveReleaseFromTagInput(repoRoot, targetName, target, tagInput);
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
      ...(release.tagName ? { tag: release.tagName } : {}),
      ...(release.releaseVersion ? { releaseVersion: release.releaseVersion } : {}),
    };
    if (json) printJson(payload);
    else
      console.log(
        `[dry-run] would run native ${action} (${target.mode}) for '${targetName}'${release.tagName ? ` with tag ${release.tagName}` : ""}`,
      );
    return 0;
  }

  try {
    if (action === "push") {
      if (target.mode === "snapshot") {
        await pushSnapshot(repoRoot, target, {
          tagName: release.tagName ?? undefined,
          releaseVersion: release.releaseVersion ?? undefined,
        });
      } else {
        pushHistory(repoRoot, targetName, target, { tagName: release.tagName ?? undefined });
      }

      if (release.releaseVersion) {
        await updateLocalPackageVersion(repoRoot, target, release.releaseVersion);
      }
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
