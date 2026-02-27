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

type SyncActionOptions = {
  generateReadme?: (targetName: string) => Promise<number>;
};

type SyncRelease = {
  tagName: string | null;
  releaseVersion: string | null;
};

type VersionTarget = {
  packageJsonPath: string;
  version: string;
};

/**
 * @description List dirty files under a target prefix (tracked and untracked) using git porcelain output.
 */
function getDirtyFilesForPrefix(repoRoot: string, prefix: string): string[] {
  const result = runCommand("git", ["status", "--porcelain", "--untracked-files=all", "--", prefix], repoRoot);
  if (result.status !== 0) {
    throw new Error("Unable to inspect git status for sync target prefix.");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[ MARCUD?!]{2}\s+/, ""));
}

/**
 * @description Commit only target prefix changes before sync push when --commit message is provided.
 */
function commitTargetPrefixChanges(repoRoot: string, prefix: string, message: string): void {
  const add = runCommand("git", ["add", "-A", "--", prefix], repoRoot);
  if (add.status !== 0) {
    throw new Error("Failed to stage sync target changes.");
  }

  const hasStaged = runCommand("git", ["diff", "--cached", "--quiet", "--", prefix], repoRoot).status !== 0;
  if (!hasStaged) return;

  const commit = runCommand("git", ["commit", "-m", message, "--", prefix], repoRoot);
  if (commit.status !== 0) {
    const details = [commit.stdout?.trim(), commit.stderr?.trim()].filter(Boolean).join("\n");
    throw new Error(details || "Failed to commit sync target changes.");
  }
}

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
 * @description Resolve a package.json with a version for release tagging, supporting monorepo prefixes.
 */
async function resolveVersionTarget(repoRoot: string, target: SyncTarget): Promise<VersionTarget> {
  const candidates = [
    ...(target.versionPath ? [resolve(repoRoot, target.prefix, target.versionPath)] : []),
    resolve(repoRoot, target.prefix, "packages/cli/package.json"),
    resolve(repoRoot, target.prefix, "package.json"),
  ];

  for (const packageJsonPath of candidates) {
    if (!existsSync(packageJsonPath)) continue;
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
    if (pkg.version) {
      return { packageJsonPath, version: pkg.version };
    }
  }

  throw new Error(`Missing version in ${candidates[0]}`);
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
  if (tagInput !== "alpha") {
    if (target.mode === "snapshot") {
      const explicitPrefix = `${targetName}-v`;
      if (tagInput.startsWith(explicitPrefix)) {
        const explicitVersion = tagInput.slice(explicitPrefix.length).trim();
        if (explicitVersion.length > 0) {
          return { tagName: tagInput, releaseVersion: explicitVersion };
        }
      }
    }
    return { tagName: tagInput, releaseVersion: null };
  }

  if (target.mode !== "snapshot") {
    throw new Error("--tag alpha requires snapshot mode");
  }

  const versionTarget = await resolveVersionTarget(repoRoot, target);
  const currentVersion = versionTarget.version;

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
  const versionTarget = await resolveVersionTarget(repoRoot, target);
  const packageJsonPath = versionTarget.packageJsonPath;
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  pkg.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

/**
 * @description Auto-generate repository README for known sync targets before snapshot commit/push.
 */
async function maybeGenerateTargetReadme(
  repoRoot: string,
  targetName: string,
  target: SyncTarget,
  options?: SyncActionOptions,
): Promise<void> {
  if (targetName !== "cli") return;
  if (!options?.generateReadme) return;

  const targetRoot = resolve(repoRoot, target.prefix);
  if (!existsSync(targetRoot)) return;

  const originalCwd = process.cwd();
  try {
    process.chdir(targetRoot);
    const code = await options.generateReadme(targetName);
    if (code !== 0) {
      throw new Error(`README generation failed for target '${targetName}'`);
    }
  } finally {
    process.chdir(originalCwd);
  }
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
export async function runSyncAction(
  action: "push" | "pull",
  args: string[],
  options?: SyncActionOptions,
): Promise<number> {
  const { flags } = parseArgs([action, ...args]);
  const targetName = getStringFlag(flags, "target");
  const tagInput = getStringFlag(flags, "tag");
  const commitMessage = getStringFlag(flags, "commit");
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

  if (action === "pull" && commitMessage) {
    const message = "--commit is only supported for sync push";
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
    const effectiveTagInput = action === "push" && target.mode === "snapshot" ? (tagInput ?? "alpha") : tagInput;
    release = await resolveReleaseFromTagInput(repoRoot, targetName, target, effectiveTagInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) printJson({ ok: false, error: message });
    else console.error(message);
    return 1;
  }

  if (dryRun) {
    const dirtyFiles = action === "push" ? getDirtyFilesForPrefix(repoRoot, target.prefix) : [];
    const payload = {
      ok: true,
      dryRun: true,
      action,
      target: targetName,
      mode: target.mode,
      prefix: target.prefix,
      remoteUrl: target.remoteUrl,
      branch: getBranch(target),
      ...(action === "push" ? { dirty: dirtyFiles.length > 0, dirtyFiles } : {}),
      ...(commitMessage ? { commitMessage } : {}),
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
      if (release.releaseVersion) {
        await updateLocalPackageVersion(repoRoot, target, release.releaseVersion);
      }

      await maybeGenerateTargetReadme(repoRoot, targetName, target, options);

      const dirtyFiles = getDirtyFilesForPrefix(repoRoot, target.prefix);
      if (dirtyFiles.length > 0 && !commitMessage) {
        throw new Error(
          [
            `Refusing to sync '${targetName}' because ${dirtyFiles.length} uncommitted change(s) exist under '${target.prefix}'.`,
            "Commit them first or rerun with --commit \"<message>\" to auto-commit target changes.",
            ...dirtyFiles.slice(0, 20).map((file) => `- ${file}`),
            ...(dirtyFiles.length > 20 ? [`- ...and ${dirtyFiles.length - 20} more`] : []),
          ].join("\n"),
        );
      }

      if (dirtyFiles.length > 0 && commitMessage) {
        commitTargetPrefixChanges(repoRoot, target.prefix, commitMessage);
      }

      if (target.mode === "snapshot") {
        await pushSnapshot(repoRoot, target, {
          tagName: release.tagName ?? undefined,
          releaseVersion: release.releaseVersion ?? undefined,
        });
      } else {
        pushHistory(repoRoot, targetName, target, { tagName: release.tagName ?? undefined });
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
