#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const initScript = path.join(pluginRoot, "scripts", "init.mjs");
const planScript = path.join(pluginRoot, "scripts", "plan.mjs");
const doScript = path.join(pluginRoot, "scripts", "do.mjs");
const targetDir = await mkdtemp(path.join(os.tmpdir(), "my-cc-lite-init-smoke-"));
const targetRoot = await realpath(targetDir);

function runInit(input) {
  const result = spawnSync(process.execPath, [initScript, "init-project"], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`init-project failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runInitFail(input) {
  const result = spawnSync(process.execPath, [initScript, "init-project"], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, "init-project unexpectedly passed");
  assert.equal(payload.ok, false);
  return payload.error;
}

function runPlan(input) {
  const result = spawnSync(process.execPath, [planScript, "create-task"], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`create-task failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runPlanFail(input) {
  const result = spawnSync(process.execPath, [planScript, "create-task"], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, "create-task unexpectedly passed");
  assert.equal(payload.ok, false);
  return payload.error;
}

function runDo(command, input) {
  const result = spawnSync(process.execPath, [doScript, command], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runDoFail(command, input) {
  const result = spawnSync(process.execPath, [doScript, command], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, `${command} unexpectedly passed`);
  assert.equal(payload.ok, false);
  return payload.error;
}

function parseOutput(output) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`script output was not JSON:\n${output}\n${error.message}`);
  }
}

async function readProject() {
  return JSON.parse(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  const uninitializedDoError = runDoFail(
    "materialize",
    JSON.stringify({
      objective: "Materialize before init",
      tasks: [
        {
          id: "T1",
          title: "Should fail before init",
          steps: [],
          checks: []
        }
      ]
    })
  );
  assert.equal(uninitializedDoError.code, "PROJECT_NOT_INITIALIZED");

  const uninitializedPlanError = runPlanFail(
    JSON.stringify({
      objective: "Create a plan before init",
      planMarkdown: "# Task: pending\n\n## Objective\n\nCreate a plan before init.\n\n## Plan\n\n1. Try plan creation."
    })
  );
  assert.equal(uninitializedPlanError.code, "PROJECT_NOT_INITIALIZED");
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "project.json")), false);

  const first = runInit(
    JSON.stringify({
      projectSummary: "First summary.",
      stageHelpers: {
        planning: [],
        execution: [],
        review: []
      }
    })
  );
  assert.equal(first.project.projectSummary, "First summary.");
  assert.equal(first.project.projectRoot, targetRoot);
  assert.equal(first.projectPath, path.join(targetRoot, ".my-cc-lite", "project.json"));
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "project.json")), true);
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "tasks")), false);

  await wait(20);
  const second = runInit(
    JSON.stringify({
      projectSummary: "Second summary.",
      stageHelpers: {
        planning: [
          {
            name: "Bash",
            type: "tool",
            invoke: "Bash",
            description: "Native shell"
          },
          {
            name: "Plan",
            type: "agent",
            invoke: "Plan",
            description: "Native plan mode"
          },
          {
            name: "my-cc-lite:plan",
            type: "skill",
            invoke: "my-cc-lite:plan",
            description: "Native my-cc-lite plan skill"
          },
          {
            name: "codegraph_context",
            type: "tool",
            invoke: "mcp__codegraph.codegraph_context",
            description: "Collect code context before /plan drafts implementation tasks"
          },
          {
            name: "codegraph_context duplicate",
            type: "tool",
            invoke: "mcp__codegraph.codegraph_context",
            description: "Duplicate should be removed"
          }
        ],
        execution: [
          {
            name: "workspace-runner",
            type: "agent",
            invoke: "workspace-runner",
            description: "Execute domain-specific implementation tasks during /do"
          }
        ],
        review: [
          {
            name: "code-review",
            type: "skill",
            invoke: "code-review",
            description: "Review completed code changes before /verify marks the task passed"
          }
        ]
      }
    })
  );
  assert.equal(second.project.initializedAt, first.project.initializedAt);
  assert.notEqual(second.project.updatedAt, first.project.updatedAt);
  assert.equal(second.project.projectSummary, "Second summary.");
  assert.deepEqual(
    second.project.stageHelpers.planning.map((helper) => helper.invoke),
    ["mcp__codegraph.codegraph_context"]
  );
  assert.deepEqual(
    second.project.stageHelpers.execution.map((helper) => helper.invoke),
    ["workspace-runner"]
  );
  assert.deepEqual(
    second.project.stageHelpers.review.map((helper) => helper.invoke),
    ["code-review"]
  );

  const beforeMalformed = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  const malformedError = runInitFail("not json");
  assert.equal(malformedError.code, "INVALID_INPUT");
  const afterMalformed = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  assert.equal(afterMalformed, beforeMalformed);

  const invalidHelperError = runInitFail(
    JSON.stringify({
      projectSummary: "Invalid helper.",
      stageHelpers: {
        planning: [
          {
            name: "bad-helper",
            type: "helper",
            description: "Missing invoke and invalid type"
          }
        ],
        execution: [],
        review: []
      }
    })
  );
  assert.equal(invalidHelperError.code, "INVALID_INPUT");
  const afterInvalidHelper = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  assert.equal(afterInvalidHelper, beforeMalformed);

  const legacyKindError = runInitFail(
    JSON.stringify({
      projectSummary: "Legacy helper.",
      stageHelpers: {
        planning: [
          {
            name: "legacy-helper",
            kind: "tool",
            invoke: "legacy-helper",
            description: "Old helper shape should be rejected"
          }
        ],
        execution: [],
        review: []
      }
    })
  );
  assert.equal(legacyKindError.code, "INVALID_INPUT");
  const afterLegacyKind = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  assert.equal(afterLegacyKind, beforeMalformed);

  const project = await readProject();
  const helperTokens = Object.values(project.stageHelpers)
    .flat()
    .flatMap((helper) => [helper.name, helper.invoke]);
  for (const excludedName of ["Bash", "Plan", "my-cc-lite:plan"]) {
    assert.equal(helperTokens.includes(excludedName), false, `${excludedName} remained in stageHelpers`);
  }
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "tasks")), false);

  const noActiveTaskError = runDoFail(
    "materialize",
    JSON.stringify({
      objective: "Materialize without active task",
      tasks: [
        {
          id: "T1",
          title: "Should fail without active task",
          steps: [],
          checks: []
        }
      ]
    })
  );
  assert.equal(noActiveTaskError.code, "NO_ACTIVE_TASK");

  const beforePlanProject = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  const planMarkdown = [
    "# Task: pending",
    "",
    "## Objective",
    "",
    "Create a plan-stage smoke task.",
    "",
    "## Scope",
    "",
    "Only verify plan state writes.",
    "",
    "## Plan",
    "",
    "1. Create the plan artifact",
    "   - Goal: Confirm /plan can create plan.md.",
    "   - Do: Run create-task with a valid planMarkdown.",
    "   - Check: plan.md exists and task.json does not.",
    "",
    "## Notes",
    "",
    "Smoke fixture."
  ].join("\n");
  const plan = runPlan(
    JSON.stringify({
      objective: "Create a plan-stage smoke task",
      planMarkdown
    })
  );
  assert.match(plan.taskId, /^\d{8}-\d{6}-create-a-plan-stage-smoke-task$/);
  assert.equal(plan.taskDir, path.join(targetRoot, ".my-cc-lite", "tasks", plan.taskId));
  assert.equal(plan.planPath, path.join(plan.taskDir, "plan.md"));
  assert.equal(await readFile(plan.planPath, "utf8"), `${planMarkdown}\n`);
  assert.equal(existsSync(path.join(plan.taskDir, "task.json")), false);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforePlanProject);

  const beforeDoPlan = await readFile(plan.planPath, "utf8");
  const beforeDoProject = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  const materialized = runDo(
    "materialize",
    JSON.stringify({
      objective: "Create a plan-stage smoke task.",
      tasks: [
        {
          id: "T1",
          title: "Create the plan artifact",
          steps: [
            "Run create-task with a valid planMarkdown.",
            {
              title: "Inspect written files",
              steps: ["Read plan.md", "Confirm task.json is created only by /do"]
            }
          ],
          checks: ["plan.md exists", "task.json is created by materialize"],
          statusReason: ""
        },
        {
          id: "T2",
          title: "Complete the next execution task",
          steps: ["Continue with the next pending task after T1 completes"],
          checks: ["T2 can be completed by a second update-task call"]
        },
        {
          id: "T3",
          title: "Preserve project state",
          steps: ["Compare project.json before and after /do"],
          checks: ["project.json is unchanged by /do"]
        }
      ]
    })
  );
  assert.equal(materialized.taskId, plan.taskId);
  assert.equal(materialized.taskDir, plan.taskDir);
  assert.equal(materialized.taskPath, path.join(plan.taskDir, "task.json"));
  assert.equal(materialized.planPath, plan.planPath);
  assert.deepEqual(
    materialized.tasks.map((task) => [task.id, task.status]),
    [
      ["T1", "pending"],
      ["T2", "pending"],
      ["T3", "pending"]
    ]
  );
  const taskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  assert.equal(taskJson.taskId, plan.taskId);
  assert.equal(taskJson.objective, "Create a plan-stage smoke task.");
  assert.equal(taskJson.status, "active");
  assert.equal(taskJson.stage, "executing");
  assert.equal(taskJson.verification.status, "not_started");
  assert.equal(taskJson.verification.summary, "");
  assert.equal(taskJson.archive.summary, "");
  assert.equal(taskJson.archive.archivedAt, null);
  assert.equal(taskJson.tasks[0].steps[1].title, "Inspect written files");
  assert.equal(await readFile(plan.planPath, "utf8"), beforeDoPlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeDoProject);

  const materializeAgainError = runDoFail(
    "materialize",
    JSON.stringify({
      objective: "Create a plan-stage smoke task.",
      tasks: [
        {
          id: "T1",
          title: "Should not rematerialize",
          steps: [],
          checks: []
        }
      ]
    })
  );
  assert.equal(materializeAgainError.code, "TASK_ALREADY_MATERIALIZED");

  const missingReasonError = runDoFail(
    "update-task",
    JSON.stringify({
      id: "T1",
      status: "blocked"
    })
  );
  assert.equal(missingReasonError.code, "INVALID_INPUT");

  const inProgress = runDo(
    "update-task",
    JSON.stringify({
      id: "T1",
      status: "in_progress"
    })
  );
  assert.equal(inProgress.status, "active");
  assert.equal(inProgress.stage, "executing");
  assert.equal(inProgress.task.status, "in_progress");
  assert.equal(inProgress.task.statusReason, "");

  const completed = runDo(
    "update-task",
    JSON.stringify({
      id: "T1",
      status: "completed",
      statusReason: ""
    })
  );
  assert.equal(completed.status, "active");
  assert.equal(completed.task.status, "completed");
  assert.deepEqual(
    completed.tasks.map((task) => [task.id, task.status]),
    [
      ["T1", "completed"],
      ["T2", "pending"],
      ["T3", "pending"]
    ]
  );

  const nextInProgress = runDo(
    "update-task",
    JSON.stringify({
      id: "T2",
      status: "in_progress"
    })
  );
  assert.equal(nextInProgress.status, "active");
  assert.equal(nextInProgress.task.status, "in_progress");

  const nextCompleted = runDo(
    "update-task",
    JSON.stringify({
      id: "T2",
      status: "completed",
      statusReason: ""
    })
  );
  assert.equal(nextCompleted.status, "active");
  assert.deepEqual(
    nextCompleted.tasks.map((task) => [task.id, task.status]),
    [
      ["T1", "completed"],
      ["T2", "completed"],
      ["T3", "pending"]
    ]
  );

  const taskNotFoundError = runDoFail(
    "update-task",
    JSON.stringify({
      id: "T9",
      status: "completed"
    })
  );
  assert.equal(taskNotFoundError.code, "TASK_NOT_FOUND");

  const blocked = runDo(
    "update-task",
    JSON.stringify({
      id: "T3",
      status: "blocked",
      statusReason: "Waiting for user decision."
    })
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.task.statusReason, "Waiting for user decision.");

  const skipped = runDo(
    "update-task",
    JSON.stringify({
      id: "T3",
      status: "skipped",
      statusReason: "No longer needed for smoke."
    })
  );
  assert.equal(skipped.status, "active");
  assert.equal(skipped.task.status, "skipped");
  const afterDoTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  assert.equal(afterDoTaskJson.tasks[0].title, "Create the plan artifact");
  assert.deepEqual(afterDoTaskJson.tasks[0].checks, ["plan.md exists", "task.json is created by materialize"]);
  assert.equal(afterDoTaskJson.verification.status, "not_started");
  assert.equal(await readFile(plan.planPath, "utf8"), beforeDoPlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeDoProject);

  const activeTaskError = runPlanFail(
    JSON.stringify({
      objective: "Create a second active task",
      planMarkdown: "# Task: pending\n\n## Objective\n\nCreate another task.\n\n## Plan\n\n1. Should fail."
    })
  );
  assert.equal(activeTaskError.code, "ACTIVE_TASK_EXISTS");
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforePlanProject);

  await mkdir(path.join(targetDir, ".my-cc-lite", "tasks", "manual-extra-task"));
  const multipleActiveError = runPlanFail(
    JSON.stringify({
      objective: "Create a task with multiple active dirs",
      planMarkdown: "# Task: pending\n\n## Objective\n\nCreate with bad state.\n\n## Plan\n\n1. Should fail."
    })
  );
  assert.equal(multipleActiveError.code, "MULTIPLE_ACTIVE_TASKS");

  process.stdout.write(`smoke passed: ${targetDir}\n`);
} finally {
  await rm(targetDir, { recursive: true, force: true });
}
