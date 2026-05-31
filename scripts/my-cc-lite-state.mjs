#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addChangedFile,
  addEvidence,
  appendEvent,
  completeStage,
  completionProblems,
  deriveOverallStatus,
  deriveSnapshot,
  failStage,
  injectionText,
  nextAction,
  readCurrentTaskPointer,
  readCurrentWorkflow,
  readEvents,
  readWorkflow,
  registerCapability,
  resolveTaskId,
  setVerificationStatus,
  setWorkItemStatus,
  setWorkItems,
  startExistingStage,
  startPlanTask,
  statusText,
  summarize,
  updateStage,
  writeCurrentTaskPointer
} from "./my-cc-lite-workflow-parser.mjs";

export {
  addChangedFile,
  addEvidence,
  appendEvent,
  completeStage,
  completionProblems,
  deriveOverallStatus,
  failStage,
  injectionText,
  nextAction,
  readEvents,
  registerCapability,
  setVerificationStatus,
  setWorkItemStatus,
  setWorkItems,
  startExistingStage,
  startPlanTask,
  statusText,
  summarize,
  updateStage
};

export async function readState(taskId = null) {
  if (taskId) return readWorkflow(taskId);
  return readCurrentWorkflow();
}

export async function requireState(taskId = null) {
  return readState(taskId);
}

export async function setVerification(status, evidence = []) {
  return setVerificationStatus(status, evidence);
}

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function extractChangedFiles(input) {
  const values = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (/file|path/i.test(key) && looksLikeProjectPath(value)) values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    }
  };
  visit(input);
  return Array.from(new Set(values.map(normalizeProjectPath).filter(Boolean)));
}

function looksLikeProjectPath(value) {
  if (value.includes("\n") || value.length > 400) return false;
  return /^\.?[\w./ -]+\.[a-z0-9]+$/i.test(value) || value.startsWith(process.cwd());
}

function normalizeProjectPath(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  let relative = path.relative(process.cwd(), absolute);
  if (relative.startsWith("..")) return null;
  relative = relative.split(path.sep).join("/");
  return relative === "" ? null : relative;
}

