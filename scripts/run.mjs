#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");

const STAGE_SCRIPTS = {
  init: "init.mjs",
  plan: "plan.mjs",
  do: "do.mjs",
  verify: "verify.mjs",
  archive: "archive.mjs"
};

function usageText() {
  return `Usage:
  node scripts/run.mjs init init-project < input.json
  node scripts/run.mjs plan create-task < input.json
  node scripts/run.mjs do inspect
  node scripts/run.mjs do materialize < input.json
  node scripts/run.mjs do update-task < input.json
  node scripts/run.mjs verify complete < input.json
  node scripts/run.mjs archive archive < input.json

scripts/run.mjs resolves my-cc-lite stage scripts from the plugin root and
keeps the current working directory as the target project root.
`;
}

function errorPayload(code, message) {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

function writeError(code, message) {
  process.stdout.write(`${JSON.stringify(errorPayload(code, message), null, 2)}\n`);
  process.exitCode = 1;
}

const [, , stage, ...stageArgs] = process.argv;

if (!stage || stage === "--help" || stage === "-h") {
  process.stdout.write(usageText());
  process.exit(0);
}

const scriptName = STAGE_SCRIPTS[stage];
if (!scriptName) {
  writeError("INVALID_INPUT", `Expected stage: ${Object.keys(STAGE_SCRIPTS).join(", ")}.`);
} else {
  const scriptPath = path.join(pluginRoot, "scripts", scriptName);
  if (!existsSync(scriptPath)) {
    writeError("INVALID_PROJECT_STATE", `Stage script not found: ${scriptName}.`);
  } else {
    const result = spawnSync(process.execPath, [scriptPath, ...stageArgs], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    if (result.error) {
      writeError("INVALID_PROJECT_STATE", result.error.message);
    } else if (result.signal) {
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 0;
    }
  }
}
