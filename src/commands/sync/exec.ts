import { spawnSync } from "node:child_process";

/**
 * @description Execute a command synchronously with captured stdout/stderr.
 */
export function runCommand(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    env: process.env,
    maxBuffer: 1024 * 1024 * 30,
    encoding: "utf8",
  });
}

/**
 * @description Execute a shell script string via bash -lc in a specific working directory.
 */
export function runBash(script: string, cwd: string) {
  return runCommand("bash", ["-lc", script], cwd);
}

/**
 * @description Throw a detailed error when a command exit code is non-zero.
 */
export function ensureOk(result: ReturnType<typeof runCommand>, label: string) {
  if (result.status === 0) return;

  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  const details = [stdout, stderr].filter(Boolean).join("\n");
  throw new Error(details ? `${label} failed:\n${details}` : `${label} failed.`);
}
