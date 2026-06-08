#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { nowIso } from "./lib/format.mjs";
import {
  assertInitializedProject,
  assertVerifiableTask,
  normalizeVerifyCompleteInput,
  StateError,
  summarizeTask,
  summarizeVerification
} from "./lib/schema.mjs";
import { getCurrentTaskDir, readPlan, readProject, readTask, withStateLock, writeTask } from "./lib/state.mjs";

async function main(argv) {
  const command = argv[2];
  if (command !== "complete") {
    throw new StateError("INVALID_INPUT", "Expected command: complete.");
  }
  const input = normalizeVerifyCompleteInput(await readStdinJson());
  const projectRoot = process.cwd();
  assertInitializedProject(await readProject(projectRoot));
  return await withStateLock(
    projectRoot,
    async () => {
      assertInitializedProject(await readProject(projectRoot));
      const taskDir = await requireCurrentTaskDir(projectRoot);
      const planPath = path.join(taskDir, "plan.md");
      await readPlan(taskDir);
      const task = await readTask(taskDir);
      if (!task) {
        throw new StateError("TASK_STATE_NOT_FOUND", "Current task is missing task.json. Run /do before /verify.");
      }
      assertVerifiableTask(task);
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
        tasks: task.tasks.map(summarizeTask)
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
    const repairTasks = buildRepairTasks(task.tasks, input.repairTasks);
    task.tasks.push(...repairTasks);
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

function buildRepairTasks(existingTasks, repairInputs) {
  const usedIds = new Set(existingTasks.map((task) => task.id));
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
  return `Usage: node scripts/verify.mjs complete < input.json

Write the final /verify result to the unique active task's task.json.

Commands:
  complete    Read JSON from stdin and write passed, needs_fix, or blocked

Input JSON:
  {
    "status": "passed | needs_fix | blocked",
    "summary": "Short verification result summary",
    "repairTasks": [
      {
        "title": "Fix verification issue",
        "steps": ["Do the bounded repair"],
        "checks": ["The original plan.md acceptance criteria are satisfied"]
      }
    ]
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
    process.stdout.write(verifyHelpText());
  } else {
    const result = await main(process.argv);
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
  process.exitCode = 1;
}
