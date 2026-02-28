import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { collectFumadocsCandidates } from "./targets/fumadocs";
import {
  assertWithinAppRoot,
  cleanHelp,
  getStringArrayFlag,
  getStringFlag,
  hasFlag,
  looksLikeAppDirectory,
  looksLikeMonorepoRoot,
  matchesKeepPattern,
  movePath,
  parseCleanArgs,
  removePath,
  toPosixPath,
} from "./shared";

type CleanAction = "archive" | "delete" | "skip";

type PlannedOperation = {
  relativePath: string;
  absolutePath: string;
  reason: string;
  action: CleanAction;
  destinationPath: string | null;
};

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeKeepPatterns(patterns: string[]): string[] {
  return patterns
    .map((pattern) => toPosixPath(pattern).trim())
    .filter(Boolean)
    .map((pattern) => pattern.replace(/^\/+/, ""));
}

function createPlan(
  appRoot: string,
  archiveDir: string,
  keepPatterns: string[],
  deleteMode: boolean,
): PlannedOperation[] {
  const candidates = collectFumadocsCandidates(appRoot);
  return candidates.map((candidate) => {
    const absolutePath = resolve(appRoot, candidate.relativePath);
    assertWithinAppRoot(appRoot, absolutePath);

    if (matchesKeepPattern(candidate.relativePath, keepPatterns)) {
      return {
        relativePath: candidate.relativePath,
        absolutePath,
        reason: candidate.reason,
        action: "skip",
        destinationPath: null,
      };
    }

    const destinationPath = deleteMode
      ? null
      : resolve(archiveDir, candidate.relativePath);

    if (destinationPath) {
      assertWithinAppRoot(appRoot, destinationPath);
    }

    return {
      relativePath: candidate.relativePath,
      absolutePath,
      reason: candidate.reason,
      action: deleteMode ? "delete" : "archive",
      destinationPath,
    };
  });
}

function printPlan(plan: PlannedOperation[], dryRun: boolean, archiveDir: string, keepPatterns: string[]): void {
  console.log(dryRun ? "[dry-run] Planned cleanup:" : "Applying cleanup:");
  if (!plan.length) {
    console.log("No matching paths found.");
    return;
  }

  for (const item of plan) {
    if (item.action === "skip") {
      console.log(`- skip    ${item.relativePath} (matched --keep)`);
      continue;
    }

    if (item.action === "archive") {
      const destination = item.destinationPath ? toPosixPath(item.destinationPath) : "(none)";
      console.log(`- archive ${item.relativePath} -> ${destination}`);
      continue;
    }

    console.log(`- delete  ${item.relativePath}`);
  }

  if (keepPatterns.length > 0) {
    console.log(`Keep patterns: ${keepPatterns.join(", ")}`);
  }

  const archiveActions = plan.filter((item) => item.action === "archive").length;
  if (archiveActions > 0) {
    console.log(`Archive directory: ${toPosixPath(archiveDir)}`);
  }
}

export async function runCleanCommand(args: string[]): Promise<number> {
  const { command, flags } = parseCleanArgs(args);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(cleanHelp());
    return 0;
  }

  if (command !== "fumadocs") {
    console.error(`Unknown clean target: ${command}`);
    console.error(cleanHelp());
    return 1;
  }

  const appFlag = getStringFlag(flags, "app");
  const appRoot = resolve(process.cwd(), appFlag ?? ".");
  const json = hasFlag(flags, "json");
  const apply = hasFlag(flags, "apply");
  const deleteMode = hasFlag(flags, "delete");
  const dryRun = !apply;

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

  const keepPatterns = normalizeKeepPatterns(getStringArrayFlag(flags, "keep"));
  const defaultArchiveDir = resolve(appRoot, ".lally-clean-backup", timestamp());
  const archiveDirFlag = getStringFlag(flags, "archive-dir");
  const archiveDir = archiveDirFlag ? resolve(appRoot, archiveDirFlag) : defaultArchiveDir;

  assertWithinAppRoot(appRoot, archiveDir);

  const plan = createPlan(appRoot, archiveDir, keepPatterns, deleteMode);
  const actionable = plan.filter((item) => item.action === "archive" || item.action === "delete");

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun,
          apply,
          deleteMode,
          appRoot,
          archiveDir: deleteMode ? null : archiveDir,
          keepPatterns,
          summary: {
            total: plan.length,
            actionable: actionable.length,
            archived: plan.filter((item) => item.action === "archive").length,
            deleted: plan.filter((item) => item.action === "delete").length,
            skipped: plan.filter((item) => item.action === "skip").length,
          },
          plan,
        },
        null,
        2,
      ),
    );
  } else {
    printPlan(plan, dryRun, archiveDir, keepPatterns);
    if (dryRun) {
      console.log("Dry-run mode active. Re-run with --apply to execute.");
    }
  }

  if (dryRun || actionable.length === 0) {
    return 0;
  }

  if (!deleteMode && !existsSync(archiveDir)) {
    await mkdir(archiveDir, { recursive: true });
  }

  for (const item of actionable) {
    assertWithinAppRoot(appRoot, item.absolutePath);
    if (item.action === "delete") {
      await removePath(item.absolutePath);
      continue;
    }

    if (!item.destinationPath) {
      throw new Error(`Missing archive destination for ${item.relativePath}`);
    }

    await movePath(item.absolutePath, item.destinationPath);
  }

  if (!json) {
    console.log(`Cleanup complete. Processed ${actionable.length} paths.`);
  }

  return 0;
}
