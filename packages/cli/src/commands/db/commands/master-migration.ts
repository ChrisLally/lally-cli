import { resolve } from "node:path";
import { ensureFile } from "../shared/app";

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
