#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { readPreflightState } from "../lib/preflight.mjs";

const STAGES = new Set(["init", "plan", "do", "verify", "archive"]);

async function main() {
  const { input, rawContent } = readHookStdinJson();
  const eventName = input.hook_event_name || input.hookEventName;
  const expansionType = input.expansion_type || input.expansionType;
  const commandName = input.command_name || input.commandName;
  const stage = normalizeStage(commandName);
  writeDebugLog("enter", { eventName, expansionType, commandName, stage, cwd: input.cwd }, rawContent);

  if (eventName !== "UserPromptExpansion" || expansionType !== "slash_command" || !stage) {
    return silentContinue();
  }

  const projectRoot = input.cwd || process.cwd();
  const state = await readPreflightState(projectRoot);
  const result = buildPreflightResult(stage, state);
  const message = result.message;
  writeDebugLog("result", { eventName, expansionType, commandName, stage, projectRoot, message }, "");
  if (!message) {
    return silentContinue();
  }
  if (!result.block) {
    return appendContext(`my-cc-lite preflight: ${message}`);
  }

  return blockExpansion(`my-cc-lite preflight: ${message}`);
}

function readHookStdinJson() {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    return {
      input: {},
      rawContent: ""
    };
  }
  try {
    return {
      input: JSON.parse(content),
      rawContent: content
    };
  } catch {
    return {
      input: {},
      rawContent: content
    };
  }
}

function writeDebugLog(label, fields, rawContent) {
  const logPath = process.env.MY_CC_LITE_HOOK_LOG || "my-cc-lite-hook.log";
  const entry = [
    `time: ${new Date().toISOString()}`,
    "hook: stage-preflight",
    `label: ${label}`,
    `event: ${fields.eventName || ""}`,
    `expansion: ${fields.expansionType || ""}`,
    `command: ${fields.commandName || ""}`,
    `stage: ${fields.stage || ""}`,
    `cwd: ${fields.cwd || fields.projectRoot || ""}`,
    `message: ${fields.message || ""}`,
    "input:",
    rawContent || "",
    "---"
  ].join("\n");

  try {
    appendFileSync(logPath, `${entry}\n`, "utf8");
  } catch (error) {
    console.error(`my-cc-lite stage preflight log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeStage(commandName) {
  const value = String(commandName || "").trim();
  if (!value.startsWith("my-cc-lite:")) return "";
  const stage = value.slice("my-cc-lite:".length);
  return STAGES.has(stage) ? stage : "";
}

function buildPreflightResult(stage, state) {
  if (stage === "init") {
    return initResult(state);
  }

  const common = commonResult(stage, state);
  if (common) return common;

  if (stage === "plan") return planResult(state);
  if (stage === "do") return doResult(state);
  if (stage === "verify") return verifyResult(state);
  if (stage === "archive") return archiveResult(state);
  return noMessage();
}

function initResult(state) {
  if (state.activeTasks.count > 1) {
    return block("multiple active task directories exist; resolve .my-cc-lite/tasks manually before continuing.");
  }
  return noMessage();
}

function commonResult(stage, state) {
  if (!state.project.exists) {
    return block(`run /init before /${stage}.`);
  }
  if (!state.project.valid) {
    return block("project state is invalid; inspect .my-cc-lite/project.json before continuing.");
  }
  if (state.activeTasks.count > 1) {
    return block("multiple active task directories exist; resolve .my-cc-lite/tasks manually before continuing.");
  }
  return null;
}

function planResult(state) {
  if (state.activeTasks.count === 1) {
    return block("an active task already exists; continue with /do, /verify, or /archive before creating a new plan.");
  }
  return noMessage();
}

function doResult(state) {
  const taskAvailability = currentTaskResult("do", state);
  if (taskAvailability) return taskAvailability;
  if (!state.task.exists) {
    return context("/do should enter first materialization because task.json is missing.");
  }
  if (!state.task.valid) {
    return context("task state is invalid; /do should rely on the stage script hard check before updating state.");
  }
  if (state.task.unfinishedTasks.length === 0) {
    return context("all task entries are completed or skipped; move to /verify instead of continuing execution.");
  }
  return context("/do should enter recovery check because task.json already exists; do not rematerialize.");
}

function verifyResult(state) {
  const taskAvailability = currentTaskResult("verify", state);
  if (taskAvailability) return taskAvailability;
  if (!state.task.exists) {
    return block("/verify is not ready because task.json is missing; run /do first.");
  }
  const taskState = taskStateResult(state);
  if (taskState) return taskState;
  if (state.task.unfinishedTasks.length > 0) {
    const task = state.task.unfinishedTasks[0];
    return block(`/verify is not ready because task ${task.id} is ${task.status}; return to /do.`);
  }
  if (state.task.allSkipped || state.task.completedCount === 0) {
    return block("/verify is not ready because no task is completed; return to /plan to confirm the task still makes sense.");
  }
  return noMessage();
}

function archiveResult(state) {
  const taskAvailability = currentTaskResult("archive", state);
  if (taskAvailability) return taskAvailability;
  if (!state.task.exists) {
    return block("/archive is not ready because task.json is missing; run /do first or repair state manually.");
  }
  const taskState = taskStateResult(state);
  if (taskState) return taskState;
  if (state.task.taskId !== state.activeTasks.taskId) {
    return block("task.json taskId does not match the active task directory; inspect task state before archiving.");
  }
  if (state.archive.targetExists) {
    return block("archive target already exists; inspect .my-cc-lite/archived_tasks before archiving.");
  }
  if (state.task.verificationStatus !== "passed") {
    return context("verification.status is not passed; /archive may close the task, but the skill should confirm that the user intends to close an incomplete or unverified task.");
  }
  return noMessage();
}

function currentTaskResult(stage, state) {
  if (state.activeTasks.count === 0) {
    return block(`run /plan before /${stage}.`);
  }
  if (!state.plan.exists) {
    return block(`current task is missing plan.md; return to /plan or repair state before /${stage}.`);
  }
  if (state.plan.empty) {
    return block(`current plan.md is empty; repair the plan before /${stage}.`);
  }
  return null;
}

function taskStateResult(state) {
  if (state.task.exists && !state.task.valid) {
    return block("task state is invalid; inspect .my-cc-lite/tasks/*/task.json before continuing.");
  }
  return null;
}

function block(message) {
  return {
    block: true,
    message
  };
}

function context(message) {
  return {
    block: false,
    message
  };
}

function noMessage() {
  return {
    block: false,
    message: ""
  };
}

function silentContinue() {
  return {
    continue: true,
    suppressOutput: true
  };
}

function blockExpansion(message) {
  return {
    continue: true,
    decision: "block",
    reason: message
  };
}

function appendContext(message) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptExpansion",
      additionalContext: message
    }
  };
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
} catch {
  process.stdout.write(`${JSON.stringify(silentContinue(), null, 2)}\n`);
}
