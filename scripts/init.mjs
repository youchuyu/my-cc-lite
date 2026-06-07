#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { nowIso } from "./lib/format.mjs";
import { normalizeInitInput, StateError, validateProject } from "./lib/schema.mjs";
import { ensureStateRoot, readProject, statePaths, withStateLock, writeProject } from "./lib/state.mjs";

async function main(argv) {
  const command = argv[2];
  if (command !== "init-project") {
    throw new StateError("INVALID_INPUT", "Expected command: init-project.");
  }
  const input = normalizeInitInput(await readStdinJson());
  const projectRoot = process.cwd();
  await ensureStateRoot(projectRoot);
  const project = await withStateLock(projectRoot, async () => {
    const oldProject = await readProject(projectRoot);
    const now = nowIso();
    const nextProject = {
      initializedAt: oldProject?.initializedAt || now,
      updatedAt: now,
      projectRoot: statePaths(projectRoot).projectRoot,
      projectSummary: input.projectSummary,
      stageHelpers: input.stageHelpers
    };
    validateProject(nextProject);
    await writeProject(projectRoot, nextProject);
    return nextProject;
  });
  return {
    project,
    projectPath: statePaths(projectRoot).projectPath
  };
}

async function readStdinJson() {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    throw new StateError("INVALID_INPUT", "stdin must contain init-project JSON input.");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new StateError("INVALID_INPUT", "stdin must contain valid JSON.");
  }
}

function errorPayload(error) {
  if (error instanceof StateError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "INVALID_PROJECT_STATE",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

try {
  const result = await main(process.argv);
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
