export function updateHelp(): string {
  return [
    "Usage:",
    "  lally update subtree --script <script-name> [--dir <path>] [--json]",
    "  lally update subtree --target <name> --action <push|pull> [--dir <path>] [--json]",
    "  lally update layout --preset notebook-topnav [--app <path>]",
    "  lally update readme [--target <name>] [--check] [--print]",
    "",
    "Notes:",
    "  - subtree uses update.subtree config in lally.config.json",
    "  - project.subtree is still supported as a fallback",
    "  - readme uses readme.targets config in lally.config.json",
    "  - readme auto-discovers top-level commands from <bin> --help",
    "",
    "Examples:",
    "  lally update subtree --script sync-push.sh",
    "  lally update subtree --target statements --action push",
    "  lally update layout --preset notebook-topnav --app apps/web",
    "  lally update readme --target cli",
    "  lally update readme --target cli --check",
  ].join("\n");
}
