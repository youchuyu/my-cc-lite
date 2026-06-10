#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";

function main() {
  const { input, rawContent } = readHookStdinJson();
  const eventName = input.hook_event_name || input.hookEventName;
  const agentType = normalizeAgentType(input.agent_type || input.agentType);
  writeDebugLog(eventName, agentType, rawContent);

  if (eventName !== "SubagentStop") {
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

function writeDebugLog(eventName, agentType, rawContent) {
  const logPath = process.env.MY_CC_LITE_HOOK_LOG || "my-cc-lite-hook.log";
  const entry = [
    `time: ${new Date().toISOString()}`,
    `event: ${eventName || ""}`,
    `agent: ${agentType || ""}`,
    "input:",
    rawContent || "",
    "---"
  ].join("\n");

  try {
    appendFileSync(logPath, `${entry}\n`, "utf8");
  } catch (error) {
    console.error(`my-cc-lite hook log write failed: ${error instanceof Error ? error.message : String(error)}`);
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
  return "";
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

process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
