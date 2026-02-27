import { spawnSync } from "node:child_process";

type OpenSrcRunner = {
  command: string;
  prefixArgs: string[];
};

type ModifyFlag = string | boolean | undefined;

function hasCommand(command: string): boolean {
  try {
    const result = spawnSync(command, ["--version"], { stdio: "ignore", env: process.env });
    return result.status === 0 && !result.error;
  } catch {
    return false;
  }
}

function resolveOpenSrcRunner(): OpenSrcRunner {
  const forced = (process.env.LALLY_PM ?? "").trim().toLowerCase();

  if (forced === "pnpm" && hasCommand("pnpm")) return { command: "pnpm", prefixArgs: ["dlx", "opensrc"] };
  if (forced === "npm" && hasCommand("npm")) return { command: "npm", prefixArgs: ["exec", "--yes", "opensrc"] };
  if (forced === "yarn" && hasCommand("yarn")) return { command: "yarn", prefixArgs: ["dlx", "opensrc"] };
  if (forced === "bun" && hasCommand("bunx")) return { command: "bunx", prefixArgs: ["opensrc"] };
  if (forced) throw new Error(`LALLY_PM is set to '${forced}', but the command is not available.`);

  if (hasCommand("pnpm")) return { command: "pnpm", prefixArgs: ["dlx", "opensrc"] };
  if (hasCommand("npm")) return { command: "npm", prefixArgs: ["exec", "--yes", "opensrc"] };
  if (hasCommand("yarn")) return { command: "yarn", prefixArgs: ["dlx", "opensrc"] };
  if (hasCommand("bunx")) return { command: "bunx", prefixArgs: ["opensrc"] };

  throw new Error("No supported package manager runtime found. Install pnpm, npm, yarn, or bun.");
}

function parseModifyFlag(argv: string[]): ModifyFlag {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token === "--modify") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        return next;
      }
      return true;
    }

    if (token.startsWith("--modify=")) {
      return token.slice("--modify=".length);
    }
  }

  return undefined;
}

/**
 * @description Extract positional arguments (non-flag tokens) from opensrc argv tail.
 */
function getPositionalArgs(argv: string[]): string[] {
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token.startsWith("--")) {
      if (token === "--modify" || token.startsWith("--modify=")) {
        const next = argv[i + 1];
        if (token === "--modify" && next && !next.startsWith("--")) i += 1;
        continue;
      }
      if (token.includes("=")) continue;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }

    positional.push(token);
  }

  return positional;
}

function runOpensrc(commandArgs: string[], modifyFlag: ModifyFlag): void {
  if (modifyFlag === true) {
    commandArgs.push("--modify");
  } else if (modifyFlag === false) {
    commandArgs.push("--modify=false");
  } else if (typeof modifyFlag === "string") {
    const normalized = modifyFlag.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") {
      commandArgs.push(`--modify=${normalized}`);
    } else {
      throw new Error("Invalid --modify value. Use --modify, --modify=true, or --modify=false.");
    }
  }

  const runner = resolveOpenSrcRunner();
  const result = spawnSync(runner.command, [...runner.prefixArgs, ...commandArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Failed to run opensrc: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`opensrc exited with status ${result.status ?? 1}`);
  }
}

/**
 * @description Run opensrc via the available package manager runtime without requiring global install.
 */
export function runOpensrcCommand(argsAfterItem: string[], modifyFlag?: ModifyFlag): void {
  const effectiveModifyFlag = modifyFlag ?? parseModifyFlag(argsAfterItem) ?? false;
  const positional = getPositionalArgs(argsAfterItem);
  const first = positional[0];

  if (first === "list") {
    runOpensrc(["list"], effectiveModifyFlag);
    return;
  }

  if (first === "remove") {
    const targets = positional.slice(1);
    if (targets.length === 0) {
      throw new Error("Missing remove target(s). Usage: lally opensrc remove <target...>");
    }
    runOpensrc(["remove", ...targets], effectiveModifyFlag);
    return;
  }

  if (positional.length === 0) {
    throw new Error(
      "Missing opensrc target(s). Usage: lally opensrc fetch <target...> | lally opensrc list | lally opensrc remove <target...>",
    );
  }

  runOpensrc([...positional], effectiveModifyFlag);
}
