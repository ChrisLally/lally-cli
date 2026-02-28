import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type SyncResult = {
  filePath: string;
  created: boolean;
  updated: boolean;
};

type GithubConfig = {
  user: string;
  repo: string;
  branch: string;
};

function defaultLayoutSharedContent(contentRoot: string, github: GithubConfig): string {
  return `import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

// fill this with your actual GitHub info
export const gitConfig = {
  user: '${github.user}',
  repo: '${github.repo}',
  branch: '${github.branch}',
};

export function getGithubRepoUrl(): string {
  return \`https://github.com/\${gitConfig.user}/\${gitConfig.repo}\`;
}

export function getGithubContentUrl(contentPath: string): string {
  return \`\${getGithubRepoUrl()}/blob/\${gitConfig.branch}/content/${contentRoot}/\${contentPath}\`;
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'My App',
    },
    githubUrl: getGithubRepoUrl(),
  };
}
`;
}

function injectGithubHelpers(content: string, contentRoot: string): string {
  const hasRepoHelper = content.includes("export function getGithubRepoUrl()");
  const hasContentHelper = content.includes("export function getGithubContentUrl(");
  if (hasRepoHelper && hasContentHelper) return content;

  const helpers = `export function getGithubRepoUrl(): string {
  return \`https://github.com/\${gitConfig.user}/\${gitConfig.repo}\`;
}

export function getGithubContentUrl(contentPath: string): string {
  return \`\${getGithubRepoUrl()}/blob/\${gitConfig.branch}/content/${contentRoot}/\${contentPath}\`;
}

`;

  const gitConfigEnd = content.indexOf("};");
  if (gitConfigEnd !== -1) {
    return `${content.slice(0, gitConfigEnd + 3)}\n\n${helpers}${content.slice(gitConfigEnd + 3)}`;
  }

  return `${helpers}${content}`;
}

function syncGitConfigObject(content: string, github: GithubConfig): string {
  if (!content.includes("export const gitConfig")) {
    return `export const gitConfig = {
  user: '${github.user}',
  repo: '${github.repo}',
  branch: '${github.branch}',
};

${content}`;
  }

  return content.replace(
    /export const gitConfig = \{[\s\S]*?\};/m,
    `export const gitConfig = {
  user: '${github.user}',
  repo: '${github.repo}',
  branch: '${github.branch}',
};`,
  );
}

export async function syncFumadocsLayoutShared(
  appRoot: string,
  contentRoot: string,
  github: GithubConfig,
): Promise<SyncResult> {
  const filePath = resolve(appRoot, "src/lib/layout.shared.tsx");

  if (!existsSync(filePath)) {
    await writeFile(filePath, defaultLayoutSharedContent(contentRoot, github), "utf8");
    return { filePath, created: true, updated: false };
  }

  const original = await readFile(filePath, "utf8");
  let updated = original;

  // Keep the helper bound to the configured content root.
  updated = updated.replace(
    /export function getGithubContentUrl\(\s*contentPath:\s*string\s*\):\s*string\s*\{[\s\S]*?\n\}/m,
    `export function getGithubContentUrl(contentPath: string): string {
  return \`\${getGithubRepoUrl()}/blob/\${gitConfig.branch}/content/${contentRoot}/\${contentPath}\`;
}`,
  );

  updated = injectGithubHelpers(updated, contentRoot);
  updated = syncGitConfigObject(updated, github);

  if (updated.includes("githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`")) {
    updated = updated.replaceAll(
      "githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`",
      "githubUrl: getGithubRepoUrl()",
    );
  }

  if (updated !== original) {
    await writeFile(filePath, updated, "utf8");
    return { filePath, created: false, updated: true };
  }

  return { filePath, created: false, updated: false };
}
