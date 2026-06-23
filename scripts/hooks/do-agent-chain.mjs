#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolveHookLogDir, writeHookLog } from "../lib/hook-log.mjs";

async function main() {
  const { input, rawContent } = readHookStdinJson();
  const eventName = input.hook_event_name || input.hookEventName;
  const agentType = normalizeAgentType(input.agent_type || input.agentType);
  const taskDir = await resolveHookLogDir(input.cwd);
  writeHookLog({ hook: "do-agent-chain", event: eventName, fields: { agent: agentType }, rawContent, logDir: taskDir });

  if (eventName !== "SubagentStop") {
    return silentContinue();
  }

  if (!isTrackedAgentType(agentType)) {
    return silentContinue();
  }

  const fields = parseKeyValueMessage(input.last_assistant_message || "");
  const message = buildAgentSignal(agentType, fields);
  if (!message) {
    return silentContinue();
  }

  return appendContext(eventName, message);
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

function normalizeAgentType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  return normalized.includes(":") ? normalized.split(":").at(-1) : normalized;
}

function parseKeyValueMessage(message) {
  const fields = {};
  for (const rawLine of String(message).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```")) {
      continue;
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    fields[match[1].toLowerCase()] = match[2].trim();
  }
  return fields;
}

function buildAgentSignal(agentType, fields) {
  if (agentType === "executor") {
    return executorSignal(fields);
  }
  if (agentType === "verifier") {
    return verifierSignal(fields);
  }
  if (agentType === "debugger") {
    return debuggerSignal(fields);
  }
  if (agentType === "task-materializer") {
    return taskMaterializerSignal(fields);
  }
  return "";
}

function isTrackedAgentType(agentType) {
  return (
    agentType === "executor" ||
    agentType === "verifier" ||
    agentType === "debugger" ||
    agentType === "task-materializer"
  );
}

function executorSignal(fields) {
  const result = normalizeValue(fields.result);
  if (result === "completed") {
    return "executor returned completed; keep the current task in progress and invoke verifier with mode: task_review before writing completed.";
  }
  if (result === "failed") {
    return "executor returned failed; write failed with a short statusReason and stop, or call debugger only when the failure evidence is bounded.";
  }
  if (result === "blocked") {
    return "executor returned blocked; stop for user decision or write blocked with a short statusReason through scripts/run.mjs do update-task.";
  }
  if (result === "skipped") {
    return "executor returned skipped; write skipped only if the user explicitly confirmed skipping this task.";
  }
  return "executor output did not contain a recognized result; stop and request a corrected executor response before updating task state.";
}

function verifierSignal(fields) {
  const mode = normalizeValue(fields.mode);
  const result = normalizeValue(fields.result);
  const next = normalizeValue(fields.next);

  if (mode && mode !== "task_review") {
    return "";
  }
  if (result === "passed") {
    return "verifier task_review passed; /do may write completed for the current task through scripts/run.mjs do update-task.";
  }
  if (result === "needs_fix") {
    const nextStep = next ? ` and continue with ${next}` : "";
    return `verifier task_review needs_fix; keep the task in progress${nextStep}, without writing completed.`;
  }
  if (result === "blocked") {
    return "verifier task_review blocked; stop for user decision or write blocked with a short statusReason through scripts/run.mjs do update-task.";
  }
  return "verifier task_review output did not contain a recognized result; stop and request a corrected verifier response before updating task state.";
}

function debuggerSignal(fields) {
  const result = normalizeValue(fields.result);
  const next = normalizeValue(fields.next);
  if (result === "fixed") {
    return "debugger returned fixed; continue with verifier task_review before writing completed.";
  }
  if (result === "suggested_fix") {
    const nextStep = next ? ` Suggested next step: ${next}.` : "";
    return `debugger returned suggested_fix; do not mark the task completed until the fix is applied and verified.${nextStep}`;
  }
  if (result === "blocked") {
    return "debugger returned blocked; stop for user decision or write blocked with a short statusReason if the task cannot continue.";
  }
  return "debugger output did not contain a recognized result; stop and request a corrected debugger response before updating task state.";
}

function taskMaterializerSignal(fields) {
  const result = normalizeValue(fields.result);
  if (result === "ready") {
    return "task-materializer returned ready; call scripts/run.mjs do materialize passing only objective and subtasks[] — do not pass result, shouldStopAfterMaterialize, or reason.";
  }
  if (result === "coarse_ready") {
    return "task-materializer returned coarse_ready; show reason and candidate breakdown to user for confirmation before calling materialize.";
  }
  if (result === "needs_plan_update" || result === "blocked") {
    return `task-materializer returned ${result}; do not call materialize, explain the reason and stop.`;
  }
  return "task-materializer output did not contain a recognized result; stop and request a corrected task-materializer response before materializing.";
}

function normalizeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replace(/\s+/g, "_");
}

function silentContinue() {
  return {
    continue: true,
    suppressOutput: true
  };
}

function appendContext(eventName, message) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: `my-cc-lite hook: ${message}`
    }
  };
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
} catch {
  process.stdout.write(`${JSON.stringify(silentContinue(), null, 2)}\n`);
}
