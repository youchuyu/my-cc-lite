#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { nowIso } from "./lib/format.mjs";
import {
  assertInitializedProject,
  normalizeDoMaterializeInput,
  normalizeDoTaskPatch,
  StateError,
  summarizeTask
} from "./lib/schema.mjs";
import { getCurrentTaskDir, readPlan, readProject, readTask, withStateLock, writeTask } from "./lib/state.mjs";

async function main(argv) {
  const command = argv[2];
  if (command === "materialize") {
    return await materialize();
  }
  if (command === "update-task") {
    return await updateTask();
  }
  throw new StateError("INVALID_INPUT", "Expected command: materialize or update-task.");
}

async function materialize() {
  const input = normalizeDoMaterializeInput(await readStdinJson("materialize"));
  const projectRoot = process.cwd();
  assertInitializedProject(await readProject(projectRoot));
  return await withStateLock(
    projectRoot,
    async () => {
      assertInitializedProject(await readProject(projectRoot));
      const taskDir = await requireCurrentTaskDir(projectRoot);
      const planPath = path.join(taskDir, "plan.md");
      await readPlan(taskDir);
      if (await readTask(taskDir)) {
        throw new StateError("TASK_ALREADY_MATERIALIZED", "Current task already has task.json.");
      }
      const now = nowIso();
      const task = {
        taskId: path.basename(taskDir),
        objective: input.objective,
        status: "active",
        stage: "executing",
        createdAt: now,
        updatedAt: now,
        tasks: input.tasks,
        verification: {
          status: "not_started",
          summary: ""
        },
        archive: {
          summary: "",
          archivedAt: null
        }
      };
      const taskPath = await writeTask(taskDir, task);
      return {
        taskId: task.taskId,
        taskDir,
        taskPath,
        planPath,
        tasks: task.tasks.map(summarizeTask)
      };
    },
    { operation: "do-materialize" }
  );
}

async function updateTask() {
  const input = normalizeDoTaskPatch(await readStdinJson("update-task"));
  const projectRoot = process.cwd();
  assertInitializedProject(await readProject(projectRoot));
  return await withStateLock(
    projectRoot,
    async () => {
      assertInitializedProject(await readProject(projectRoot));
      const taskDir = await requireCurrentTaskDir(projectRoot);
      const task = await readTask(taskDir);
      if (!task) {
        throw new StateError("TASK_STATE_NOT_FOUND", "Current task is missing task.json.");
      }
      const entry = task.tasks.find((candidate) => candidate.id === input.id);
      if (!entry) {
        throw new StateError("TASK_NOT_FOUND", `Task not found: ${input.id}.`);
      }
      entry.status = input.status;
      entry.statusReason = input.statusReason;
      task.status = summarizeTopLevelStatus(task.tasks);
      task.stage = "executing";
      task.updatedAt = nowIso();
      const taskPath = await writeTask(taskDir, task);
      return {
        taskId: task.taskId,
        taskDir,
        taskPath,
        status: task.status,
        stage: task.stage,
        task: summarizeTask(entry),
        tasks: task.tasks.map(summarizeTask)
      };
    },
    { operation: "do-update-task" }
  );
}

async function requireCurrentTaskDir(projectRoot) {
  const taskDir = await getCurrentTaskDir(projectRoot);
  if (!taskDir) {
    throw new StateError("NO_ACTIVE_TASK", "No active task exists. Run /plan before /do.");
  }
  return taskDir;
}

function summarizeTopLevelStatus(tasks) {
  if (tasks.some((task) => task.status === "pending" || task.status === "in_progress")) {
    return "active";
  }
  if (tasks.every((task) => task.status === "completed" || task.status === "skipped")) {
    return "active";
  }
  return "blocked";
}

async function readStdinJson(command) {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    throw new StateError("INVALID_INPUT", `stdin must contain ${command} JSON input.`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new StateError("INVALID_INPUT", "stdin must contain valid JSON.");
  }
}

function doHelpText() {
  return `Usage:
  node scripts/do.mjs materialize < input.json
  node scripts/do.mjs update-task < input.json

Commands:
  materialize    Create task.json for the unique active task
  update-task    Update one task entry status in task.json
`;
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
    process.stdout.write(doHelpText());
  } else {
    const result = await main(process.argv);
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
