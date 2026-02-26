export function syncHelp(): string {
  return [
    "Usage:",
    "  lally sync init --target <name> --prefix <path> --remote <url> [--branch <name>] [--mode snapshot|history]",
    "  lally sync doctor --target <name> [--json]",
    "  lally sync push --target <name> [--dry-run] [--json]",
    "  lally sync pull --target <name> [--dry-run] [--json]",
    "",
    "Config:",
    "  - requires lally.config.json sync.targets (no legacy fallback)",
    "",
    "Examples:",
    "  lally sync init --target statements --prefix examples/fide-statements-template --remote https://github.com/chrislally/fide-statements-template.git --mode snapshot",
    "  lally sync doctor --target statements",
    "  lally sync push --target statements",
    "  lally sync pull --target statements --dry-run",
  ].join("\n");
}
