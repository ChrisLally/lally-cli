import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CheckResult } from "../shared";

const REQUIRED_GITIGNORE_ENTRIES = ["/node_modules", "/.next/", ".source", ".lally-clean-backup", "next-env.d.ts"];

type LallyConfig = {
  fumadocs?: {
    contentRoot?: string;
    layoutPreset?: string;
  };
};

export async function runFumadocsChecks(appRoot: string, strictLayout: boolean): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const gitignorePath = resolve(appRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    results.push({ id: "gitignore-exists", ok: false, message: "Missing .gitignore" });
  } else {
    const content = await readFile(gitignorePath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const missing = REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !lines.includes(entry));
    if (missing.length === 0) {
      results.push({ id: "gitignore-required-entries", ok: true, message: "All required .gitignore entries are present" });
    } else {
      results.push({
        id: "gitignore-required-entries",
        ok: false,
        message: `Missing .gitignore entries: ${missing.join(", ")}`,
      });
    }
  }

  const hasNextConfig = existsSync(resolve(appRoot, "next.config.mjs")) || existsSync(resolve(appRoot, "next.config.ts"));
  results.push({
    id: "next-config",
    ok: hasNextConfig,
    message: hasNextConfig ? "Found next.config" : "Missing next.config.mjs or next.config.ts",
  });

  const hasSourceConfig = existsSync(resolve(appRoot, "source.config.ts")) || existsSync(resolve(appRoot, "source.config.mjs"));
  results.push({
    id: "source-config",
    ok: hasSourceConfig,
    message: hasSourceConfig ? "Found source.config" : "Missing source.config.ts or source.config.mjs",
  });

  const hasSourceLib = existsSync(resolve(appRoot, "src/lib/source.ts")) || existsSync(resolve(appRoot, "src/lib/source.tsx"));
  results.push({
    id: "source-lib",
    ok: hasSourceLib,
    message: hasSourceLib ? "Found src/lib/source" : "Missing src/lib/source.ts or src/lib/source.tsx",
  });

  if (strictLayout) {
    const configPath = resolve(appRoot, "lally.config.json");
    if (!existsSync(configPath)) {
      results.push({
        id: "layout-config",
        ok: false,
        message: "Missing lally.config.json (required for strict layout check)",
      });
      return results;
    }

    const config = JSON.parse(await readFile(configPath, "utf8")) as LallyConfig;
    const contentRoot = config.fumadocs?.contentRoot;
    const layoutPreset = config.fumadocs?.layoutPreset;

    if (!contentRoot) {
      results.push({
        id: "layout-config-content-root",
        ok: false,
        message: "Missing fumadocs.contentRoot in lally.config.json",
      });
      return results;
    }

    if (layoutPreset !== "notebook-topnav") {
      results.push({
        id: "layout-config-preset",
        ok: false,
        message: "Expected fumadocs.layoutPreset=notebook-topnav",
      });
      return results;
    }

    const layoutPath = resolve(appRoot, `src/app/${contentRoot}/layout.tsx`);
    if (!existsSync(layoutPath)) {
      results.push({
        id: "layout-file",
        ok: false,
        message: `Missing layout file: src/app/${contentRoot}/layout.tsx`,
      });
      return results;
    }

    const layoutContent = await readFile(layoutPath, "utf8");
    const hasNotebookImport = layoutContent.includes("fumadocs-ui/layouts/notebook");
    const hasNavTopMode = layoutContent.includes("mode: 'top'") || layoutContent.includes('mode: "top"');
    const hasNavbarTabs = layoutContent.includes('tabMode="navbar"') || layoutContent.includes("tabMode='navbar'");

    results.push({
      id: "layout-file-notebook-import",
      ok: hasNotebookImport,
      message: hasNotebookImport
        ? "Notebook layout import is present"
        : "Expected notebook layout import from fumadocs-ui/layouts/notebook",
    });
    results.push({
      id: "layout-file-nav-top",
      ok: hasNavTopMode,
      message: hasNavTopMode ? "Top nav mode is configured" : "Expected nav mode set to top",
    });
    results.push({
      id: "layout-file-tab-navbar",
      ok: hasNavbarTabs,
      message: hasNavbarTabs ? "Navbar tab mode is configured" : "Expected tabMode set to navbar",
    });

    const pageCandidates = [
      resolve(appRoot, `src/app/${contentRoot}/[[...slug]]/page.tsx`),
      resolve(appRoot, `src/app/${contentRoot}/[...slug]/page.tsx`),
    ];
    const pagePath = pageCandidates.find((candidate) => existsSync(candidate));

    if (!pagePath) {
      results.push({
        id: "layout-page-file",
        ok: false,
        message: `Missing page file: src/app/${contentRoot}/[[...slug]]/page.tsx`,
      });
      return results;
    }

    const pageContent = await readFile(pagePath, "utf8");
    const hasNotebookPageImport =
      pageContent.includes("from 'fumadocs-ui/layouts/notebook/page'") ||
      pageContent.includes('from "fumadocs-ui/layouts/notebook/page"');

    results.push({
      id: "layout-page-notebook-import",
      ok: hasNotebookPageImport,
      message: hasNotebookPageImport
        ? "Page uses notebook page components"
        : "Expected page import from fumadocs-ui/layouts/notebook/page",
    });

    const layoutSharedPath = resolve(appRoot, "src/lib/layout.shared.tsx");
    if (!existsSync(layoutSharedPath)) {
      results.push({
        id: "layout-shared-file",
        ok: false,
        message: "Missing src/lib/layout.shared.tsx",
      });
      return results;
    }

    const layoutSharedContent = await readFile(layoutSharedPath, "utf8");
    const hasBaseOptionsExport =
      layoutSharedContent.includes("export function baseOptions(") || layoutSharedContent.includes("export const baseOptions");
    const hasContentUrlHelper = layoutSharedContent.includes("export function getGithubContentUrl(");
    const hasConfiguredContentRoot = layoutSharedContent.includes(`/content/${contentRoot}/`);

    results.push({
      id: "layout-shared-base-options",
      ok: hasBaseOptionsExport,
      message: hasBaseOptionsExport ? "layout.shared exports baseOptions" : "Expected baseOptions export in src/lib/layout.shared.tsx",
    });
    results.push({
      id: "layout-shared-content-url-helper",
      ok: hasContentUrlHelper,
      message: hasContentUrlHelper
        ? "layout.shared exports getGithubContentUrl"
        : "Expected getGithubContentUrl helper in src/lib/layout.shared.tsx",
    });
    results.push({
      id: "layout-shared-content-root-path",
      ok: hasConfiguredContentRoot,
      message: hasConfiguredContentRoot
        ? `layout.shared content path matches content root (${contentRoot})`
        : `Expected src/lib/layout.shared.tsx to reference /content/${contentRoot}/`,
    });
  }

  return results;
}
