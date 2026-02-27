import { spawnSync } from "node:child_process";

/**
 * @description Extract positional arguments (non-flag tokens) from opensrc argv tail.
 */
function getPositionalArgs(argv: string[]): string[] {
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token.startsWith("--")) {
      if (token.includes("=")) continue;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }

    positional.push(token);
  }

  return positional;
}

function runOpensrc(commandArgs: string[], modifyFlag: string | boolean | undefined): void {
  if (modifyFlag === true) {
    commandArgs.push("--modify");
  } else if (typeof modifyFlag === "string") {
    const normalized = modifyFlag.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") {
      commandArgs.push(`--modify=${normalized}`);
    } else {
      throw new Error("Invalid --modify value. Use --modify, --modify=true, or --modify=false.");
    }
  }

  const result = spawnSync("pnpm", commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Failed to run opensrc via pnpm dlx: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`opensrc exited with status ${result.status ?? 1}`);
  }
}

/**
 * @description Run `pnpm dlx opensrc` for fetch/list/remove operations without requiring global install.
 */
export function runOpensrcCommand(argsAfterItem: string[], modifyFlag: string | boolean | undefined): void {
  const positional = getPositionalArgs(argsAfterItem);
  const first = positional[0];

  if (first === "list") {
    runOpensrc(["dlx", "opensrc", "list"], modifyFlag);
    return;
  }

  if (first === "remove") {
    const targets = positional.slice(1);
    if (targets.length === 0) {
      throw new Error("Missing remove target(s). Usage: lally opensrc remove <target...>");
    }
    runOpensrc(["dlx", "opensrc", "remove", ...targets], modifyFlag);
    return;
  }

  if (positional.length === 0) {
    throw new Error(
      "Missing opensrc target(s). Usage: lally opensrc fetch <target...> | lally opensrc list | lally opensrc remove <target...>",
    );
  }

  runOpensrc(["dlx", "opensrc", ...positional], modifyFlag);
}
