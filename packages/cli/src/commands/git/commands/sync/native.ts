import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SyncTarget } from "./config";
import { ensureOk, runBash, runCommand } from "./exec";
import { getBranch, getSyncAuthor } from "./resolve";

/**
 * @description Ensure a tag does not already exist on the remote before attempting to push it.
 */
function assertTagMissingOnRemote(repoRoot: string, remoteUrl: string, tagName: string) {
  const check = runCommand("git", ["ls-remote", "--tags", remoteUrl, `refs/tags/${tagName}`], repoRoot);
  if (check.status !== 0) {
    throw new Error(`failed to query remote tags for ${tagName}`);
  }

  if (check.stdout.trim().length > 0) {
    throw new Error(`tag already exists on remote: ${tagName}`);
  }
}

async function normalizeStandalonePackage(repoDir: string, remoteUrl: string): Promise<void> {
  const packageJsonPath = resolve(repoDir, "package.json");
  if (!existsSync(packageJsonPath)) return;

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
  const normalizedRemote = remoteUrl.replace(/\.git$/, "");

  for (const section of sections) {
    const current = packageJson[section];
    if (!current || typeof current !== "object") continue;
    const entries = Object.entries(current as Record<string, string>).filter(([, value]) => !value.startsWith("workspace:"));
    packageJson[section] = Object.fromEntries(entries);
  }

  packageJson.repository = {
    type: "git",
    url: normalizedRemote,
  };

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const tsconfigPath = resolve(repoDir, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8")) as Record<string, unknown>;
    if (typeof tsconfig.extends === "string" && tsconfig.extends.startsWith("@repo/")) {
      delete tsconfig.extends;
      await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
    }
  }

  const eslintConfigPath = resolve(repoDir, "eslint.config.mjs");
  if (existsSync(eslintConfigPath)) {
    const eslintContent = await readFile(eslintConfigPath, "utf8");
    if (eslintContent.includes("@repo/eslint-config")) {
      await writeFile(
        eslintConfigPath,
        `/** @description Standalone eslint config for published package repo. */\nexport default [];\n`,
        "utf8",
      );
    }
  }
}

/**
 * @description Push a snapshot of a target prefix to a standalone repo, optionally tagging and bumping version.
 */
