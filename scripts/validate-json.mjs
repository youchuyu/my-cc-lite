#!/usr/bin/env node
import fs from "node:fs/promises";

const files = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "hooks/hooks.json"
];

for (const file of files) {
  try {
    JSON.parse(await fs.readFile(file, "utf8"));
    process.stdout.write(`${file}\n`);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}
