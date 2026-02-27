import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { syncFumadocsLayoutShared } from "../../fumadocs/layout-shared";
import { createBaseConfig, ensureFile, getFumadocsSettings, toTitleCase } from "../shared";

export async function initFumadocsBasePath(appRoot: string) {
  await createBaseConfig(appRoot);
  const { basePath, contentRoot, github } = await getFumadocsSettings(appRoot);
  const sectionTitle = toTitleCase(contentRoot);

  const rootMetaPath = resolve(appRoot, `content/${contentRoot}/meta.json`);
  const rootIndexPath = resolve(appRoot, `content/${contentRoot}/index.mdx`);

  await ensureFile(
    rootMetaPath,
    `${JSON.stringify({ title: sectionTitle, root: true, pages: ["index"] }, null, 2)}\n`,
  );

  await ensureFile(
    rootIndexPath,
    `---\ntitle: ${sectionTitle}\ndescription: ${sectionTitle} home\n---\n\nWelcome to your ${contentRoot}.\n`,
  );

  const nextConfigPath = resolve(appRoot, "next.config.mjs");
  if (existsSync(nextConfigPath)) {
    let nextConfig = await fs.readFile(nextConfigPath, "utf8");
    if (!nextConfig.includes("basePath:")) {
      nextConfig = nextConfig.replace("const config = {", `const config = {\n  basePath: '${basePath}',`);
      await fs.writeFile(nextConfigPath, nextConfig, "utf8");
      console.log(`Updated next.config.mjs with basePath '${basePath}'`);
    }
  }

  const layoutSharedSync = await syncFumadocsLayoutShared(appRoot, contentRoot, github);
  if (layoutSharedSync.created) {
    console.log(`Created ${layoutSharedSync.filePath}`);
  } else if (layoutSharedSync.updated) {
    console.log(`Updated ${layoutSharedSync.filePath}`);
  }

  console.log(`Initialized fumadocs/base-path baseline (basePath: ${basePath}, contentRoot: ${contentRoot}).`);
  console.log("Next: use `lally add fumadocs/section --name <name>` to add sections.");
}
