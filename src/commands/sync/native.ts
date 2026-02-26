import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SyncTarget } from "./config";
import { ensureOk, runBash, runCommand } from "./exec";
import { getBranch, getSyncAuthor } from "./resolve";

export async function pushSnapshot(repoRoot: string, target: SyncTarget): Promise<void> {
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
  } finally {
    await rm(exportDir, { recursive: true, force: true });
    await rm(cloneDir, { recursive: true, force: true });
  }
}

export function pushHistory(repoRoot: string, targetName: string, target: SyncTarget): void {
  const branch = getBranch(target);
  const splitBranch = `codex/sync-${targetName}-split`;

  runCommand("git", ["branch", "-D", splitBranch], repoRoot);
  ensureOk(runCommand("git", ["subtree", "split", "--prefix", target.prefix, "-b", splitBranch], repoRoot), "git subtree split");

  try {
    ensureOk(runCommand("git", ["push", target.remoteUrl, `${splitBranch}:${branch}`], repoRoot), "git push split branch");
  } finally {
    runCommand("git", ["branch", "-D", splitBranch], repoRoot);
  }
}

export function pullTarget(repoRoot: string, target: SyncTarget): void {
  const branch = getBranch(target);
  // Keep private repo history compact on inbound syncs.
  ensureOk(
    runCommand("git", ["subtree", "pull", "--prefix", target.prefix, target.remoteUrl, branch, "--squash"], repoRoot),
    "git subtree pull",
  );
}
