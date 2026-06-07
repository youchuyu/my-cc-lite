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