async function cli(argv) {
  const { positional, taskId } = parseArgs(argv.slice(2));
  const command = positional[0] || "status";

  if (command === "plan-start") {
    const task = positional.slice(1).join(" ").trim();
    if (!task) throw new Error("usage: my-cc-lite-state plan-start <task>");
    process.stdout.write(`${JSON.stringify(await startPlanTask(task), null, 2)}\n`);
    return;
  }

  if (command === "use-task") {
    const nextTaskId = positional[1];
    if (!nextTaskId) throw new Error("usage: my-cc-lite-state use-task <taskId>");
    await readWorkflow(nextTaskId);
    process.stdout.write(`${JSON.stringify(await writeCurrentTaskPointer(nextTaskId), null, 2)}\n`);
    return;
  }

  if (command === "current-task") {
    process.stdout.write(`${JSON.stringify(await readCurrentTaskPointer(), null, 2)}\n`);
    return;
  }

  if (command === "get") {
    process.stdout.write(`${JSON.stringify(await readWorkflow(await resolveTaskId(taskId)), null, 2)}\n`);
    return;
  }

  if (command === "status") {
    let workflow = null;
    try {
      workflow = await readWorkflow(await resolveTaskId(taskId));
    } catch (error) {
      const missingCurrentTask = !taskId && error.message.startsWith("No .my-cc-lite/current-task.json found.");
      if (!missingCurrentTask) throw error;
    }
    const events = workflow ? await readEvents(workflow.taskId).catch(() => []) : [];
    process.stdout.write(`${statusText(workflow, events)}\n`);
    if (workflow) await updateStage(workflow.taskId, "status", { snapshot: deriveSnapshot(workflow) }).catch(() => {});
    return;
  }

  if (command === "start-stage") {
    const stageName = positional[1];
    if (!stageName) throw new Error("usage: my-cc-lite-state start-stage <do|verify|status> [--task <taskId>]");
    process.stdout.write(`${JSON.stringify(await startExistingStage(taskId, stageName), null, 2)}\n`);
    return;
  }

  if (command === "update-stage") {
    const stageName = positional[1];
    if (!stageName) throw new Error("usage: my-cc-lite-state update-stage <plan|do|verify|status> [patch-json] [--task <taskId>]");
    const patch = await readJsonArgument(positional[2]);
    process.stdout.write(`${JSON.stringify(await updateStage(taskId, stageName, patch), null, 2)}\n`);
    return;
  }

  if (command === "complete-stage") {
    const stageName = positional[1];
    if (!stageName) throw new Error("usage: my-cc-lite-state complete-stage <plan|do|verify|status> [output-json] [--task <taskId>]");
    const output = await readJsonArgument(positional[2]);
    process.stdout.write(`${JSON.stringify(await completeStage(taskId, stageName, output), null, 2)}\n`);
    return;
  }

  if (command === "fail-stage") {
    const stageName = positional[1];
    if (!stageName) throw new Error("usage: my-cc-lite-state fail-stage <plan|do|verify|status> [error-json|string] [--task <taskId>]");
    const error = positional[2] ? await readLooseJsonArgument(positional[2]) : await readStdinJson();
    process.stdout.write(`${JSON.stringify(await failStage(taskId, stageName, error), null, 2)}\n`);
    return;
  }

  if (command === "set-work-items") {
    const items = await readJsonArgument(positional[1]);
    process.stdout.write(`${JSON.stringify(await setWorkItems(items, taskId), null, 2)}\n`);
    return;
  }

  if (command === "set-work-item") {
    const [itemId, status, ...evidence] = positional.slice(1);
    if (!itemId || !status) throw new Error("usage: my-cc-lite-state set-work-item <item-id> <status> [evidence...] [--task <taskId>]");
    process.stdout.write(`${JSON.stringify(await setWorkItemStatus(itemId, status, evidence, taskId), null, 2)}\n`);
    return;
  }

  if (command === "add-changed-file") {
    const file = positional[1];
    if (!file) throw new Error("usage: my-cc-lite-state add-changed-file <path> [--task <taskId>]");
    process.stdout.write(`${JSON.stringify(await addChangedFile(file, "my-cc-lite", taskId), null, 2)}\n`);
    return;
  }

  if (command === "add-evidence") {
    const evidence = await readJsonArgument(positional[1]);
    process.stdout.write(`${JSON.stringify(await addEvidence(evidence, taskId), null, 2)}\n`);
    return;
  }

  if (command === "set-verification") {
    const status = positional[1];
    if (!status) throw new Error("usage: my-cc-lite-state set-verification <passed|failed|not_started> [--task <taskId>]");
    process.stdout.write(`${JSON.stringify(await setVerificationStatus(status, [], taskId), null, 2)}\n`);
    return;
  }

  if (command === "append-event") {
    const event = await readJsonArgument(positional[1]);
    process.stdout.write(`${JSON.stringify(await appendEvent({ ...event, taskId: event.taskId || taskId }), null, 2)}\n`);
    return;
  }

  if (command === "register-capability") {
    const capability = await readJsonArgument(positional[1]);
    const provider = capability.provider || capability.name;
    delete capability.provider;
    delete capability.name;
    process.stdout.write(`${JSON.stringify(await registerCapability(provider, capability), null, 2)}\n`);
    return;
  }

  if (command === "summarize") {
    process.stdout.write(`${await summarize(taskId)}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

function parseArgs(args) {
  const positional = [];
  let taskId = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--task") {
      taskId = args[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, taskId };
}

async function readJsonArgument(argument) {
  if (!argument) return readStdinJson();
  const trimmed = argument.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  return JSON.parse(await fs.readFile(argument, "utf8"));
}

async function readLooseJsonArgument(argument) {
  const trimmed = argument.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  return argument;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  cli(process.argv).catch((error) => {
    process.stderr.write(`my-cc-lite: ${error.message}\n`);
    process.exitCode = 1;
  });
}
