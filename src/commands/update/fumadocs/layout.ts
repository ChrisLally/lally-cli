import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { syncFumadocsLayoutShared } from "../../fumadocs/layout-shared";

type FumadocsConfig = {
  basePath?: string;
  contentRoot?: string;
  layoutPreset?: string;
  github?: {
    user?: string;
    repo?: string;
    branch?: string;
  };
};

type LallyConfig = {
  fumadocs?: FumadocsConfig;
};

function looksLikeMonorepoRoot(dir: string): boolean {
  return (
    existsSync(resolve(dir, "pnpm-workspace.yaml")) ||
    (existsSync(resolve(dir, "apps")) && existsSync(resolve(dir, "packages")))
  );
}

function looksLikeAppDirectory(dir: string): boolean {
  return (
    existsSync(resolve(dir, "package.json")) &&
    (existsSync(resolve(dir, "next.config.mjs")) ||
      existsSync(resolve(dir, "next.config.ts")) ||
      existsSync(resolve(dir, "src/app")) ||
      existsSync(resolve(dir, "content")))
  );
}

function parseFlags(args: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token || !token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return flags;
}

function getStringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

function getFumadocsConfig(parsed: LallyConfig): FumadocsConfig {
  if (!parsed.fumadocs) {
    throw new Error("Missing `fumadocs` section in lally.config.json");
  }

  if (!parsed.fumadocs.basePath || !parsed.fumadocs.contentRoot) {
    throw new Error("Missing `fumadocs.basePath` or `fumadocs.contentRoot` in lally.config.json");
  }

  return parsed.fumadocs;
}

function notebookTopnavLayoutContent(contentRoot: string): string {
  return `import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/${contentRoot}'>) {
  const { nav, ...base } = baseOptions();

  return (
    <DocsLayout
      {...base}
      nav={{ ...nav, mode: 'top' }}
      tabMode="navbar"
      tree={source.getPageTree()}
    >
      {children}
    </DocsLayout>
  );
}
`;
}

const PAGE_IMPORT_MAPPINGS: Array<{ from: string; to: string }> = [
  {
    from: "from 'fumadocs-ui/layouts/docs/page'",
    to: "from 'fumadocs-ui/layouts/notebook/page'",
  },
  {
    from: 'from "fumadocs-ui/layouts/docs/page"',
    to: 'from "fumadocs-ui/layouts/notebook/page"',
  },
  {
    from: "from 'fumadocs-ui/layouts/flux/page'",
    to: "from 'fumadocs-ui/layouts/notebook/page'",
  },
  {
    from: 'from "fumadocs-ui/layouts/flux/page"',
    to: 'from "fumadocs-ui/layouts/notebook/page"',
  },
];

async function alignNotebookPageImport(appRoot: string, contentRoot: string): Promise<string | null> {
  const pageCandidates = [
    resolve(appRoot, `src/app/${contentRoot}/[[...slug]]/page.tsx`),
    resolve(appRoot, `src/app/${contentRoot}/[...slug]/page.tsx`),
  ];

  for (const pagePath of pageCandidates) {
    if (!existsSync(pagePath)) continue;

    const original = await readFile(pagePath, "utf8");
    let updated = original;

    for (const mapping of PAGE_IMPORT_MAPPINGS) {
      if (updated.includes(mapping.from)) {
        updated = updated.replaceAll(mapping.from, mapping.to);
      }
    }

    if (updated !== original) {
      await writeFile(pagePath, updated, "utf8");
      return pagePath;
    }

    return null;
  }

  return null;
}

export async function runUpdateLayoutCommand(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const preset = getStringFlag(flags, "preset");

  if (!preset) {
    console.error("Missing required flag: --preset <name>");
    console.error("Supported presets: notebook-topnav");
    return 1;
  }

  if (preset !== "notebook-topnav") {
    console.error(`Unsupported preset: ${preset}`);
    console.error("Supported presets: notebook-topnav");
    return 1;
  }

  const appFlag = getStringFlag(flags, "app");
  const appRoot = resolve(process.cwd(), appFlag ?? ".");

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

  const configPath = resolve(appRoot, "lally.config.json");
  if (!existsSync(configPath)) {
    console.error("Missing lally.config.json in app root. Run `lally init --app <path>` first.");
    return 1;
  }

  const configRaw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(configRaw) as LallyConfig;
  const fumadocs = getFumadocsConfig(parsed);

  const layoutPath = resolve(appRoot, `src/app/${fumadocs.contentRoot}/layout.tsx`);
  if (!existsSync(layoutPath)) {
    console.error(`Missing layout file: ${layoutPath}`);
    return 1;
  }

  await writeFile(layoutPath, notebookTopnavLayoutContent(fumadocs.contentRoot as string), "utf8");
  const updatedPagePath = await alignNotebookPageImport(appRoot, fumadocs.contentRoot as string);
  const layoutSharedSync = await syncFumadocsLayoutShared(appRoot, fumadocs.contentRoot as string, {
    user: fumadocs.github?.user?.trim() || "fuma-nama",
    repo: fumadocs.github?.repo?.trim() || "fumadocs",
    branch: fumadocs.github?.branch?.trim() || "main",
  });

  parsed.fumadocs = {
    ...fumadocs,
    layoutPreset: "notebook-topnav",
  };
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  console.log(`Applied preset '${preset}' to ${layoutPath}`);
  if (updatedPagePath) {
    console.log(`Aligned page layout import to notebook: ${updatedPagePath}`);
  }
  if (layoutSharedSync.created) {
    console.log(`Created ${layoutSharedSync.filePath}`);
  } else if (layoutSharedSync.updated) {
    console.log(`Updated ${layoutSharedSync.filePath}`);
  }
  console.log("Updated lally.config.json with fumadocs.layoutPreset=notebook-topnav");
  return 0;
}
