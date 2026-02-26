import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export type NpmAuthResult = {
  npmUserConfigPath: string | null;
  generatedTempUserConfigPath: string | null;
  commandEnv: NodeJS.ProcessEnv;
};

async function createTempNpmUserConfig(token: string): Promise<string> {
  const filePath = resolve(tmpdir(), `lally-npmrc-${process.pid}-${randomUUID()}`);
  const content = [
    "registry=https://registry.npmjs.org/",
    `//registry.npmjs.org/:_authToken=${token}`,
    "always-auth=true",
    "",
  ].join("\n");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export async function resolveNpmAuth(repoRoot: string): Promise<NpmAuthResult> {
  const publishNpmRcPath = resolve(repoRoot, ".npmrc.publish");
  const repoNpmRcPath = resolve(repoRoot, ".npmrc");
  const explicitUserConfig = process.env.NPM_CONFIG_USERCONFIG ?? null;
  let generatedTempUserConfigPath: string | null = null;

  const npmUserConfigPath = explicitUserConfig
    ? explicitUserConfig
    : process.env.NPM_TOKEN
      ? (generatedTempUserConfigPath = await createTempNpmUserConfig(process.env.NPM_TOKEN), generatedTempUserConfigPath)
      : existsSync(publishNpmRcPath)
        ? publishNpmRcPath
        : existsSync(repoNpmRcPath)
          ? repoNpmRcPath
          : null;

  const commandEnv: NodeJS.ProcessEnv = npmUserConfigPath
    ? { NPM_CONFIG_USERCONFIG: npmUserConfigPath }
    : {};

  return {
    npmUserConfigPath,
    generatedTempUserConfigPath,
    commandEnv,
  };
}

export async function cleanupTempNpmrc(path: string | null): Promise<void> {
  if (!path) return;
  await rm(path, { force: true });
}
