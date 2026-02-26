import { spawnSync } from "node:child_process";

export function runCommand(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    env: process.env,
    maxBuffer: 1024 * 1024 * 30,
    encoding: "utf8",
  });
}

export function runBash(script: string, cwd: string) {
  return runCommand("bash", ["-lc", script], cwd);
}

export function ensureOk(result: ReturnType<typeof runCommand>, label: string) {
  if (result.status === 0) return;

  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  const details = [stdout, stderr].filter(Boolean).join("\n");
  throw new Error(details ? `${label} failed:\n${details}` : `${label} failed.`);
}
