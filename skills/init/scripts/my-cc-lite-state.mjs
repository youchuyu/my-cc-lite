#!/usr/bin/env node
import { cli } from "../../../scripts/my-cc-lite-state.mjs";

cli(process.argv).catch((error) => {
  process.stderr.write(`my-cc-lite: ${error.message}\n`);
  process.exitCode = 1;
});
