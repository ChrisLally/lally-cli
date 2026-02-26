import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ensureFile,
  ensureJsonFile,
  getFumadocsSettings,
  loadJson,
  toTitleCase,
} from "./shared";

export async function addFumadocsSection(appRoot: string, sectionName: string) {
  const sectionSlug = sectionName.trim().toLowerCase().replace(/\s+/g, "-");
  const sectionTitle = toTitleCase(sectionSlug);
  const { contentRoot } = await getFumadocsSettings(appRoot);

  const rootMetaPath = resolve(appRoot, `content/${contentRoot}/meta.json`);
  const currentMeta = (await loadJson<{ title?: string; root?: boolean; pages?: string[] }>(rootMetaPath)) ?? {
    title: toTitleCase(contentRoot),
    root: true,
    pages: [],
  };

  const pages = new Set(currentMeta.pages ?? []);
  pages.add(sectionSlug);

  await ensureJsonFile(rootMetaPath, {
    title: currentMeta.title ?? toTitleCase(contentRoot),
    root: true,
    pages: Array.from(pages),
  });

  const sectionMetaPath = resolve(appRoot, `content/${contentRoot}/${sectionSlug}/meta.json`);
  const sectionIndexPath = resolve(appRoot, `content/${contentRoot}/${sectionSlug}/index.mdx`);

  await ensureJsonFile(sectionMetaPath, {
    title: sectionTitle,
    root: true,
    pages: ["index"],
  });

  await ensureFile(
    sectionIndexPath,
    `---\ntitle: ${sectionTitle}\ndescription: ${sectionTitle} section\n---\n\nWelcome to ${sectionTitle}.\n`,
  );

  console.log(`Added section content: content/${contentRoot}/${sectionSlug}`);
  console.log("Next: wire this section into source.config.ts and src/lib/source.ts if needed.");
}

export async function addPageShell(appRoot: string) {
  const target = resolve(appRoot, "src/components/notebook/custom-page-shell.tsx");

  const content = `import type { ReactNode } from 'react';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/notebook/page';
import { LLMCopyButton, ViewOptions } from '@/components/ai/page-actions';
import { gitConfig } from '@/lib/layout.shared';

type CustomPageShellProps = {
  title: string;
  description: string;
  markdownUrl: string;
  githubContentPath: string;
  children: ReactNode;
};

export function CustomPageShell({
  title,
  description,
  markdownUrl,
  githubContentPath,
  children,
}: CustomPageShellProps) {
  const githubUrl = \`https://github.com/\${gitConfig.user}/\${gitConfig.repo}/blob/\${gitConfig.branch}/\${githubContentPath}\`;

  return (
    <DocsPage toc={[]} tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }} footer={{ enabled: false }}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription className="mb-0">{description}</DocsDescription>
      <div className="mb-6 flex flex-row items-center gap-2 border-b pb-6">
        <LLMCopyButton markdownUrl={markdownUrl} />
        <ViewOptions markdownUrl={markdownUrl} githubUrl={githubUrl} />
      </div>
      <DocsBody>{children}</DocsBody>
    </DocsPage>
  );
}
`;

  const result = await ensureFile(target, content);
  console.log(result === "created" ? `Created ${target}` : `Skipped ${target} (already exists)`);
}

export async function addSidebarHistory(appRoot: string) {
  const { basePath, contentRoot } = await getFumadocsSettings(appRoot);
  const packageJsonPath = resolve(appRoot, "package.json");
  const packageJson = await loadJson<Record<string, unknown>>(packageJsonPath);

  if (packageJson) {
    const dependencies = (packageJson.dependencies as Record<string, string> | undefined) ?? {};
    if (!dependencies["@chris-lally/fumadocs"]) {
      dependencies["@chris-lally/fumadocs"] = "^0.1.0-alpha.1";
      packageJson.dependencies = dependencies;
      await ensureJsonFile(packageJsonPath, packageJson);
      console.log("Added dependency: @chris-lally/fumadocs");
    }
  }

  const componentPath = resolve(appRoot, "src/components/sidebar/global-history-banner.tsx");
  const componentContent = `"use client";

import { SidebarHistoryBanner } from '@chris-lally/fumadocs';

export function GlobalHistoryBanner() {
  return <SidebarHistoryBanner basePath="${basePath}" storageKey="${contentRoot}-sidebar-history-v1" />;
}
`;

  const result = await ensureFile(componentPath, componentContent);
  console.log(result === "created" ? `Created ${componentPath}` : `Skipped ${componentPath} (already exists)`);

  const routeLayoutPath = resolve(appRoot, `src/app/${contentRoot}/layout.tsx`);
  const docsLayoutPath = resolve(appRoot, "src/app/docs/layout.tsx");
  const targetLayoutPath = existsSync(routeLayoutPath) ? routeLayoutPath : docsLayoutPath;

  if (existsSync(targetLayoutPath)) {
    let layout = await readFile(targetLayoutPath, "utf8");
    if (!layout.includes("GlobalHistoryBanner")) {
      layout = `import { GlobalHistoryBanner } from '@/components/sidebar/global-history-banner';\n${layout}`;
    }

    if (!layout.includes("sidebar={{ banner: <GlobalHistoryBanner /> }}")) {
      layout = layout.replace(
        /<DocsLayout([\s\S]*?)>/m,
        (match) => {
          if (match.includes("sidebar={")) return match;
          return match.replace(">", "\n      sidebar={{ banner: <GlobalHistoryBanner /> }}\n    >");
        },
      );
    }

    await writeFile(targetLayoutPath, layout, "utf8");
    console.log(`Updated layout with sidebar history banner: ${targetLayoutPath}`);
  } else {
    console.log(
      `No src/app/${contentRoot}/layout.tsx or src/app/docs/layout.tsx found. Wire GlobalHistoryBanner manually in your DocsLayout sidebar.banner.`,
    );
  }
}
