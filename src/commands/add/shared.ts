import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ParsedArgs = {
  item: string | undefined;
  flags: Map<string, string | boolean>;
};

export type LallyConfig = {
  fumadocs?: {
    basePath?: string;
    contentRoot?: string;
  };
};

export function parseArgs(args: string[]): ParsedArgs {
  const [item, ...rest] = args;
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token || !token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { item, flags };
}

export function getStringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

export function toTitleCase(segment: string): string {
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveAppRoot(rawAppPath: string | null): string {
  return rawAppPath ? resolve(process.cwd(), rawAppPath) : process.cwd();
}

export function looksLikeMonorepoRoot(dir: string): boolean {
  return (
    existsSync(resolve(dir, "pnpm-workspace.yaml")) ||
    (existsSync(resolve(dir, "apps")) && existsSync(resolve(dir, "packages")))
  );
}

export function looksLikeAppDirectory(dir: string): boolean {
  return (
    existsSync(resolve(dir, "package.json")) &&
    (existsSync(resolve(dir, "next.config.mjs")) ||
      existsSync(resolve(dir, "next.config.ts")) ||
      existsSync(resolve(dir, "src/app")) ||
      existsSync(resolve(dir, "content")))
  );
}

export async function ensureFile(filePath: string, content: string): Promise<"created" | "skipped"> {
  if (existsSync(filePath)) return "skipped";
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return "created";
}

export async function ensureJsonFile<T extends object>(filePath: string, value: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function normalizeBasePath(raw: string | undefined): string {
  if (!raw) {
    throw new Error("Missing `fumadocs.basePath` in lally.config.json");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Missing `fumadocs.basePath` in lally.config.json");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function normalizeContentRoot(raw: string | undefined): string {
  if (!raw) {
    throw new Error("Missing `fumadocs.contentRoot` in lally.config.json");
  }
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    throw new Error("Missing `fumadocs.contentRoot` in lally.config.json");
  }
  return trimmed;
}

export async function getFumadocsSettings(appRoot: string): Promise<{ basePath: string; contentRoot: string }> {
  const configPath = resolve(appRoot, "lally.config.json");
  const parsed = await loadJson<LallyConfig>(configPath);
  if (!parsed) {
    throw new Error("Missing lally.config.json in app root. Run `lally init --app <path>` first.");
  }
  return {
    basePath: normalizeBasePath(parsed?.fumadocs?.basePath),
    contentRoot: normalizeContentRoot(parsed?.fumadocs?.contentRoot),
  };
}
