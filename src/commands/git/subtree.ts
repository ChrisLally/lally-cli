import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { getStringFlag, hasFlag, parseArgs } from "./subtree-args";
import { loadConfig, LallyConfig } from "../repo/config";
import { printJson } from "./subtree-output";
import { findRepoRoot } from "./repo";

function resolveScriptFromTarget(
  config: LallyConfig,
  target: string | null,
  action: string | null,
): string | null {
  if (!target) return null;
  const template = config.update?.subtree?.targets?.[target] ?? config.project?.subtree?.targets?.[target];
  if (!template) return null;

  if (template.includes("{action}")) {
    if (!action) return null;
    return template.replaceAll("{action}", action);
  }

  return template;
}

function runScript(scriptPath: string, repoRoot: string) {
  return spawnSync("bash", [scriptPath], {
    cwd: repoRoot,
    stdio: "pipe",
    env: process.env,
    maxBuffer: 1024 * 1024 * 20,
    encoding: "utf8",
  });
}

export async function runGitSubtreeCommand(args: string[]): Promise<number> {
  const { flags } = parseArgs(["subtree", ...args]);
  const json = hasFlag(flags, "json");
  const scriptFlag = getStringFlag(flags, "script");
  const target = getStringFlag(flags, "target");
  const action = getStringFlag(flags, "action");

  const repoRoot = findRepoRoot(process.cwd());
  const config = await loadConfig(repoRoot);
  const subtreeDir = getStringFlag(flags, "dir") ?? config.update?.subtree?.dir ?? config.project?.subtree?.dir ?? "scripts/subtree";

  const resolvedFromTarget = resolveScriptFromTarget(config, target, action);
  const chosenScript = scriptFlag ?? resolvedFromTarget;

  if (!chosenScript) {
    console.error("Missing subtree script.");
    console.error("Provide --script, or configure target mapping in lally.config.json and use --target [--action].");
    console.error("Usage: lally git subtree --target <name> --action <push|pull> [--dir <path>] [--json]");
    return 1;
  }

  const scriptPath = chosenScript.includes("/")
    ? resolve(repoRoot, chosenScript)
    : resolve(repoRoot, subtreeDir, chosenScript);

  const result = runScript(scriptPath, repoRoot);

  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    if (json) {
      printJson({
        ok: false,
        scriptPath,
        target,
        action,
      });
    }
    return result.status ?? 1;
  }

  if (json) {
    printJson({
      ok: true,
      scriptPath,
      target,
      action,
    });
  }

  return 0;
}
