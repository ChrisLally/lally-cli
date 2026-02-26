import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ReadmeTargetConfig = {
  packagePath: string;
  output?: string;
  binPath?: string;
  bin?: string;
  helpCommands?: string[];
  includeCommands?: string[];
  excludeCommands?: string[];
};

export type LallyConfig = {
  fumadocs?: {
    basePath?: string;
    contentRoot?: string;
    layoutPreset?: string;
    github?: {
      user?: string;
      repo?: string;
      branch?: string;
    };
  };
  update?: {
    subtree?: {
      dir?: string;
      targets?: Record<string, string>;
    };
  };
  project?: {
    subtree?: {
      dir?: string;
      targets?: Record<string, string>;
    };
  };
  readme?: {
    targets?: Record<string, ReadmeTargetConfig>;
  };
};

export async function loadConfig(repoRoot: string): Promise<LallyConfig> {
  const configPath = resolve(repoRoot, "lally.config.json");
  try {
    const content = await readFile(configPath, "utf8");
    return JSON.parse(content) as LallyConfig;
  } catch {
    return {};
  }
}
