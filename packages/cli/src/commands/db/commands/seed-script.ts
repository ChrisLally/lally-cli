import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureFile, ensureJsonFile, loadJson } from "../shared/app";

export async function addDbSeedScript(appRoot: string) {
  const seedPath = resolve(appRoot, "db/scripts/seed-local.sh");
  const seed = `#!/usr/bin/env bash
set -euo pipefail

if [ -z "\${DATABASE_URL:-}" ]; then
  echo "Missing DATABASE_URL"
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
set search_path to public;

-- Add seed rows here. Keep idempotent where possible.
SQL

echo "Seed complete"
`;

  const result = await ensureFile(seedPath, seed);
  if (result === "created") {
    await writeFile(seedPath, seed, { mode: 0o755 });
  }

  const packageJsonPath = resolve(appRoot, "package.json");
  const packageJson = await loadJson<Record<string, unknown>>(packageJsonPath);
  if (packageJson) {
    const scripts = (packageJson.scripts as Record<string, string> | undefined) ?? {};
    scripts["db:seed:local"] = scripts["db:seed:local"] ?? "dotenv -e .env -- bash ./db/scripts/seed-local.sh";
    scripts["db:setup-and-seed:local"] =
      scripts["db:setup-and-seed:local"] ?? "npm run db:setup:local && npm run db:seed:local";
    packageJson.scripts = scripts;

    const devDependencies = (packageJson.devDependencies as Record<string, string> | undefined) ?? {};
    if (!devDependencies["dotenv-cli"]) devDependencies["dotenv-cli"] = "^11.0.0";
    packageJson.devDependencies = devDependencies;

    await ensureJsonFile(packageJsonPath, packageJson);
    console.log("Updated package.json seed scripts");
  }
}
