#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "./lib/format.mjs";
import {
  assertArchivableTask,
  assertInitializedProject,
  normalizeArchiveInput,
  StateError,
  summarizeVerification
} from "./lib/schema.mjs";
import {
  archiveTaskDir,
  getArchivedTaskDir,
  getCurrentTaskDir,
  readPlan,
  readProject,
  readTask,
  withStateLock,
  writeTask
} from "./lib/state.mjs";

async function main(argv) {
  const command = argv[2];
  if (command !== "archive") {
    throw new StateError("INVALID_INPUT", "Expected command: archive.");
  }
  const input = normalizeArchiveInput(await readStdinJson());
  const projectRoot = process.cwd();
  assertInitializedProject(await readProject(projectRoot));
  return await withStateLock(
    projectRoot,
    async () => {
      assertInitializedProject(await readProject(projectRoot));
      const taskDir = await requireCurrentTaskDir(projectRoot);
      const taskId = path.basename(taskDir);
      const planPath = path.join(taskDir, "plan.md");
      await readPlan(taskDir);
      const task = await readTask(taskDir);
      if (!task) {
        throw new StateError("TASK_STATE_NOT_FOUND", "Current task is missing task.json. Run /do before /archive.");
      }
      if (task.taskId !== taskId) {
        throw new StateError("INVALID_TASK_STATE", "task.json taskId does not match current task directory.");
      }
      assertArchivableTask(task);
      const archivedDir = getArchivedTaskDir(projectRoot, task.taskId);
      const archivedTaskPath = path.join(archivedDir, "task.json");
      const archivedPlanPath = path.join(archivedDir, "plan.md");
      await assertArchiveTargetMissing(archivedDir, task.taskId);
      applyArchiveResult(task, input);
      await writeTask(taskDir, task);
      await archiveTaskDir(projectRoot, task.taskId);
      return {
        taskId: task.taskId,
        archivedDir,
        taskPath: archivedTaskPath,
        planPath: archivedPlanPath,
        status: task.status,
        stage: task.stage,
        verification: summarizeVerification(task),
        archive: task.archive
      };
    },
    { operation: "archive-task" }
  );
}

async function requireCurrentTaskDir(projectRoot) {
  const taskDir = await getCurrentTaskDir(projectRoot);
  if (!taskDir) {
    throw new StateError("NO_ACTIVE_TASK", "No active task exists. Run /plan before /archive.");
  }
  return taskDir;
}

async function assertArchiveTargetMissing(archivedDir, taskId) {
  try {
    await access(archivedDir);
    throw new StateError("ARCHIVE_TARGET_EXISTS", `Archived task directory already exists: ${taskId}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function applyArchiveResult(task, input) {
  const now = nowIso();
  task.status = "archived";
  task.stage = "archived";
  task.updatedAt = now;
  task.archive = {
    summary: input.summary,
    archivedAt: now
  };
}

async function readStdinJson() {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    throw new StateError("INVALID_INPUT", "stdin must contain archive JSON input.");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new StateError("INVALID_INPUT", "stdin must contain valid JSON.");
  }
}

function archiveHelpText() {
  return `Usage: node scripts/archive.mjs archive < input.json

Archive the unique active my-cc-lite task.

Commands:
  archive    Write task.json archive fields and move the task to archived_tasks

Input JSON:
  {
    "summary": "Short archive summary"
  }
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
    process.stdout.write(archiveHelpText());
  } else {
    const result = await main(process.argv);
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
