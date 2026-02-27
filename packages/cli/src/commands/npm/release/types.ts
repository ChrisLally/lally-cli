export type ReleaseTarget = "fumadocs" | "cli";

export type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  scripts?: Record<string, string | undefined>;
};

export type ParsedArgs = {
  command: string | undefined;
  flags: Map<string, string | boolean>;
};
