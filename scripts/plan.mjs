#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createTaskId } from "./lib/format.mjs";
import { assertInitializedProject, assertNoActiveTask, normalizePlanInput, StateError } from "./lib/schema.mjs";
import {
  createTaskDir,
  listActiveTaskDirs,
  readProject,
  statePaths,
  withStateLock,
  writePlan
} from "./lib/state.mjs";

async function main(argv) {
  const command = argv[2];
  if (command !== "create-task") {
    throw new StateError("INVALID_INPUT", "Expected command: create-task.");
  }
  const input = normalizePlanInput(await readStdinJson());
  const projectRoot = process.cwd();
  return await withStateLock(
    projectRoot,
    async () => {
      assertInitializedProject(await readProject(projectRoot));
      assertNoActiveTask(await listActiveTaskDirs(projectRoot));
      const taskId = await createUniqueTaskId(projectRoot, input.objective);
      const taskDir = await createTaskDir(projectRoot, taskId);
      const planPath = await writePlan(taskDir, input.planMarkdown);
      return {
        taskId,
        taskDir,
        planPath
      };
    },
    { operation: "create-task" }
  );
}

function planHelpText() {
  return `Usage: node scripts/plan.mjs create-task < input.json

Create a my-cc-lite task directory and write plan.md in the current project.

Commands:
  create-task    Read JSON from stdin and create .my-cc-lite/tasks/<taskId>/plan.md

Input JSON:
  {
    "objective": "User objective",
    "planMarkdown": "# Task: ...\\n\\n## Objective\\n...\\n\\n## Plan\\n..."
  }

Required planMarkdown sections:
  ## Objective
  ## Plan
`;
}

async function createUniqueTaskId(projectRoot, objective) {
  const { tasksRoot } = statePaths(projectRoot);
  const existing = new Set((await listActiveTaskDirs(projectRoot)).map((taskDir) => taskDir.slice(tasksRoot.length + 1)));
  const baseTaskId = createTaskId(objective);
  if (!existing.has(baseTaskId)) return baseTaskId;
  for (let index = 2; index <= 9; index += 1) {
    const candidate = `${baseTaskId}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new StateError("TASK_ID_COLLISION", `Could not create a unique taskId from objective: ${objective}.`);
}

async function readStdinJson() {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    throw new StateError("INVALID_INPUT", "stdin must contain create-task JSON input.");
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
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(planHelpText());
  } else {
    const result = await main(process.argv);
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
