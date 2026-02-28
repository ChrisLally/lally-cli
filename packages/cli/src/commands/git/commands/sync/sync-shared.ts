import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCommand } from "./exec";
import { SyncTarget } from "./config";
import { getSyncSection, resolveTarget } from "./resolve";

export type SyncActionOptions = {
  generateReadme?: (targetName: string) => Promise<number>;
};

export type SyncRelease = {
  tagName: string | null;
  releaseVersion: string | null;
};

export type VersionTarget = {
  packageJsonPath: string;
  version: string;
};

/**
 * @description List dirty files under a target prefix (tracked and untracked) using git porcelain output.
 */
export function getDirtyFilesForPrefix(repoRoot: string, prefix: string): string[] {
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
export function commitTargetPrefixChanges(repoRoot: string, prefix: string, message: string): void {
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
export function nextAlphaVersion(current: string): string {
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
export async function resolveVersionTarget(repoRoot: string, target: SyncTarget): Promise<VersionTarget> {
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
export async function resolveReleaseFromTagInput(
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
export async function updateLocalPackageVersion(repoRoot: string, target: SyncTarget, version: string): Promise<void> {
  const versionTarget = await resolveVersionTarget(repoRoot, target);
  const packageJsonPath = versionTarget.packageJsonPath;
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
  pkg.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

/**
 * @description Auto-generate repository README for known sync targets before snapshot commit/push.
 */
export async function maybeGenerateTargetReadme(
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

export { getSyncSection, resolveTarget };
