#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runScript = path.join(pluginRoot, "scripts", "run.mjs");
const planScript = path.join(pluginRoot, "scripts", "plan.mjs");
const doAgentChainHook = path.join(pluginRoot, "scripts", "hooks", "do-agent-chain.mjs");
const stagePreflightHook = path.join(pluginRoot, "scripts", "hooks", "stage-preflight.mjs");
const stageContextHook = path.join(pluginRoot, "scripts", "hooks", "stage-context.mjs");
const targetDir = await mkdtemp(path.join(os.tmpdir(), "my-cc-lite-init-smoke-"));
const targetRoot = await realpath(targetDir);
const hookLogPath = path.join(targetDir, "my-cc-lite-hook.log");

function runStage(stage, command, input) {
  return spawnSync(process.execPath, [runScript, stage, command], {
    cwd: targetDir,
    input,
    encoding: "utf8"
  });
}

function runInit(input) {
  const result = runStage("init", "init-project", input);
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`init-project failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runInitFail(input) {
  const result = runStage("init", "init-project", input);
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, "init-project unexpectedly passed");
  assert.equal(payload.ok, false);
  return payload.error;
}

function runPlan(input) {
  const result = runStage("plan", "create-task", input);
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`create-task failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runPlanFail(input) {
  const result = runStage("plan", "create-task", input);
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, "create-task unexpectedly passed");
  assert.equal(payload.ok, false);
  return payload.error;
}

function runDo(command, input) {
  const result = runStage("do", command, input);
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runDoFail(command, input) {
  const result = runStage("do", command, input);
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, `${command} unexpectedly passed`);
  assert.equal(payload.ok, false);
  return payload.error;
}

