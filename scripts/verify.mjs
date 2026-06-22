#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { nowIso } from "./lib/format.mjs";
import {
  normalizeVerifyCompleteInput,
  normalizeVerifyAppendRepairsInput,
  StateError,
  summarizeSubtask,
  summarizeVerification
} from "./lib/schema.mjs";
import { getCurrentTaskDir, readTask, withStateLock, writeTask } from "./lib/state.mjs";

async function main(argv) {
  const command = argv[2];
  if (command !== "complete" && command !== "append-repairs") {
    throw new StateError("INVALID_INPUT", "Expected command: complete or append-repairs.");
  }
  const projectRoot = process.cwd();
  if (command === "append-repairs") {
    const input = normalizeVerifyAppendRepairsInput(await readStdinJson());
    return await withStateLock(
      projectRoot,
      async () => {
        const taskDir = await requireCurrentTaskDir(projectRoot);
        const task = await readTask(taskDir);
        if (!task) {
          throw new StateError("TASK_STATE_NOT_FOUND", "Current task is missing task.json. Run /do before /verify.");
        }
        const repairTasks = buildRepairTasks(task.subtasks, input.repairTasks);
        task.subtasks.push(...repairTasks);
        task.updatedAt = nowIso();
        const taskPath = await writeTask(taskDir, task);
        return {
          taskId: task.taskId,
          appended: repairTasks.map((t) => ({ id: t.id, title: t.title })),
          taskPath
        };
      },
      { operation: "verify-append-repairs" }
    );
  }
  const input = normalizeVerifyCompleteInput(await readStdinJson());
  return await withStateLock(
    projectRoot,
    async () => {
      const taskDir = await requireCurrentTaskDir(projectRoot);
      const planPath = path.join(taskDir, "plan.md");
      const task = await readTask(taskDir);
      if (!task) {
        throw new StateError("TASK_STATE_NOT_FOUND", "Current task is missing task.json. Run /do before /verify.");
      }
      applyVerificationResult(task, input);
      const taskPath = await writeTask(taskDir, task);
      return {
        taskId: task.taskId,
        taskDir,
        taskPath,
        planPath,
        status: task.status,
        stage: task.stage,
        verification: summarizeVerification(task),
        subtasks: task.subtasks.map(summarizeSubtask)
      };
    },
    { operation: "verify-complete" }
  );
}

async function requireCurrentTaskDir(projectRoot) {
  const taskDir = await getCurrentTaskDir(projectRoot);
  if (!taskDir) {
    throw new StateError("NO_ACTIVE_TASK", "No active task exists. Run /plan before /verify.");
  }
  return taskDir;
}

function applyVerificationResult(task, input) {
  const now = nowIso();
  if (input.status === "passed") {
    task.status = "verified";
    task.stage = "verified";
    task.verification = {
      status: "passed",
      summary: input.summary
    };
  } else if (input.status === "needs_fix") {
    task.status = "active";
    task.stage = "executing";
    task.verification = {
      status: "needs_fix",
      summary: input.summary
    };
  } else if (input.status === "blocked") {
    task.status = "blocked";
    task.stage = "verifying";
    task.verification = {
      status: "blocked",
      summary: input.summary
    };
  } else {
    throw new StateError("INVALID_INPUT", `Unsupported verify status: ${input.status}.`);
  }
  task.updatedAt = now;
}

function buildRepairTasks(existingSubtasks, repairInputs) {
  const usedIds = new Set(existingSubtasks.map((subtask) => subtask.id));
  let nextRepairNumber = nextRepairIndex(usedIds);
  return repairInputs.map((entry) => {
    const id = nextRepairId(usedIds, nextRepairNumber);
    nextRepairNumber = Number(id.slice(1)) + 1;
    usedIds.add(id);
    return {
      id,
      title: entry.title,
      status: "pending",
      steps: entry.steps,
      checks: entry.checks,
      statusReason: ""
    };
  });
}

function nextRepairIndex(usedIds) {
  let max = 0;
  for (const id of usedIds) {
    const match = /^R([1-9]\d*)$/.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max + 1;
}

function nextRepairId(usedIds, start) {
  for (let index = start; index < start + 1000; index += 1) {
    const candidate = `R${index}`;
    if (!usedIds.has(candidate)) return candidate;
  }
  throw new StateError("INVALID_TASK_STATE", "Could not allocate a repair task id.");
}

async function readStdinJson() {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    throw new StateError("INVALID_INPUT", "stdin must contain complete JSON input.");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new StateError("INVALID_INPUT", "stdin must contain valid JSON.");
  }
}

function verifyHelpText() {
  return `Usage: node scripts/verify.mjs <command> < input.json

Commands:
  append-repairs  Append repair tasks to the active task's subtasks[].
                  Input: { "repairTasks": [{ "title", "steps", "checks" }] }

  complete        Write the final verification result to task.json.
                  Input: { "status": "passed | needs_fix | blocked", "summary": "..." }
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
    process.stdout.write(verifyHelpText());
  } else {
    const result = await main(process.argv);
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
