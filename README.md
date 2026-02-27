# lally-cli

Monorepo for the next-generation `lally` CLI.

## Structure

- `packages/cli`: main `lally` binary package (scaffolded)

## Quick start

```bash
pnpm install
pnpm --filter @chris-lally/cli run dev -- --help
```

## Notes

- Existing CLI implementation remains in `/Users/chrislally/Desktop/chrislally/packages/cli` for now.
- This repo is the new domain-first CLI surface (`opensrc`, `fumadocs`, `db`, `sync`, `release`).
