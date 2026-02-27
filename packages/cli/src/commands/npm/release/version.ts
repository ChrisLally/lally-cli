export function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`Unsupported semver format: ${version}`);

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

export function nextTaggedVersion(currentVersion: string, tag: string): string {
  const parsed = parseSemver(currentVersion);

  if (parsed.prerelease && parsed.prerelease.startsWith(`${tag}.`)) {
    const n = Number(parsed.prerelease.slice(tag.length + 1));
    if (Number.isInteger(n) && n >= 0) {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}-${tag}.${n + 1}`;
    }
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${tag}.0`;
}
