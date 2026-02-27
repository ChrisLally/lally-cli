import { LallyConfig, SyncTarget } from "./config";

/**
 * @description Return the sync config section or throw when sync.targets is missing.
 */
export function getSyncSection(config: LallyConfig) {
  if (!config.sync?.targets) {
    throw new Error("Missing `sync.targets` in lally.config.json.");
  }

  return config.sync;
}

/**
 * @description Resolve a named sync target from config or throw if unknown.
 */
export function resolveTarget(sync: NonNullable<LallyConfig["sync"]>, targetName: string): SyncTarget {
  const target = sync.targets?.[targetName];
  if (!target) {
    throw new Error(`Unknown sync target: ${targetName}`);
  }

  return target;
}

/**
 * @description Resolve effective branch for a sync target with default main.
 */
export function getBranch(target: SyncTarget): string {
  return target.branch ?? "main";
}

/**
 * @description Provide commit author identity used by automated sync snapshot commits.
 */
export function getSyncAuthor() {
  return {
    name: "Chris Lally",
    email: "24978693+ChrisLally@users.noreply.github.com",
  };
}
