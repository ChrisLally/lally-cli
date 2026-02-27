import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runOrThrow } from "./exec";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const PREFERRED_ORDER: PackageManager[] = ["pnpm", "npm", "yarn", "bun"];

function hasCommand(command: string): boolean {
  try {
    const child = spawnSync(command, ["--version"], {
      stdio: "ignore",
      env: process.env,
    });
    return child.status === 0 && !child.error;
  } catch {
    return false;
  }
}

function resolvePreferredByLockfile(repoRoot: string): PackageManager | null {
  if (existsSync(resolve(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(repoRoot, "package-lock.json"))) return "npm";
  if (existsSync(resolve(repoRoot, "yarn.lock"))) return "yarn";
  if (existsSync(resolve(repoRoot, "bun.lockb")) || existsSync(resolve(repoRoot, "bun.lock"))) return "bun";
  return null;
}

export function resolvePackageManager(repoRoot: string): PackageManager {
  const forced = (process.env.LALLY_PM ?? "").trim().toLowerCase();
  if (forced === "pnpm" || forced === "npm" || forced === "yarn" || forced === "bun") {
    if (hasCommand(forced)) return forced;
    throw new Error(`LALLY_PM is set to '${forced}', but that command is not available.`);
  }

  const fromLockfile = resolvePreferredByLockfile(repoRoot);
  if (fromLockfile && hasCommand(fromLockfile)) return fromLockfile;

  for (const candidate of PREFERRED_ORDER) {
    if (hasCommand(candidate)) return candidate;
  }

  throw new Error("No supported package manager found. Install one of: pnpm, npm, yarn, bun.");
}

export function formatRunScriptCommand(pm: PackageManager, script: string, cwd: string): string {
  if (pm === "pnpm") return `pnpm --dir ${cwd} run ${script}`;
  if (pm === "npm") return `npm --prefix ${cwd} run ${script}`;
  if (pm === "yarn") return `yarn --cwd ${cwd} run ${script}`;
  return `bun run ${script} (cwd=${cwd})`;
}

export function runPackageScript(pm: PackageManager, script: string, packageDir: string, repoRoot: string, env?: NodeJS.ProcessEnv): void {
  if (pm === "pnpm") {
    runOrThrow("pnpm", ["--dir", packageDir, "run", script], repoRoot, env);
    return;
  }
  if (pm === "npm") {
    runOrThrow("npm", ["--prefix", packageDir, "run", script], repoRoot, env);
    return;
  }
  if (pm === "yarn") {
    runOrThrow("yarn", ["--cwd", packageDir, "run", script], repoRoot, env);
    return;
  }
  runOrThrow("bun", ["run", script], packageDir, env);
}
