import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type CleanCandidate = {
  relativePath: string;
  reason: string;
};

const FUMADOCS_BASE_CANDIDATES: CleanCandidate[] = [
  { relativePath: "content/docs", reason: "Default docs content root from template" },
  { relativePath: "src/app/docs", reason: "Default docs route tree from template" },
];

export function collectFumadocsCandidates(appRoot: string): CleanCandidate[] {
  return FUMADOCS_BASE_CANDIDATES.filter((candidate) => existsSync(resolve(appRoot, candidate.relativePath)));
}
