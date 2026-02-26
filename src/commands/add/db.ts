import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureFile, ensureJsonFile, loadJson } from "./shared";

export async function addDbLocalPostgres(appRoot: string) {
  const createScriptPath = resolve(appRoot, "db/scripts/create-local-db.sh");
  const createScript = `#!/usr/bin/env bash
set -euo pipefail

if [ -z "\${DATABASE_URL:-}" ]; then
  echo "Missing DATABASE_URL"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required"
  exit 1
fi

DB_NAME=$(echo "$DATABASE_URL" | sed -E 's#^.*/([^/?]+).*$#\\1#')
if [ -z "$DB_NAME" ]; then
  echo "Could not parse database name from DATABASE_URL"
  exit 1
fi

if psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; then
  echo "Database already exists and is reachable: $DB_NAME"
  exit 0
fi

BASE_URL=$(echo "$DATABASE_URL" | sed -E 's#/(.+)$##')
psql "$BASE_URL/postgres" -c "CREATE DATABASE \"$DB_NAME\";" || true

echo "Ensured database exists: $DB_NAME"
`;

  const scriptResult = await ensureFile(createScriptPath, createScript);
  if (scriptResult === "created") {
    await writeFile(createScriptPath, createScript, { mode: 0o755 });
  }

  const packageJsonPath = resolve(appRoot, "package.json");
  const packageJson = await loadJson<Record<string, unknown>>(packageJsonPath);
  if (packageJson) {
    const scripts = (packageJson.scripts as Record<string, string> | undefined) ?? {};
    scripts["db:create:local"] = scripts["db:create:local"] ?? "dotenv -e .env -- bash ./db/scripts/create-local-db.sh";
    scripts["db:migrate:local"] =
      scripts["db:migrate:local"] ??
      "dotenv -e .env -- sh -c 'psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f db/migrations/tables.sql'";
    scripts["db:reset:local"] =
      scripts["db:reset:local"] ??
      "dotenv -e .env -- sh -c 'psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -c \"DROP SCHEMA public CASCADE; CREATE SCHEMA public;\"' && pnpm run db:migrate:local";
    scripts["db:setup:local"] = scripts["db:setup:local"] ?? "pnpm run db:create:local && pnpm run db:migrate:local";

    packageJson.scripts = scripts;

    const devDependencies = (packageJson.devDependencies as Record<string, string> | undefined) ?? {};
    if (!devDependencies["dotenv-cli"]) devDependencies["dotenv-cli"] = "^11.0.0";
    packageJson.devDependencies = devDependencies;

    await ensureJsonFile(packageJsonPath, packageJson);
    console.log("Updated package.json DB scripts (local postgres)");
  }
}

export async function addDbMasterMigration(appRoot: string) {
  const tablesPath = resolve(appRoot, "db/migrations/tables.sql");
  const content = `-- ============================================================================
-- MASTER TABLE MIGRATION
-- Update this file in place as schema evolves; rely on git history for changes.
-- ============================================================================

set search_path to public;
create extension if not exists pgcrypto;

-- Add your tables below.
`;

  const result = await ensureFile(tablesPath, content);
  console.log(result === "created" ? `Created ${tablesPath}` : `Skipped ${tablesPath} (already exists)`);
}

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
      scripts["db:setup-and-seed:local"] ?? "pnpm run db:setup:local && pnpm run db:seed:local";
    packageJson.scripts = scripts;

    const devDependencies = (packageJson.devDependencies as Record<string, string> | undefined) ?? {};
    if (!devDependencies["dotenv-cli"]) devDependencies["dotenv-cli"] = "^11.0.0";
    packageJson.devDependencies = devDependencies;

    await ensureJsonFile(packageJsonPath, packageJson);
    console.log("Updated package.json seed scripts");
  }
}