export async function pushSnapshot(
  repoRoot: string,
  target: SyncTarget,
  options?: { tagName?: string; releaseVersion?: string },
): Promise<void> {
  const tagName = options?.tagName;
  const releaseVersion = options?.releaseVersion;
  const exportDir = await mkdtemp(join(tmpdir(), "lally-sync-export-"));
  const cloneDir = await mkdtemp(join(tmpdir(), "lally-sync-clone-"));

  try {
    const exportScript = `git archive --format=tar HEAD "${target.prefix}" | tar -x -C "${exportDir}"`;
    ensureOk(runBash(exportScript, repoRoot), "snapshot export");

    const exportedPrefix = resolve(exportDir, target.prefix);
    if (!existsSync(exportedPrefix)) {
      throw new Error(`snapshot export missing directory: ${exportedPrefix}`);
    }

    const branch = getBranch(target);
    const cloneResult = runCommand("git", ["clone", "--depth", "1", "--branch", branch, target.remoteUrl, cloneDir], repoRoot);

    if (cloneResult.status !== 0) {
      // Fallback for empty repos / missing default branch.
      const fallback = runCommand("git", ["clone", target.remoteUrl, cloneDir], repoRoot);
      ensureOk(fallback, "git clone fallback");

      const hasBranch = runCommand("git", ["rev-parse", "--verify", branch], cloneDir);
      if (hasBranch.status === 0) {
        ensureOk(runCommand("git", ["checkout", "-q", branch], cloneDir), "git checkout branch");
      } else {
        ensureOk(runCommand("git", ["checkout", "-q", "--orphan", branch], cloneDir), "git checkout orphan branch");
      }
    }

    ensureOk(runCommand("bash", ["-lc", `rsync -a --delete --exclude ".git/" "${exportedPrefix}/" "${cloneDir}/"`], repoRoot), "rsync snapshot");
    await normalizeStandalonePackage(cloneDir, target.remoteUrl);

    if (releaseVersion) {
      const packageJsonRelativePath = target.versionPath ?? "package.json";
      const packageJsonPath = resolve(cloneDir, packageJsonRelativePath);
      const setVersion = runCommand(
        "node",
        [
          "-e",
          `const fs=require('fs');const p='${packageJsonPath.replaceAll("'", "'\\''")}';const v='${releaseVersion}';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=v;fs.writeFileSync(p,JSON.stringify(j,null,2)+'\\n');`,
        ],
        repoRoot,
      );
      ensureOk(setVersion, "set package version");
    }

    ensureOk(runCommand("git", ["add", "-A"], cloneDir), "git add");
    const hasChanges = runCommand("git", ["diff", "--cached", "--quiet"], cloneDir).status !== 0;
    if (!hasChanges) {
      console.log("[sync snapshot] no changes to push");
      return;
    }

    const author = getSyncAuthor();
    ensureOk(runCommand("git", ["config", "user.name", author.name], cloneDir), "git config user.name");
    ensureOk(runCommand("git", ["config", "user.email", author.email], cloneDir), "git config user.email");

    const sourceSha = runCommand("git", ["rev-parse", "--short", "HEAD"], repoRoot);
    ensureOk(sourceSha, "git rev-parse");
    const sha = sourceSha.stdout.trim();

    ensureOk(runCommand("git", ["commit", "-m", `chore: sync snapshot from ${target.prefix} (${sha})`], cloneDir), "git commit");
    ensureOk(runCommand("git", ["push", "origin", `${branch}:${branch}`], cloneDir), "git push");

    if (tagName) {
      assertTagMissingOnRemote(repoRoot, target.remoteUrl, tagName);
      ensureOk(runCommand("git", ["tag", tagName], cloneDir), "git tag");
      ensureOk(runCommand("git", ["push", "origin", `refs/tags/${tagName}`], cloneDir), "git push tag");
    }
  } finally {
    await rm(exportDir, { recursive: true, force: true });
    await rm(cloneDir, { recursive: true, force: true });
  }
}

/**
 * @description Push history-preserving subtree split to a standalone repo, optionally tagging the pushed commit.
 */
export function pushHistory(
  repoRoot: string,
  targetName: string,
  target: SyncTarget,
  options?: { tagName?: string; releaseVersion?: string },
): void {
  const tagName = options?.tagName;
  const releaseVersion = options?.releaseVersion;
  if (releaseVersion) {
    throw new Error("release version bump is only supported for snapshot mode");
  }

  const branch = getBranch(target);
  const splitBranch = `codex/sync-${targetName}-split`;
  const tempTag = tagName ? `codex/sync-${targetName}-tag` : null;

  runCommand("git", ["branch", "-D", splitBranch], repoRoot);
  if (tempTag) runCommand("git", ["tag", "-d", tempTag], repoRoot);
  ensureOk(runCommand("git", ["subtree", "split", "--prefix", target.prefix, "-b", splitBranch], repoRoot), "git subtree split");

  try {
    ensureOk(runCommand("git", ["push", target.remoteUrl, `${splitBranch}:${branch}`], repoRoot), "git push split branch");
    if (tagName && tempTag) {
      assertTagMissingOnRemote(repoRoot, target.remoteUrl, tagName);
      ensureOk(runCommand("git", ["tag", tempTag, splitBranch], repoRoot), "git tag");
      ensureOk(runCommand("git", ["push", target.remoteUrl, `${tempTag}:refs/tags/${tagName}`], repoRoot), "git push tag");
    }
  } finally {
    runCommand("git", ["branch", "-D", splitBranch], repoRoot);
    if (tempTag) runCommand("git", ["tag", "-d", tempTag], repoRoot);
  }
}

/**
 * @description Pull changes from a standalone repo into the monorepo prefix using squash mode.
 */
export function pullTarget(repoRoot: string, target: SyncTarget): void {
  const branch = getBranch(target);
  // Keep private repo history compact on inbound syncs.
  ensureOk(
    runCommand("git", ["subtree", "pull", "--prefix", target.prefix, target.remoteUrl, branch, "--squash"], repoRoot),
    "git subtree pull",
  );
}
