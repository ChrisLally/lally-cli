import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type SyncTarget = {
  prefix: string;
  remoteUrl: string;
  branch?: string;
  mode: "snapshot" | "history";
};

export type LallyConfig = {
  sync?: {
    targets?: Record<string, SyncTarget>;
  };
};

/**
 * @description Walk upward from a start directory until the pnpm workspace root is found.
 */
export function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 24; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find repo root (missing pnpm-workspace.yaml).");
}

/**
 * @description Load lally.config.json from repo root, returning an empty object when missing.
 */
export async function loadConfig(repoRoot: string): Promise<LallyConfig> {
  const configPath = resolve(repoRoot, "lally.config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as LallyConfig;
  } catch {
    return {};
  }
}

/**
 * @description Persist lally.config.json in repo root with stable pretty formatting.
 */
export async function writeConfig(repoRoot: string, value: LallyConfig): Promise<void> {
  const configPath = resolve(repoRoot, "lally.config.json");
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
