import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path, { resolve } from "node:path";

export type ParsedInitArgs = {
  preset: string | undefined;
  flags: Map<string, string | boolean>;
};

export type LallyConfig = {
  fumadocs?: {
    basePath?: string;
    contentRoot?: string;
    github?: {
      user?: string;
      repo?: string;
      branch?: string;
    };
  };
};

export type FumadocsGithubConfig = {
  user: string;
  repo: string;
  branch: string;
};

export type FumadocsSettings = {
  basePath: string;
  contentRoot: string;
  github: FumadocsGithubConfig;
};

export function parseInitArgs(args: string[]): ParsedInitArgs {
  const [first, ...rest] = args;
  const preset = first && !first.startsWith("--") ? first : undefined;
  const tail = preset ? rest : args;

  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < tail.length; i += 1) {
    const token = tail[i];
    if (!token || !token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = tail[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { preset, flags };
}

export function getStringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
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

export function toTitleCase(segment: string): string {
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function ensureFile(filePath: string, content: string): Promise<"created" | "skipped"> {
  if (existsSync(filePath)) return "skipped";
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return "created";
}

export async function createBaseConfig(cwd: string) {
  const lallyConfigPath = path.join(cwd, "lally.config.json");

  const config: LallyConfig & Record<string, unknown> = {
    schema: "https://christopherlally.com/schemas/config.json",
    uiLibrary: "radix-ui",
    generatedBy: "@chris-lally/cli",
    fumadocs: {
      basePath: "/docs",
      contentRoot: "docs",
      github: {
        user: "fuma-nama",
        repo: "fumadocs",
        branch: "main",
      },
    },
  };

  if (existsSync(lallyConfigPath)) {
    console.log("lally.config.json already exists");
    return;
  }

  await fs.writeFile(lallyConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log("Created lally.config.json");
}

export async function getFumadocsSettings(appRoot: string): Promise<FumadocsSettings> {
  const configPath = resolve(appRoot, "lally.config.json");
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as LallyConfig;

  const github = parsed.fumadocs?.github;
  return {
    basePath: normalizeBasePath(parsed.fumadocs?.basePath),
    contentRoot: normalizeContentRoot(parsed.fumadocs?.contentRoot),
    github: {
      user: github?.user?.trim() || "fuma-nama",
      repo: github?.repo?.trim() || "fumadocs",
      branch: github?.branch?.trim() || "main",
    },
  };
}
