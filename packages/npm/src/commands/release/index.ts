import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runRepoReadmeCommand } from "@chris-lally/cli-repo";
import { cleanupTempNpmrc, resolveNpmAuth } from "./auth";
import { getStringFlag, hasFlag, parseArgs, parseTarget, printJson, releaseHelp } from "./args";
import { findRepoRoot, loadRootEnv } from "./env";
import { runOrThrow } from "./exec";
import { formatRunScriptCommand, resolvePackageManager, runPackageScript } from "./package-manager";
import { PackageJson, ReleaseTarget } from "./types";
import { nextTaggedVersion } from "./version";

function resolveTargetDir(repoRoot: string, target: ReleaseTarget): string {
  if (target === "fumadocs") return resolve(repoRoot, "packages/fumadocs");
  return resolve(repoRoot, "packages/cli");
}

export async function runReleaseCommand(command: string | undefined, args: string[]): Promise<number> {
  if (!command || command === "--help" || command === "help") {
    console.log(releaseHelp());
    return 0;
  }

  const target = parseTarget(command);
  if (!target) {
    console.error(`Unknown release target: ${command}`);
    console.error(releaseHelp());
    return 1;
  }

  const { flags } = parseArgs([command, ...args]);
  const tag = getStringFlag(flags, "tag");
  if (!tag) {
    throw new Error("Missing required flag: --tag");
  }

  const dryRun = hasFlag(flags, "dry-run");
  const json = hasFlag(flags, "json");

  const repoRoot = findRepoRoot(process.cwd());
  await loadRootEnv(repoRoot);
  const packageManager = resolvePackageManager(repoRoot);

  const packageDir = resolveTargetDir(repoRoot, target);
  const packageJsonPath = resolve(packageDir, "package.json");
  const originalPackageJsonText = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(originalPackageJsonText) as PackageJson;

  if (!packageJson.name || typeof packageJson.name !== "string") {
    throw new Error(`Missing or invalid package name at ${packageJsonPath}`);
  }
  if (!packageJson.version || typeof packageJson.version !== "string") {
    throw new Error(`Missing or invalid package version at ${packageJsonPath}`);
  }
  if (packageJson.private === true) {
    throw new Error(`Cannot publish: ${packageJson.name} is marked private=true.`);
  }

  const nextVersion = nextTaggedVersion(packageJson.version, tag);
  const nextSpec = `${packageJson.name}@${nextVersion}`;
  const auth = await resolveNpmAuth(repoRoot);

  if (dryRun) {
    const payload = {
      ok: true,
      dryRun: true,
      target,
      packageDir,
      npmUserConfigPath: auth.npmUserConfigPath ?? "default",
      package: packageJson.name,
      currentVersion: packageJson.version,
      nextVersion,
      nextSpec,
      tag,
      commands: [
        target === "cli" ? "lally repo readme --target cli" : null,
        formatRunScriptCommand(packageManager, "build", packageDir),
        packageJson.scripts?.["check-types"] ? formatRunScriptCommand(packageManager, "check-types", packageDir) : null,
        packageJson.scripts?.["test"] ? formatRunScriptCommand(packageManager, "test", packageDir) : null,
        `npm publish --tag ${tag} --access public`,
      ].filter(Boolean),
    };

    if (json) {
      printJson(payload);
    } else {
      console.log(`[dry-run] target: ${target}`);
      console.log(`[dry-run] package: ${payload.package}`);
      console.log(`[dry-run] current version: ${payload.currentVersion}`);
      console.log(`[dry-run] next version: ${payload.nextVersion}`);
      console.log(`[dry-run] tag: ${tag}`);
      console.log(`[dry-run] npm user config: ${payload.npmUserConfigPath}`);
      for (const line of payload.commands) console.log(`[dry-run] would run: ${line}`);
    }

    await cleanupTempNpmrc(auth.generatedTempUserConfigPath);
    return 0;
  }

  try {
    const nextPackageJson: PackageJson = {
      ...packageJson,
      version: nextVersion,
    };
    await writeFile(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`, "utf8");

    if (target === "cli") {
      await runRepoReadmeCommand(["--target", "cli"]);
    }

    runPackageScript(packageManager, "build", packageDir, repoRoot, auth.commandEnv);
    if (packageJson.scripts?.["check-types"]) {
      runPackageScript(packageManager, "check-types", packageDir, repoRoot, auth.commandEnv);
    }
    if (packageJson.scripts?.["test"]) {
      runPackageScript(packageManager, "test", packageDir, repoRoot, auth.commandEnv);
    }

    if (!process.env.NPM_TOKEN) {
      console.warn("NPM_TOKEN is not set.");
      console.warn("Publish can still work if npm auth exists in the active npm user config (e.g. ~/.npmrc from npm login).");
      if (auth.npmUserConfigPath) {
        console.warn(`Active npm user config: ${auth.npmUserConfigPath}`);
      } else {
        console.warn("Active npm user config: default npm resolution (no explicit file selected).");
      }
    }

    runOrThrow("npm", ["publish", "--tag", tag, "--access", "public"], packageDir, auth.commandEnv);
  } catch (error) {
    await writeFile(packageJsonPath, originalPackageJsonText, "utf8");
    await cleanupTempNpmrc(auth.generatedTempUserConfigPath);
    throw error;
  }

  await cleanupTempNpmrc(auth.generatedTempUserConfigPath);

  if (json) {
    printJson({
      ok: true,
      target,
      package: packageJson.name,
      publishedVersion: nextVersion,
      tag,
      spec: nextSpec,
    });
  } else {
    console.log(`Published ${packageJson.name}@${nextVersion} with tag "${tag}".`);
  }

  return 0;
}
