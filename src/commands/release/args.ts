import { ParsedArgs, ReleaseTarget } from "./types";

export function releaseHelp(): string {
  return [
    "Usage:",
    "  lally release <target> --tag <tag> [--dry-run] [--json]",
    "",
    "Targets:",
    "  fumadocs   Publish @chris-lally/fumadocs",
    "  cli        Publish @chris-lally/cli",
    "",
    "Examples:",
    "  lally release fumadocs --tag alpha --dry-run",
    "  lally release fumadocs --tag alpha --json",
    "",
    "Notes:",
    "  - For target=cli, README is regenerated automatically before build.",
    "",
    "Auth resolution (first match wins):",
    "  1) NPM_CONFIG_USERCONFIG env var (explicit path)",
    "  2) generated temp npmrc from NPM_TOKEN (auto)",
    "  3) <repo>/.npmrc.publish",
    "  4) <repo>/.npmrc",
    "  5) default npm user config (e.g. ~/.npmrc from npm login)",
    "",
    "NPM_TOKEN can be provided via shell env or repo .env.",
  ].join("\n");
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
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

  return { command, flags };
}

export function getStringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

export function hasFlag(flags: Map<string, string | boolean>, key: string): boolean {
  return Boolean(flags.get(key));
}

export function parseTarget(value: string | undefined): ReleaseTarget | null {
  if (value === "fumadocs" || value === "cli") return value;
  return null;
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
