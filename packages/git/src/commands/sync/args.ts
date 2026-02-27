export type ParsedArgs = {
  command: string | undefined;
  flags: Map<string, string | boolean>;
};

/**
 * @description Parse subcommand argv tokens into a command name and --flag map.
 */
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

/**
 * @description Read a string value for a named flag from parsed args.
 */
export function getStringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const value = flags.get(key);
  return typeof value === "string" ? value : null;
}

/**
 * @description Check whether a flag is present in parsed args.
 */
export function hasFlag(flags: Map<string, string | boolean>, key: string): boolean {
  return Boolean(flags.get(key));
}
