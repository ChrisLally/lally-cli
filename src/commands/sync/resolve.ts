import { LallyConfig, SyncTarget } from "./config";

export function getSyncSection(config: LallyConfig) {
  if (!config.sync?.targets) {
    throw new Error("Missing `sync.targets` in lally.config.json.");
  }

  return config.sync;
}

export function resolveTarget(sync: NonNullable<LallyConfig["sync"]>, targetName: string): SyncTarget {
  const target = sync.targets?.[targetName];
  if (!target) {
    throw new Error(`Unknown sync target: ${targetName}`);
  }

  return target;
}

export function getBranch(target: SyncTarget): string {
  return target.branch ?? "main";
}

export function getSyncAuthor() {
  return {
    name: "Chris Lally",
    email: "24978693+ChrisLally@users.noreply.github.com",
  };
}
