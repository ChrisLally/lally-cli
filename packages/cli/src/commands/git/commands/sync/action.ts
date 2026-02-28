import { getStringFlag, hasFlag, parseArgs } from "./args";
import { findRepoRoot, loadConfig } from "./config";
import { syncHelp } from "./help";
import { pullTarget, pushHistory, pushSnapshot } from "./native";
import { printJson } from "./output";
import { getBranch } from "./resolve";
import { getSyncSection, resolveTarget } from "./sync-shared";
import type { SyncActionOptions } from "./sync-shared";
import {
  commitTargetPrefixChanges,
  getDirtyFilesForPrefix,
  maybeGenerateTargetReadme,
  resolveReleaseFromTagInput,
  updateLocalPackageVersion,
} from "./sync-shared";

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

  let target;
  let release = { tagName: null as string | null, releaseVersion: null as string | null };
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
