import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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

export function parseSimpleDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }

  return out;
}

export async function loadRootEnv(repoRoot: string): Promise<void> {
  const envPath = resolve(repoRoot, ".env");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch {
    return;
  }

  const values = parseSimpleDotEnv(content);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}
