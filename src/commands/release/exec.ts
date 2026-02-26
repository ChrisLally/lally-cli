import { spawnSync } from "node:child_process";

export function runOrThrow(command: string, args: string[], cwd: string, extraEnv?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}
