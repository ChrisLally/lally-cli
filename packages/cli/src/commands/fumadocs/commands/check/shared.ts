import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type ParsedArgs = {
  target: string | undefined;
  flags: Map<string, string | boolean>;
};

export type CheckResult = {
  id: string;
  ok: boolean;
  message: string;
};

export function parseArgs(args: string[]): ParsedArgs {
  const [target, ...rest] = args;
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

  return { target, flags };
}

export function getStringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

export function hasFlag(flags: Map<string, string | boolean>, key: string): boolean {
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

export function checkHelp(): string {
  return [
    "Usage:",
    "  lally check fumadocs [--app <path>] [--strict-layout] [--json]",
    "",
    "Checks:",
    "  - required .gitignore entries",
    "  - required app files (next.config, source.config, src/lib/source)",
    "  - optional strict layout preset wiring (with --strict-layout)",
    "",
    "Examples:",
    "  lally check fumadocs --app apps/web",
    "  lally check fumadocs --app apps/web --strict-layout",
    "  lally check fumadocs --app apps/web --json",
  ].join("\n");
}
