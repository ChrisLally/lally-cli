import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ParsedCleanArgs = {
  command: string | undefined;
  flags: Map<string, string | boolean | string[]>;
};

export function cleanHelp(): string {
  return [
    "Usage:",
    "  lally clean fumadocs [--app <path>] [--keep <glob>] [--archive-dir <path>] [--apply] [--delete] [--json]",
    "",
    "Safety defaults:",
    "  - dry-run by default (no file changes)",
    "  - use --apply to execute",
    "  - apply mode archives files by default",
    "  - use --delete to permanently remove instead of archive",
    "",
    "Examples:",
    "  lally clean fumadocs --app apps/web",
    "  lally clean fumadocs --app apps/web --keep 'content/docs/custom/**'",
    "  lally clean fumadocs --app apps/web --apply",
    "  lally clean fumadocs --app apps/web --apply --archive-dir .lally-clean-backup/manual-1",
    "  lally clean fumadocs --app apps/web --apply --delete",
  ].join("\n");
}

export function parseCleanArgs(args: string[]): ParsedCleanArgs {
  const [command, ...rest] = args;
  const flags = new Map<string, string | boolean | string[]>();

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token || !token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      if (key === "keep") {
        const current = flags.get("keep");
        if (Array.isArray(current)) {
          current.push(next);
          flags.set("keep", current);
        } else {
          flags.set("keep", [next]);
        }
      } else {
        flags.set(key, next);
      }
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { command, flags };
}

export function getStringFlag(flags: Map<string, string | boolean | string[]>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

export function getStringArrayFlag(flags: Map<string, string | boolean | string[]>, key: string): string[] {
  const value = flags.get(key);
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

export function hasFlag(flags: Map<string, string | boolean | string[]>, key: string): boolean {
  return Boolean(flags.get(key));
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

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function wildcardToRegExp(pattern: string): RegExp {
  const normalized = toPosixPath(pattern).replace(/^\/+/, "");
  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized.charAt(i);
    const next = normalized.charAt(i + 1);

    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (/[\\^$+?.()|{}\[\]]/.test(char)) {
      source += `\\${char}`;
      continue;
    }

    source += char;
  }
  source += "$";
  return new RegExp(source);
}

export function matchesKeepPattern(relativePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = toPosixPath(relativePath).replace(/^\/+/, "");
  return patterns.some((pattern) => {
    const normalizedPattern = toPosixPath(pattern).replace(/^\/+/, "");
    if (normalizedPattern.endsWith("/**")) {
      const base = normalizedPattern.slice(0, -3);
      return normalized === base || normalized.startsWith(`${base}/`);
    }
    return wildcardToRegExp(normalizedPattern).test(normalized);
  });
}

export function assertWithinAppRoot(appRoot: string, absolutePath: string): void {
  const root = resolve(appRoot);
  const path = resolve(absolutePath);
  if (path === root) {
    throw new Error(`Refusing to operate on app root directly: ${path}`);
  }
  if (!path.startsWith(`${root}/`) && path !== root) {
    throw new Error(`Refusing to operate outside app root: ${path}`);
  }
}

export async function removePath(absolutePath: string): Promise<void> {
  await rm(absolutePath, { recursive: true, force: true });
}

export async function movePath(absolutePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });

  try {
    await rename(absolutePath, destinationPath);
    return;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EXDEV") throw error;
  }

  await cp(absolutePath, destinationPath, { recursive: true });
  await rm(absolutePath, { recursive: true, force: true });
}