function runVerify(input) {
  const result = runStage("verify", "complete", input);
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`verify complete failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runVerifyFail(input) {
  const result = runStage("verify", "complete", input);
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, "verify complete unexpectedly passed");
  assert.equal(payload.ok, false);
  return payload.error;
}

function runArchive(input) {
  const result = runStage("archive", "archive", input);
  const payload = parseOutput(result.stdout);
  if (result.status !== 0) {
    throw new Error(`archive failed:\n${result.stdout || result.stderr}`);
  }
  assert.equal(payload.ok, true);
  return payload.result;
}

function runArchiveFail(input) {
  const result = runStage("archive", "archive", input);
  const payload = parseOutput(result.stdout);
  assert.notEqual(result.status, 0, "archive unexpectedly passed");
  assert.equal(payload.ok, false);
  return payload.error;
}

function runDoAgentChainHook(input) {
  const result = spawnSync(process.execPath, [doAgentChainHook], {
    cwd: targetDir,
    input: JSON.stringify(input),
    env: {
      ...process.env,
      MY_CC_LITE_HOOK_LOG: hookLogPath
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`do-agent-chain hook failed:\n${result.stdout || result.stderr}`);
  }
  return parseOutput(result.stdout);
}

function runStagePreflightHook(input, cwd = targetDir) {
  const result = spawnSync(process.execPath, [stagePreflightHook], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`stage-preflight hook failed:\n${result.stdout || result.stderr}`);
  }
  return parseOutput(result.stdout);
}

function runStageContextHook(input, cwd = targetDir) {
  const result = spawnSync(process.execPath, [stageContextHook], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`stage-context hook failed:\n${result.stdout || result.stderr}`);
  }
  return parseOutput(result.stdout);
}

function userPromptExpansion(commandName, cwd = targetDir) {
  return {
    session_id: "smoke-session",
    transcript_path: path.join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "acceptEdits",
    hook_event_name: "UserPromptExpansion",
    expansion_type: "slash_command",
    command_name: commandName,
    command_args: "",
    command_source: "plugin",
    prompt: `/${commandName}`
  };
}

function assertBlockedPreflight(payload, pattern) {
  assert.equal(payload.continue, true);
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, pattern);
}

function assertSilentPreflight(payload) {
  assert.equal(payload.continue, true);
  assert.equal(payload.suppressOutput, true);
}

function assertHookContext(payload, hookEventName, pattern) {
  assert.equal(payload.continue, true);
  assert.equal(payload.hookSpecificOutput.hookEventName, hookEventName);
  assert.match(payload.hookSpecificOutput.additionalContext, pattern);
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
  const runHelp = spawnSync(process.execPath, [runScript, "--help"], {
    cwd: targetDir,
    encoding: "utf8"
  });
  assert.equal(runHelp.status, 0);
  assert.match(runHelp.stdout, /node scripts\/run\.mjs plan create-task/);

  const invalidStage = spawnSync(process.execPath, [runScript, "missing", "command"], {
    cwd: targetDir,
    encoding: "utf8"
  });
  const invalidStagePayload = parseOutput(invalidStage.stdout);
  assert.notEqual(invalidStage.status, 0);
  assert.equal(invalidStagePayload.ok, false);
  assert.equal(invalidStagePayload.error.code, "INVALID_INPUT");

  const directPlanHelp = spawnSync(process.execPath, [planScript, "--help"], {
    cwd: targetDir,
    encoding: "utf8"
  });
  assert.equal(directPlanHelp.status, 0);
  assert.match(directPlanHelp.stdout, /node scripts\/plan\.mjs create-task/);

  const ignoredHook = runDoAgentChainHook({
    hook_event_name: "PostToolUse",
    agent_type: "executor",
    last_assistant_message: "result: completed"
  });
  assert.equal(ignoredHook.continue, true);
  assert.equal(ignoredHook.suppressOutput, true);

  const ignoredUnknownAgentHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "general-purpose",
    last_assistant_message: "result: completed"
  });
  assert.equal(ignoredUnknownAgentHook.continue, true);
  assert.equal(ignoredUnknownAgentHook.suppressOutput, true);

  const ignoredEmptyAgentHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "",
    last_assistant_message: "result: completed"
  });
  assert.equal(ignoredEmptyAgentHook.continue, true);
  assert.equal(ignoredEmptyAgentHook.suppressOutput, true);

  const ignoredPreflightHook = runStagePreflightHook(userPromptExpansion("other-plugin:do"));
  assert.equal(ignoredPreflightHook.continue, true);
  assert.equal(ignoredPreflightHook.suppressOutput, true);

  const uninitializedPreflightHook = runStagePreflightHook(userPromptExpansion("my-cc-lite:do"));
  assertBlockedPreflight(uninitializedPreflightHook, /run \/init before \/do/);

  const executorCompletedHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "my-cc-lite:executor",
    last_assistant_message: "result: completed\nsummary: changed files\nfiles: src/a.js\nchecks: manual"
  });
  assert.equal(executorCompletedHook.continue, true);
  assert.equal(executorCompletedHook.hookSpecificOutput.hookEventName, "SubagentStop");
  assert.match(executorCompletedHook.hookSpecificOutput.additionalContext, /invoke verifier with mode: task_review/);

  const verifierPassedHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "verifier",
    last_assistant_message: "mode: task_review\nresult: passed\nreason: checks passed\nnext: do"
  });
  assert.match(verifierPassedHook.hookSpecificOutput.additionalContext, /may write completed/);

  const verifierNeedsFixHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "verifier",
    last_assistant_message: "mode: task_review\nresult: needs_fix\nreason: test failed\nnext: debugger"
  });
  assert.match(verifierNeedsFixHook.hookSpecificOutput.additionalContext, /keep the task in progress and continue with debugger/);

  const finalVerifyHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "verifier",
    last_assistant_message: "mode: final_verify\nresult: passed\nreason: final pass\nnext: archive"
  });
  assert.equal(finalVerifyHook.continue, true);
  assert.equal(finalVerifyHook.suppressOutput, true);

  const debuggerFixedHook = runDoAgentChainHook({
    hook_event_name: "SubagentStop",
    agent_type: "debugger",
    last_assistant_message: "result: fixed\nrootCause: missing import\nfix: added import\nchecks: node --check\nnext: verifier"
  });
  assert.match(debuggerFixedHook.hookSpecificOutput.additionalContext, /continue with verifier task_review/);

  const uninitializedArchiveError = runArchiveFail(
    JSON.stringify({
      summary: "Should fail before init."
    })
  );
  assert.equal(uninitializedArchiveError.code, "PROJECT_NOT_INITIALIZED");

  const uninitializedVerifyError = runVerifyFail(
    JSON.stringify({
      status: "passed",
      summary: "Should fail before init."
    })
  );
  assert.equal(uninitializedVerifyError.code, "PROJECT_NOT_INITIALIZED");

  const uninitializedDoError = runDoFail(
    "materialize",
    JSON.stringify({
      objective: "Materialize before init",
      subtasks: [
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

  const emptyPlanContextHook = runStageContextHook(userPromptExpansion("my-cc-lite:plan"));
  assertHookContext(emptyPlanContextHook, "UserPromptExpansion", /projectSummary: First summary\./);

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
          },
          {
            name: "implementation-skill",
            type: "skill",
            invoke: "implementation-skill",
            description: "Help implement project-specific changes during /do"
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
    ["workspace-runner", "implementation-skill"]
  );
  assert.deepEqual(
    second.project.stageHelpers.review.map((helper) => helper.invoke),
    ["code-review"]
  );

  const secondPlanContextHook = runStageContextHook(userPromptExpansion("my-cc-lite:plan"));
  assertHookContext(secondPlanContextHook, "UserPromptExpansion", /projectSummary: Second summary\./);
  assert.match(secondPlanContextHook.hookSpecificOutput.additionalContext, /planning helpers:/);
  // assert.match(secondPlanContextHook.hookSpecificOutput.additionalContext, /codegraph_context: Collect code context before \/plan drafts implementation tasks/);
  assert.match(secondPlanContextHook.hookSpecificOutput.additionalContext, /execution skills:/);
  // assert.match(secondPlanContextHook.hookSpecificOutput.additionalContext, /implementation-skill: Help implement project-specific changes during \/do/);

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

  const planContextHook = runStageContextHook(userPromptExpansion("my-cc-lite:plan"));
  assertHookContext(planContextHook, "UserPromptExpansion", /projectSummary: Second summary\./);
  assert.match(planContextHook.hookSpecificOutput.additionalContext, /planning helpers/);
  assert.match(planContextHook.hookSpecificOutput.additionalContext, /implementation-skill/);
  assert.doesNotMatch(planContextHook.hookSpecificOutput.additionalContext, /workspace-runner/);

  const doContextHook = runStageContextHook(userPromptExpansion("my-cc-lite:do"));
  assertHookContext(doContextHook, "UserPromptExpansion", /task\.exists: false/);

  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "tasks")), false);

  const noActiveDoPreflightHook = runStagePreflightHook(userPromptExpansion("my-cc-lite:do"));
  assertBlockedPreflight(noActiveDoPreflightHook, /run \/plan before \/do/);

  const noActiveTaskError = runDoFail(
    "materialize",
    JSON.stringify({
      objective: "Materialize without active task",
      subtasks: [
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

  const noActiveVerifyError = runVerifyFail(
    JSON.stringify({
      status: "passed",
      summary: "Should fail without active task."
    })
  );
  assert.equal(noActiveVerifyError.code, "NO_ACTIVE_TASK");

  const noActiveArchiveError = runArchiveFail(
    JSON.stringify({
      summary: "Should fail without active task."
    })
  );
  assert.equal(noActiveArchiveError.code, "NO_ACTIVE_TASK");

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

  const firstMaterializationPreflightHook = runStagePreflightHook(userPromptExpansion("my-cc-lite:do"));
  assertSilentPreflight(firstMaterializationPreflightHook);

  const missingTaskStateError = runVerifyFail(
    JSON.stringify({
      status: "passed",
      summary: "Should fail before /do materialize."
    })
  );
  assert.equal(missingTaskStateError.code, "TASK_STATE_NOT_FOUND");

  const missingTaskStateArchiveError = runArchiveFail(
    JSON.stringify({
      summary: "Should fail before /do materialize."
    })
  );
  assert.equal(missingTaskStateArchiveError.code, "TASK_STATE_NOT_FOUND");

  const beforeDoPlan = await readFile(plan.planPath, "utf8");
  const beforeDoProject = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  const materialized = runDo(
    "materialize",
    JSON.stringify({
      objective: "Create a plan-stage smoke task.",
      subtasks: [
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
    materialized.subtasks.map((task) => [task.id, task.status]),
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
  assert.equal(taskJson.subtasks[0].steps[1].title, "Inspect written files");
  assert.equal(await readFile(plan.planPath, "utf8"), beforeDoPlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeDoProject);

  const invalidArchiveInputError = runArchiveFail(
    JSON.stringify({
      summary: " "
    })
  );
  assert.equal(invalidArchiveInputError.code, "INVALID_INPUT");
  assert.equal(JSON.parse(await readFile(materialized.taskPath, "utf8")).archive.archivedAt, null);

  await rm(plan.planPath, { force: true });
  const missingPlanArchiveError = runArchiveFail(
    JSON.stringify({
      summary: "Should fail when plan.md is missing."
    })
  );
  assert.equal(missingPlanArchiveError.code, "PLAN_NOT_FOUND");
  await writeFile(plan.planPath, beforeDoPlan, "utf8");

  const archiveTargetDir = path.join(targetDir, ".my-cc-lite", "archived_tasks", plan.taskId);
  await mkdir(archiveTargetDir, { recursive: true });
  await writeFile(path.join(archiveTargetDir, "sentinel.txt"), "keep me", "utf8");
  const archiveTargetExistsError = runArchiveFail(
    JSON.stringify({
      summary: "Should fail when the archive target already exists."
    })
  );
  assert.equal(archiveTargetExistsError.code, "ARCHIVE_TARGET_EXISTS");
  assert.equal(await readFile(path.join(archiveTargetDir, "sentinel.txt"), "utf8"), "keep me");
  assert.equal(JSON.parse(await readFile(materialized.taskPath, "utf8")).archive.archivedAt, null);
  await rm(archiveTargetDir, { recursive: true, force: true });

  const pendingVerifyPreflightHook = runStagePreflightHook(userPromptExpansion("my-cc-lite:verify"));
  assertBlockedPreflight(pendingVerifyPreflightHook, /return to \/do/);

  const pendingVerifyError = runVerifyFail(
    JSON.stringify({
      status: "passed",
      summary: "Should fail while tasks are still pending."
    })
  );
  assert.equal(pendingVerifyError.code, "TASK_NOT_VERIFIABLE");
  const afterPendingVerifyTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  assert.equal(afterPendingVerifyTaskJson.verification.status, "not_started");
  assert.equal(afterPendingVerifyTaskJson.status, "active");

  const materializeAgainError = runDoFail(
    "materialize",
    JSON.stringify({
      objective: "Create a plan-stage smoke task.",
      subtasks: [
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
    completed.subtasks.map((task) => [task.id, task.status]),
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
    nextCompleted.subtasks.map((task) => [task.id, task.status]),
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
  assert.equal(afterDoTaskJson.subtasks[0].title, "Create the plan artifact");
  assert.deepEqual(afterDoTaskJson.subtasks[0].checks, ["plan.md exists", "task.json is created by materialize"]);
  assert.equal(afterDoTaskJson.verification.status, "not_started");
  assert.equal(await readFile(plan.planPath, "utf8"), beforeDoPlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeDoProject);

  const beforeVerifyProject = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  const beforeVerifyPlan = await readFile(plan.planPath, "utf8");
  const passed = runVerify(
    JSON.stringify({
      status: "passed",
      summary: "The smoke task satisfies plan.md."
    })
  );
  assert.equal(passed.status, "verified");
  assert.equal(passed.stage, "verified");
  assert.equal(passed.verification.status, "passed");
  assert.equal(passed.verification.summary, "The smoke task satisfies plan.md.");
  assert.deepEqual(
    passed.subtasks.map((task) => [task.id, task.status]),
    [
      ["T1", "completed"],
      ["T2", "completed"],
      ["T3", "skipped"]
    ]
  );
  const afterPassedTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  assert.equal(afterPassedTaskJson.status, "verified");
  assert.equal(afterPassedTaskJson.stage, "verified");
  assert.equal(afterPassedTaskJson.verification.status, "passed");
  assert.equal(afterPassedTaskJson.subtasks.length, 3);
  assert.equal(await readFile(plan.planPath, "utf8"), beforeVerifyPlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeVerifyProject);

  const invalidRepairOnPassedError = runVerifyFail(
    JSON.stringify({
      status: "passed",
      summary: "Repair tasks are not allowed for passed.",
      repairTasks: [
        {
          title: "Invalid repair",
          steps: [],
          checks: []
        }
      ]
    })
  );
  assert.equal(invalidRepairOnPassedError.code, "INVALID_INPUT");
  assert.equal(JSON.parse(await readFile(materialized.taskPath, "utf8")).subtasks.length, 3);

  const needsFix = runVerify(
    JSON.stringify({
      status: "needs_fix",
      summary: "Added R1 for the missing final smoke check before retrying /verify.",
      repairTasks: [
        {
          title: "Fix verification issue: missing final smoke check",
          steps: ["Run the final smoke check required by plan.md"],
          checks: ["The final smoke check has been run"]
        }
      ]
    })
  );
  assert.equal(needsFix.status, "active");
  assert.equal(needsFix.stage, "executing");
  assert.equal(needsFix.verification.status, "needs_fix");
  assert.deepEqual(
    needsFix.subtasks.map((task) => [task.id, task.status]),
    [
      ["T1", "completed"],
      ["T2", "completed"],
      ["T3", "skipped"],
      ["R1", "pending"]
    ]
  );
  const afterNeedsFixTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  assert.equal(afterNeedsFixTaskJson.subtasks[3].id, "R1");
  assert.equal(afterNeedsFixTaskJson.subtasks[3].title, "Fix verification issue: missing final smoke check");
  assert.equal(afterNeedsFixTaskJson.subtasks[3].status, "pending");
  assert.equal(afterNeedsFixTaskJson.subtasks[3].statusReason, "");
  assert.equal(afterNeedsFixTaskJson.subtasks[0].title, "Create the plan artifact");
  assert.equal(await readFile(plan.planPath, "utf8"), beforeVerifyPlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeVerifyProject);

  const needsFixWithPendingRepairError = runVerifyFail(
    JSON.stringify({
      status: "needs_fix",
      summary: "Should fail while R1 is pending.",
      repairTasks: [
        {
          title: "Invalid second repair",
          steps: [],
          checks: []
        }
      ]
    })
  );
  assert.equal(needsFixWithPendingRepairError.code, "TASK_NOT_VERIFIABLE");

  const completedRepair = runDo(
    "update-task",
    JSON.stringify({
      id: "R1",
      status: "completed",
      statusReason: ""
    })
  );
  assert.equal(completedRepair.status, "active");
  assert.equal(completedRepair.task.status, "completed");

  const secondNeedsFix = runVerify(
    JSON.stringify({
      status: "needs_fix",
      summary: "Added R2 for the second bounded verification gap.",
      repairTasks: [
        {
          title: "Fix verification issue: second bounded gap",
          steps: ["Handle the second bounded verification gap"],
          checks: ["The second bounded verification gap is handled"]
        }
      ]
    })
  );
  assert.equal(secondNeedsFix.subtasks.at(-1).id, "R2");
  assert.equal(secondNeedsFix.subtasks.at(-1).status, "pending");

  runDo(
    "update-task",
    JSON.stringify({
      id: "R2",
      status: "completed",
      statusReason: ""
    })
  );
  const beforeBlockedTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  const blockedVerify = runVerify(
    JSON.stringify({
      status: "blocked",
      summary: "Verification is blocked by an unresolved acceptance decision."
    })
  );
  assert.equal(blockedVerify.status, "blocked");
  assert.equal(blockedVerify.stage, "verifying");
  assert.equal(blockedVerify.verification.status, "blocked");
  assert.equal(blockedVerify.verification.summary, "Verification is blocked by an unresolved acceptance decision.");
  assert.equal(blockedVerify.subtasks.length, beforeBlockedTaskJson.subtasks.length);
  const afterBlockedTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  assert.equal(afterBlockedTaskJson.subtasks.length, beforeBlockedTaskJson.subtasks.length);
  assert.deepEqual(
    afterBlockedTaskJson.subtasks.map((task) => task.id),
    ["T1", "T2", "T3", "R1", "R2"]
  );

  const blockedArchivePreflightHook = runStagePreflightHook(userPromptExpansion("my-cc-lite:archive"));
  assertSilentPreflight(blockedArchivePreflightHook);

  const invalidVerificationTaskJson = structuredClone(afterBlockedTaskJson);
  invalidVerificationTaskJson.verification.status = "legacy";
  await writeFile(materialized.taskPath, `${JSON.stringify(invalidVerificationTaskJson, null, 2)}\n`, "utf8");
  const invalidVerificationStatusError = runVerifyFail(
    JSON.stringify({
      status: "passed",
      summary: "Should fail when task.json has invalid verification status."
    })
  );
  assert.equal(invalidVerificationStatusError.code, "INVALID_TASK_STATE");
  await writeFile(materialized.taskPath, `${JSON.stringify(afterBlockedTaskJson, null, 2)}\n`, "utf8");

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
  await rm(path.join(targetDir, ".my-cc-lite", "tasks", "manual-extra-task"), { recursive: true, force: true });

  const mismatchedTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  mismatchedTaskJson.taskId = "mismatched-task-id";
  await writeFile(materialized.taskPath, `${JSON.stringify(mismatchedTaskJson, null, 2)}\n`, "utf8");
  const mismatchedTaskIdArchiveError = runArchiveFail(
    JSON.stringify({
      summary: "Should fail when taskId does not match the directory."
    })
  );
  assert.equal(mismatchedTaskIdArchiveError.code, "INVALID_TASK_STATE");
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "tasks", plan.taskId)), true);
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "archived_tasks", plan.taskId)), false);
  await writeFile(materialized.taskPath, `${JSON.stringify(afterBlockedTaskJson, null, 2)}\n`, "utf8");

  const beforeArchiveProject = await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8");
  const beforeArchivePlan = await readFile(plan.planPath, "utf8");
  const beforeArchiveTaskJson = JSON.parse(await readFile(materialized.taskPath, "utf8"));
  const archived = runArchive(
    JSON.stringify({
      summary: "Archived the blocked smoke task to close the current task."
    })
  );
  const archivedDir = path.join(targetRoot, ".my-cc-lite", "archived_tasks", plan.taskId);
  assert.equal(archived.taskId, plan.taskId);
  assert.equal(archived.archivedDir, archivedDir);
  assert.equal(archived.taskPath, path.join(archivedDir, "task.json"));
  assert.equal(archived.planPath, path.join(archivedDir, "plan.md"));
  assert.equal(archived.status, "archived");
  assert.equal(archived.stage, "archived");
  assert.equal(archived.verification.status, "blocked");
  assert.equal(archived.archive.summary, "Archived the blocked smoke task to close the current task.");
  assert.equal(existsSync(path.join(targetDir, ".my-cc-lite", "tasks", plan.taskId)), false);
  assert.equal(existsSync(archivedDir), true);
  assert.deepEqual(await readdir(path.join(targetDir, ".my-cc-lite", "tasks")), []);
  const archivedTaskJson = JSON.parse(await readFile(path.join(archivedDir, "task.json"), "utf8"));
  assert.equal(archivedTaskJson.status, "archived");
  assert.equal(archivedTaskJson.stage, "archived");
  assert.equal(archivedTaskJson.archive.summary, "Archived the blocked smoke task to close the current task.");
  assert.equal(typeof archivedTaskJson.archive.archivedAt, "string");
  assert.deepEqual(archivedTaskJson.verification, beforeArchiveTaskJson.verification);
  assert.deepEqual(archivedTaskJson.subtasks, beforeArchiveTaskJson.subtasks);
  assert.equal(await readFile(path.join(archivedDir, "plan.md"), "utf8"), beforeArchivePlan);
  assert.equal(await readFile(path.join(targetDir, ".my-cc-lite", "project.json"), "utf8"), beforeArchiveProject);
  for (const unexpected of ["archive.md", "changed-files.json", "events.jsonl", "commands.jsonl"]) {
    assert.equal(existsSync(path.join(archivedDir, unexpected)), false, `${unexpected} should not be generated`);
  }

  process.stdout.write(`smoke passed: ${targetDir}\n`);
} finally {
  await rm(targetDir, { recursive: true, force: true });
}
