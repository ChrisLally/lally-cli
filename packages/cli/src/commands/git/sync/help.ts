/**
 * @description Build help text for the sync command namespace.
 */
export function syncHelp(): string {
  return [
    "Usage:",
    "  lally git sync init --target <name> --prefix <path> --remote <url> [--branch <name>] [--mode snapshot|history]",
    "  lally git sync doctor --target <name> [--json]",
    "  lally git sync push --target <name> [--tag <tag-name|alpha>] [--commit <message>] [--dry-run] [--json]",
    "  lally git sync pull --target <name> [--dry-run] [--json]",
    "",
    "Config:",
    "  - requires lally.config.json sync.targets (no legacy fallback)",
    "  - sync push defaults to --tag alpha for snapshot targets",
    "",
    "Examples:",
    "  lally git sync init --target statements --prefix examples/fide-statements-template --remote https://github.com/chrislally/fide-statements-template.git --mode snapshot",
    "  lally git sync doctor --target statements",
    "  lally git sync push --target statements",
    "  lally git sync push --target cli --tag cli-v0.1.0-alpha.2",
    "  lally git sync push --target cli --tag alpha",
    "  lally git sync push --target cli --tag alpha --commit \"chore: prep cli release\"",
    "  lally git sync pull --target statements --dry-run",
  ].join("\n");
}
