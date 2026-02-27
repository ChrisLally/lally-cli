import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/lally": "src/bin/lally.ts",
  },
  format: ["cjs"],
  platform: "node",
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  noExternal: [
    "@chris-lally/cli-fumadocs",
    "@chris-lally/cli-git",
    "@chris-lally/cli-opensrc",
    "@chris-lally/cli-db",
    "@chris-lally/cli-repo",
    "@chris-lally/cli-npm",
  ],
});
