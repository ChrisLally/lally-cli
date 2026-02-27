#!/usr/bin/env node

import { runCli } from "../main";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error("Unexpected CLI error");
  console.error(error);
  process.exit(1);
});
