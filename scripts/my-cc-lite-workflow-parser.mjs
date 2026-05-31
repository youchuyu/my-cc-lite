import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const STATE_DIR = ".my-cc-lite";
export const TASKS_DIR = path.join(STATE_DIR, "tasks");
export const CURRENT_TASK_PATH = path.join(STATE_DIR, "current-task.json");
export const CAPABILITIES_PATH = path.join(STATE_DIR, "capabilities.json");
export const CONFIG_PATH = path.join(STATE_DIR, "config.json");
export const LOCK_PATH = path.join(STATE_DIR, "workflow.lock");

const STAGES = ["plan", "do", "verify", "status"];
const STAGE_STATUSES = new Set(["pending", "in_progress", "completed", "failed", "blocked"]);
const ITEM_STATUSES = new Set(["pending", "in_progress", "completed", "skipped", "not_applicable", "blocked"]);
const TERMINAL_ITEM_STATUSES = new Set(["completed", "skipped", "not_applicable"]);
const INVENTORY_CATEGORIES = ["planning", "execution", "review"];
const INVENTORY_BUCKETS = ["skills", "agents", "tools"];
const MY_CC_LITE_CAPABILITY_NAMES = new Set([
  "init",
  "plan",
  "do",
  "verify",
  "status",
  "planner",
  "executor",
  "verifier",
  "explore"
]);
const CLAUDE_NATIVE_CAPABILITY_NAMES = new Set([
  "bash",
  "bashoutput",
  "edit",
  "exitplanmode",
  "general-purpose",
  "glob",
  "grep",
  "killbash",
  "listmcpresources",
  "lsp",
  "ls",
  "multiedit",
  "notebookedit",
  "notebookread",
  "plan",
  "read",
  "readmcpresource",
  "run",
  "task",
  "todowrite",
  "verify",
  "webfetch",
  "websearch",
  "write"
]);

const DEFAULT_STAGE_CAPABILITIES = {
  plan: { items: true, files: false, evidence: false, checks: false, snapshot: false, blockers: true },
  do: { items: true, files: true, evidence: true, checks: false, snapshot: false, blockers: true },
  verify: { items: true, files: true, evidence: true, checks: true, snapshot: false, blockers: true },
  status: { items: false, files: false, evidence: false, checks: false, snapshot: true, blockers: false }
};

const EMPTY_CAPABILITIES = {
  items: false,
  files: false,
  evidence: false,
  checks: false,
  snapshot: false,
  blockers: false
};

export function now() {
  return new Date().toISOString();
}

function compactId(input, length = 8) {
  return createHash("sha1").update(input).digest("hex").slice(0, length);
}

function taskSlug(input) {
  return String(input || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createTaskId(task, date = new Date()) {
  return `${timestampId(date)}-${taskSlug(task)}-${compactId(`${task}:${date.toISOString()}:${Math.random()}`)}`;
}

export async function readJson(filePath, defaultValue = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return defaultValue;
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function ensureProjectStateDir() {
  await fs.mkdir(TASKS_DIR, { recursive: true });
}

async function atomicWrite(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

async function withWorkflowLock(work) {
  await ensureProjectStateDir();
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(LOCK_PATH, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 5000) {
        await fs.rm(LOCK_PATH, { force: true }).catch(() => {});
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n${now()}\n`);
    return await work();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(LOCK_PATH, { force: true }).catch(() => {});
  }
}

export async function readConfig() {
  const config = await readJson(CONFIG_PATH, {});
  return {
    version: 1,
    strictness: "soft",
    verificationRequired: true,
    autoSummarizeBeforeCompact: true,
    maxInjectedItems: 5,
    ...config
  };
}

export async function ensureCapabilities() {
  const existing = await readJson(CAPABILITIES_PATH, null);
  if (existing) return existing;
  const capabilities = { version: 1, providers: {} };
  await atomicWrite(CAPABILITIES_PATH, `${JSON.stringify(capabilities, null, 2)}\n`);
  return capabilities;
}

export async function initCapabilities(input) {
  const inventory = normalizeCapabilityInventory(input?.inventory || input);
  return withWorkflowLock(async () => {
    const existing = await readJson(CAPABILITIES_PATH, {});
    const capabilities = {
      ...existing,
      version: 1,
      initializedAt: now(),
      source: { ...(input?.source || {}), kind: "current-session-context" },
      inventory,
      providers: existing.providers && typeof existing.providers === "object" ? existing.providers : {}
    };
    await atomicWrite(CAPABILITIES_PATH, `${JSON.stringify(capabilities, null, 2)}\n`);
    return capabilities;
  });
}

function normalizeCapabilityInventory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("capability inventory must be an object");
  }
  const inventory = {};
  for (const category of INVENTORY_CATEGORIES) {
    const categoryInput = input[category];
    if (!categoryInput || typeof categoryInput !== "object" || Array.isArray(categoryInput)) {
      throw new Error(`capability inventory.${category} must be an object`);
    }
    inventory[category] = {};
    for (const bucket of INVENTORY_BUCKETS) {
      const bucketInput = categoryInput[bucket] || [];
      if (!Array.isArray(bucketInput)) {
        throw new Error(`capability inventory.${category}.${bucket} must be an array`);
      }
      inventory[category][bucket] = bucketInput
        .map((entry, index) => normalizeCapabilityEntry(entry, `${category}.${bucket}[${index}]`))
        .filter((entry) => !isExcludedCapability(entry));
    }
  }
  return inventory;
}

function normalizeCapabilityEntry(entry, pathLabel) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`capability inventory.${pathLabel} must be an object`);
  }
  if (!entry.name || typeof entry.name !== "string") {
    throw new Error(`capability inventory.${pathLabel}.name is required`);
  }
  if (!entry.kind || typeof entry.kind !== "string") {
    throw new Error(`capability inventory.${pathLabel}.kind is required`);
  }
  return {
    name: entry.name,
    kind: entry.kind,
    description: typeof entry.description === "string" ? entry.description : "",
    invoke: typeof entry.invoke === "string" ? entry.invoke : entry.name,
    source: typeof entry.source === "string" ? entry.source : "visible-context",
    confidence: ["high", "medium", "low"].includes(entry.confidence) ? entry.confidence : "medium"
  };
}

function capabilityKeys(entry) {
  return [entry.name, entry.invoke]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().replace(/^\/+/, "").toLowerCase())
    .filter(Boolean);
}

function isExcludedCapability(entry) {
  const keys = capabilityKeys(entry);
  return keys.some((key) => (
    key === "my-cc-lite" ||
    key.startsWith("my-cc-lite:") ||
    key.startsWith("my-cc-lite/") ||
    MY_CC_LITE_CAPABILITY_NAMES.has(key) ||
    CLAUDE_NATIVE_CAPABILITY_NAMES.has(key)
  ));
}

export async function registerCapability(providerName, capability) {
  if (!providerName) throw new Error("provider name is required");
  const capabilities = await ensureCapabilities();
  capabilities.providers ||= {};
  capabilities.providers[providerName] = {
    ...(capabilities.providers[providerName] || {}),
    ...capability
  };
  await atomicWrite(CAPABILITIES_PATH, `${JSON.stringify(capabilities, null, 2)}\n`);
  const workflow = await readCurrentWorkflow().catch(() => null);
  if (workflow) {
    await appendEvent({
      taskId: workflow.taskId,
      type: "capability.registered",
      payload: { provider: providerName }
    });
  }
  return capabilities;
}

export function createStage(name, capabilities = DEFAULT_STAGE_CAPABILITIES[name] || {}) {
  if (!STAGES.includes(name)) throw new Error(`invalid stage: ${name}`);
  return {
    name,
    status: "pending",
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    summary: "",
    input: {},
    output: {},
    capabilities: { ...EMPTY_CAPABILITIES, ...capabilities },
    items: [],
    files: [],
    evidence: [],
    checks: [],
    snapshot: null,
    blockers: [],
    errors: []
  };
}

export function createWorkflow(task, options = {}) {
  const createdAt = options.createdAt || now();
  const taskId = options.taskId || createTaskId(task);
  const stages = Object.fromEntries(STAGES.map((stage) => [stage, createStage(stage)]));
  stages.plan.status = "in_progress";
  stages.plan.startedAt = createdAt;
  stages.plan.updatedAt = createdAt;
  stages.plan.input = { task };
  return {
    version: 1,
    taskId,
    task,
    currentStage: "plan",
    strictness: options.strictness || "soft",
    createdAt,
    updatedAt: createdAt,
    stages,
    workItems: [],
    changedFiles: [],
    blockers: [],
    extensions: {}
  };
}

export function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object") throw new Error("workflow must be an object");
  if (workflow.version !== 1) throw new Error("workflow.version must be 1");
  if (!workflow.taskId || typeof workflow.taskId !== "string") throw new Error("workflow.taskId is required");
  if (!workflow.task || typeof workflow.task !== "string") throw new Error("workflow.task is required");
  if (!STAGES.includes(workflow.currentStage)) throw new Error(`workflow.currentStage is invalid: ${workflow.currentStage}`);
  if (!workflow.stages || typeof workflow.stages !== "object") throw new Error("workflow.stages is required");
  for (const stageName of STAGES) validateStage(workflow.stages[stageName], stageName);
  if (!Array.isArray(workflow.workItems)) throw new Error("workflow.workItems must be an array");
  if (!Array.isArray(workflow.changedFiles)) throw new Error("workflow.changedFiles must be an array");
  if (!Array.isArray(workflow.blockers)) throw new Error("workflow.blockers must be an array");
  if (!workflow.extensions || typeof workflow.extensions !== "object") throw new Error("workflow.extensions must be an object");
  return true;
}

function validateStage(stage, expectedName) {
  if (!stage || typeof stage !== "object") throw new Error(`stage ${expectedName} is required`);
  if (stage.name !== expectedName) throw new Error(`stage ${expectedName} has invalid name`);
  if (!STAGE_STATUSES.has(stage.status)) throw new Error(`stage ${expectedName} has invalid status: ${stage.status}`);
  for (const field of ["summary"]) {
    if (typeof stage[field] !== "string") throw new Error(`stage ${expectedName}.${field} must be a string`);
  }
  for (const field of ["input", "output", "capabilities"]) {
    if (!stage[field] || typeof stage[field] !== "object" || Array.isArray(stage[field])) {
      throw new Error(`stage ${expectedName}.${field} must be an object`);
    }
  }
  for (const key of Object.keys(EMPTY_CAPABILITIES)) {
    if (typeof stage.capabilities[key] !== "boolean") {
      throw new Error(`stage ${expectedName}.capabilities.${key} must be boolean`);
    }
  }
  for (const field of ["items", "files", "evidence", "checks", "blockers", "errors"]) {
    if (!Array.isArray(stage[field])) throw new Error(`stage ${expectedName}.${field} must be an array`);
  }
}

export function resolveTaskDir(taskId) {
  if (!taskId || typeof taskId !== "string" || taskId.includes("/") || taskId.includes("..")) {
    throw new Error(`invalid taskId: ${taskId}`);
  }
  return path.join(TASKS_DIR, taskId);
}

export function workflowPath(taskId) {
  return path.join(resolveTaskDir(taskId), "workflow.json");
}

export function planPath(taskId) {
  return path.join(resolveTaskDir(taskId), "plan.md");
}

export function eventsPath(taskId) {
  return path.join(resolveTaskDir(taskId), "events.jsonl");
}

export function summaryPath(taskId) {
  return path.join(resolveTaskDir(taskId), "session-summary.md");
}

export async function readCurrentTaskPointer() {
  const pointer = await readJson(CURRENT_TASK_PATH, null);
  if (!pointer) return null;
  if (pointer.version !== 1 || typeof pointer.currentTaskId !== "string") {
    throw new Error("current-task.json is invalid");
  }
  return pointer;
}

export async function writeCurrentTaskPointer(taskId) {
  const pointer = { version: 1, currentTaskId: taskId, updatedAt: now() };
  await atomicWrite(CURRENT_TASK_PATH, `${JSON.stringify(pointer, null, 2)}\n`);
  return pointer;
}

export async function resolveTaskId(taskId = null) {
  if (taskId) return taskId;
  const pointer = await readCurrentTaskPointer();
  if (!pointer?.currentTaskId) throw new Error("No .my-cc-lite/current-task.json found. Run /plan first.");
  return pointer.currentTaskId;
}

export async function readWorkflow(taskId) {
  const workflow = await readJson(workflowPath(taskId), null);
  if (!workflow) throw new Error(`workflow not found for task: ${taskId}`);
  validateWorkflow(workflow);
  return workflow;
}

export async function readCurrentWorkflow() {
  return readWorkflow(await resolveTaskId());
}

export async function writeWorkflow(workflow) {
  workflow.updatedAt = now();
  validateWorkflow(workflow);
  await atomicWrite(workflowPath(workflow.taskId), `${JSON.stringify(workflow, null, 2)}\n`);
  return workflow;
}

export async function createTaskFromPlan(task, options = {}) {
  return startPlanTask(task, options);
}

export async function startPlanTask(task, options = {}) {
  if (!task || !String(task).trim()) throw new Error("task is required");
  const config = await readConfig();
  const workflow = createWorkflow(String(task).trim(), {
    strictness: options.strictness || config.strictness,
    taskId: options.taskId,
    createdAt: options.createdAt
  });
  const taskDir = resolveTaskDir(workflow.taskId);
  await fs.mkdir(path.join(taskDir, "artifacts"), { recursive: true });
  await writeWorkflow(workflow);
  await atomicWrite(planPath(workflow.taskId), options.plan ? `${options.plan.replace(/\s*$/, "")}\n` : `# ${workflow.task}\n`);
  await atomicWrite(eventsPath(workflow.taskId), "");
  await atomicWrite(summaryPath(workflow.taskId), "");
  await writeCurrentTaskPointer(workflow.taskId);
  await ensureCapabilities();
  await appendEvent({
    taskId: workflow.taskId,
    type: "task.created",
    payload: { task: workflow.task }
  });
  return workflow;
}

export async function startExistingStage(taskId, stageName) {
  if (stageName === "plan") throw new Error("plan stage can only be started by plan-start");
  if (!STAGES.includes(stageName)) throw new Error(`invalid stage: ${stageName}`);
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    const stage = workflow.stages[stageName];
    const timestamp = now();
    stage.status = "in_progress";
    stage.startedAt ||= timestamp;
    stage.updatedAt = timestamp;
    workflow.currentStage = stageName;
    await writeWorkflow(workflow);
    await appendEvent({ taskId: workflow.taskId, type: `stage.${stageName}.started`, payload: {} });
    return workflow;
  });
}

export async function updateStage(taskId, stageName, patch = {}) {
  if (!STAGES.includes(stageName)) throw new Error(`invalid stage: ${stageName}`);
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    const stage = workflow.stages[stageName];
    Object.assign(stage, patch);
    stage.updatedAt = now();
    await writeWorkflow(workflow);
    return workflow;
  });
}

export async function completeStage(taskId, stageName, output = {}) {
  if (!STAGES.includes(stageName)) throw new Error(`invalid stage: ${stageName}`);
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    if (stageName === "verify" && output.status !== "failed") {
      const problems = verificationProblems(workflow);
      if (problems.length) throw new Error(problems.join("; "));
    }
    if (stageName === "status") {
      workflow.stages.status.snapshot = deriveSnapshot(workflow);
    }
    const stage = workflow.stages[stageName];
    stage.status = "completed";
    stage.output = { ...(stage.output || {}), ...output };
    stage.updatedAt = now();
    stage.completedAt = stage.updatedAt;
    if (stageName === "plan") workflow.currentStage = "do";
    if (stageName === "do") workflow.currentStage = "verify";
    if (stageName === "verify") workflow.currentStage = "verify";
    await writeWorkflow(workflow);
    await appendEvent({ taskId: workflow.taskId, type: `stage.${stageName}.completed`, payload: output });
    return workflow;
  });
}

export async function failStage(taskId, stageName, error) {
  if (!STAGES.includes(stageName)) throw new Error(`invalid stage: ${stageName}`);
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    const stage = workflow.stages[stageName];
    const entry = normalizeError(error);
    stage.status = "failed";
    stage.errors = [...(stage.errors || []), entry];
    stage.updatedAt = now();
    workflow.currentStage = stageName;
    await writeWorkflow(workflow);
    await appendEvent({ taskId: workflow.taskId, type: `stage.${stageName}.failed`, payload: entry });
    return workflow;
  });
}

export async function setWorkItems(items, taskId = null) {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    workflow.workItems = items.map((item, index) => normalizeWorkItem(item, index));
    workflow.stages.plan.items = workflow.workItems;
    workflow.stages.plan.status = "completed";
    workflow.stages.plan.completedAt = now();
    workflow.stages.plan.updatedAt = workflow.stages.plan.completedAt;
    workflow.currentStage = "do";
    await writeWorkflow(workflow);
    await appendEvent({
      taskId: workflow.taskId,
      type: "plan.updated",
      payload: { itemCount: workflow.workItems.length }
    });
    return workflow;
  });
}

export async function setWorkItemStatus(itemId, status, evidence = [], taskId = null) {
  if (!ITEM_STATUSES.has(status)) throw new Error(`invalid work item status: ${status}`);
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    const item = workflow.workItems.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`item not found: ${itemId}`);
    item.status = status;
    item.evidence = Array.from(new Set([...(item.evidence || []), ...evidence]));
    item.updatedAt = now();
    syncItemsToStages(workflow);
    if (status === "in_progress") workflow.currentStage = "do";
    if (status === "blocked") {
      workflow.currentStage = "do";
      const blocker = { itemId, summary: item.title, createdAt: now() };
      if (!workflow.blockers.some((candidate) => candidate.itemId === itemId)) workflow.blockers.push(blocker);
      workflow.stages.do.blockers = workflow.blockers;
    }
    if (workflow.stages.verify.status === "completed" && !TERMINAL_ITEM_STATUSES.has(status)) {
      workflow.stages.verify.status = "pending";
      workflow.stages.verify.completedAt = null;
    }
    await writeWorkflow(workflow);
    await appendEvent({
      taskId: workflow.taskId,
      type: status === "in_progress" ? "item.started" : `item.${status}`,
      payload: { itemId, title: item.title, evidence }
    });
    return workflow;
  });
}

export async function addChangedFile(filePath, source = "my-cc-lite", taskId = null) {
  const normalized = normalizeProjectPath(filePath);
  if (!normalized || normalized.startsWith(`${STATE_DIR}/`)) return readWorkflow(await resolveTaskId(taskId)).catch(() => null);
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    workflow.changedFiles = Array.from(new Set([...(workflow.changedFiles || []), normalized])).sort();
    workflow.stages.do.files = workflow.changedFiles;
    workflow.stages.verify.files = workflow.changedFiles;
    if (workflow.stages.verify.status === "completed") {
      workflow.stages.verify.status = "pending";
      workflow.stages.verify.completedAt = null;
    }
    await writeWorkflow(workflow);
    await appendEvent({ taskId: workflow.taskId, source, type: "file.changed", payload: { path: normalized } });
    return workflow;
  });
}

export async function addEvidence(evidence, taskId = null) {
  const entry = {
    id: evidence.id || `evidence-${Date.now()}-${compactId(JSON.stringify(evidence))}`,
    source: evidence.source || "my-cc-lite",
    summary: evidence.summary || evidence.command || evidence.path || "verification evidence",
    status: evidence.status || "passed",
    command: evidence.command,
    path: evidence.path,
    timestamp: evidence.timestamp || now()
  };
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    workflow.stages.verify.evidence = [...(workflow.stages.verify.evidence || []), entry];
    if (entry.status === "failed") workflow.stages.verify.status = "failed";
    await writeWorkflow(workflow);
    await appendEvent({
      taskId: workflow.taskId,
      source: entry.source,
      type: entry.status === "failed" ? "verification.failed" : "verification.evidence.added",
      payload: entry
    });
    return entry;
  });
}

export async function setVerificationStatus(status, evidence = [], taskId = null) {
  if (!["passed", "failed", "not_started"].includes(status)) throw new Error("verification status must be passed, failed, or not_started");
  return withWorkflowLock(async () => {
    const workflow = await readWorkflow(await resolveTaskId(taskId));
    if (status === "passed") {
      const problems = verificationProblems(workflow);
      if (problems.length) throw new Error(problems.join("; "));
      workflow.stages.verify.status = "completed";
      workflow.stages.verify.completedAt = now();
    } else {
      workflow.stages.verify.status = status === "failed" ? "failed" : "pending";
      workflow.stages.verify.completedAt = null;
    }
    workflow.currentStage = "verify";
    workflow.stages.verify.updatedAt = now();
    workflow.stages.verify.output = { ...(workflow.stages.verify.output || {}), status };
    workflow.stages.verify.evidence = [...(workflow.stages.verify.evidence || []), ...evidence];
    await writeWorkflow(workflow);
    await appendEvent({
      taskId: workflow.taskId,
      type: status === "passed" ? "verification.passed" : status === "failed" ? "verification.failed" : "verification.started",
      payload: { status, evidence }
    });
    if (status === "passed") {
      await appendEvent({ taskId: workflow.taskId, type: "task.completed", payload: { task: workflow.task } });
    }
    return workflow;
  });
}

export async function appendEvent(event) {
  const taskId = event.taskId || await resolveTaskId(event.taskId).catch(() => null);
  if (!taskId) throw new Error("event.taskId is required");
  const entry = {
    version: 1,
    id: event.id || `event-${Date.now()}-${compactId(JSON.stringify(event))}`,
    taskId,
    source: event.source || "my-cc-lite",
    type: event.type,
    timestamp: event.timestamp || now(),
    payload: event.payload || {}
  };
  if (!entry.type) throw new Error("event.type is required");
  await fs.mkdir(resolveTaskDir(taskId), { recursive: true });
  await fs.appendFile(eventsPath(taskId), `${JSON.stringify(entry)}\n`);
  return entry;
}

export async function readEvents(taskId = null, limit = 20) {
  const resolvedTaskId = await resolveTaskId(taskId);
  try {
    const lines = (await fs.readFile(eventsPath(resolvedTaskId), "utf8")).split(/\r?\n/).filter(Boolean);
    const parsed = [];
    for (const line of lines.slice(-limit)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        parsed.push({ malformed: true, raw: line });
      }
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function summarize(taskId = null) {
  const workflow = await readWorkflow(await resolveTaskId(taskId));
  const completed = workflow.workItems.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status)).map((item) => item.id);
  const active = workflow.workItems.find((item) => item.status === "in_progress");
  const pending = workflow.workItems.filter((item) => item.status === "pending").map((item) => `${item.id} ${item.title}`);
  const summary = [
    "# my-cc-lite Session Summary",
    "",
    `- Task: ${workflow.task || "unknown"}.`,
    `- Task id: ${workflow.taskId}.`,
    `- Stage: ${workflow.currentStage}.`,
    `- Overall status: ${deriveOverallStatus(workflow)}.`,
    `- Completed: ${completed.length ? completed.join(", ") : "none"}.`,
    `- Active: ${active ? `${active.id} ${active.title}` : "none"}.`,
    `- Pending: ${pending.length ? pending.join("; ") : "none"}.`,
    `- Changed files: ${(workflow.changedFiles || []).length ? workflow.changedFiles.join(", ") : "none"}.`,
    `- Verification: ${verificationStatus(workflow)}.`,
    `- Blockers: ${(workflow.blockers || []).length ? workflow.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ") : "none"}.`,
    `- Next action: ${nextAction(workflow)}.`
  ].join("\n");
  await atomicWrite(summaryPath(workflow.taskId), `${summary}\n`);
  await appendEvent({
    taskId: workflow.taskId,
    type: "context.summary.added",
    payload: { path: summaryPath(workflow.taskId) }
  });
  return summary;
}

export function deriveOverallStatus(workflow) {
  if (!workflow) return "idle";
  if ((workflow.blockers || []).length || Object.values(workflow.stages).some((stage) => stage.status === "blocked")) return "blocked";
  if (workflow.stages.verify.status === "completed") return "done";
  if (workflow.stages.verify.status === "failed") return "verification_failed";
  if (workflow.currentStage === "plan" && workflow.stages.plan.status === "in_progress") return "planning";
  if (workflow.currentStage === "verify") return "verifying";
  if (workflow.workItems.some((item) => item.status === "in_progress")) return "executing";
  if (workflow.workItems.length) return "ready";
  return "planning";
}

export function nextAction(workflow) {
  if (!workflow) return "run /plan \"<task>\"";
  if (workflow.stages.plan.status !== "completed") return "finish the plan, then record work items";
  if ((workflow.blockers || []).length) return "resolve blockers or ask the user for the missing input";
  const active = workflow.workItems.find((item) => item.status === "in_progress");
  if (active) return `finish ${active.id}, then mark it completed or blocked`;
  const pending = workflow.workItems.find((item) => item.status === "pending");
  if (pending) return `run /do for ${pending.id}`;
  if (verificationStatus(workflow) !== "passed") return "run /verify";
  return "final response can cite verification evidence";
}

export function completionProblems(workflow) {
  if (!workflow || deriveOverallStatus(workflow) === "done") return [];
  const problems = [];
  const pending = workflow.workItems.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status));
  if (pending.length) problems.push(`Pending items: ${pending.map((item) => `${item.id} ${item.title}`).join("; ")}`);
  if (verificationStatus(workflow) !== "passed") problems.push(`Verification: ${verificationStatus(workflow)}`);
  if ((workflow.blockers || []).length) problems.push(`Blockers: ${workflow.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ")}`);
  return problems;
}

export function deriveSnapshot(workflow) {
  return {
    taskId: workflow.taskId,
    task: workflow.task,
    currentStage: workflow.currentStage,
    overallStatus: deriveOverallStatus(workflow),
    progress: {
      completed: workflow.workItems.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status)).length,
      total: workflow.workItems.length
    },
    activeItem: workflow.workItems.find((item) => item.status === "in_progress") || null,
    pendingItems: workflow.workItems.filter((item) => item.status === "pending"),
    verification: verificationStatus(workflow),
    blockers: workflow.blockers,
    changedFiles: workflow.changedFiles,
    nextAction: nextAction(workflow)
  };
}

export function statusText(workflow, events = []) {
  if (!workflow) {
    return [
      "Task: none",
      "Task id: none",
      "Stage: idle",
      "Progress: no active my-cc-lite task",
      "Verification: not started",
      "Next: run /plan \"<task>\""
    ].join("\n");
  }
  const snapshot = deriveSnapshot(workflow);
  const malformedEvents = events.filter((event) => event.malformed).length;
  return [
    `Task: ${snapshot.task || "unknown"}`,
    `Task id: ${snapshot.taskId}`,
    `Stage: ${snapshot.currentStage}`,
    `Overall: ${snapshot.overallStatus}`,
    `Progress: ${snapshot.progress.completed}/${snapshot.progress.total} items complete`,
    `Active: ${snapshot.activeItem ? `${snapshot.activeItem.id} ${snapshot.activeItem.title}` : "none"}`,
    `Verification: ${snapshot.verification}`,
    `Changed files: ${snapshot.changedFiles.length ? snapshot.changedFiles.join(", ") : "none"}`,
    `Blockers: ${snapshot.blockers.length ? snapshot.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ") : "none"}`,
    malformedEvents ? `Warnings: ${malformedEvents} malformed event line(s) ignored` : null,
    `Next: ${snapshot.nextAction}`
  ].filter(Boolean).join("\n");
}

export async function injectionText() {
  const workflow = await readCurrentWorkflow().catch(() => null);
  if (!workflow || deriveOverallStatus(workflow) === "done") return "";
  const config = await readConfig();
  const pending = workflow.workItems
    .filter((item) => item.status === "pending")
    .slice(0, config.maxInjectedItems)
    .map((item) => `${item.id} ${item.title}`);
  const active = workflow.workItems.find((item) => item.status === "in_progress");
  const summaryExists = existsSync(summaryPath(workflow.taskId));
  return [
    "my-cc-lite active task:",
    `- Task: ${workflow.task || "unknown"}`,
    `- Task id: ${workflow.taskId}`,
    `- Stage: ${workflow.currentStage}`,
    `- Overall status: ${deriveOverallStatus(workflow)}`,
    `- Current item: ${active ? `${active.id} ${active.title}` : "none"}`,
    `- Pending: ${pending.length ? pending.join("; ") : "none"}`,
    `- Verification: ${verificationStatus(workflow)}`,
    `- Recommended next action: ${nextAction(workflow)}`,
    (workflow.blockers || []).length ? `- Blockers: ${workflow.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ")}` : null,
    summaryExists ? `- Resume summary exists at ${summaryPath(workflow.taskId)}` : null
  ].filter(Boolean).join("\n");
}

function verificationProblems(workflow) {
  const problems = [];
  const pending = workflow.workItems.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status));
  if (pending.length) problems.push(`cannot pass verification with pending items: ${pending.map((item) => item.id).join(", ")}`);
  if ((workflow.blockers || []).length) problems.push(`cannot pass verification with blockers: ${workflow.blockers.map((blocker) => blocker.summary || blocker.itemId).join(", ")}`);
  return problems;
}

function verificationStatus(workflow) {
  if (workflow.stages.verify.status === "completed") return "passed";
  if (workflow.stages.verify.status === "failed") return "failed";
  if (workflow.stages.verify.status === "in_progress") return "in_progress";
  return "not_started";
}

function normalizeWorkItem(item, index) {
  const status = item.status || "pending";
  if (!ITEM_STATUSES.has(status)) throw new Error(`invalid work item status: ${status}`);
  return {
    id: item.id || `T${index + 1}`,
    title: item.title || item.summary || `Work item ${index + 1}`,
    status,
    owner: item.owner || "executor",
    evidence: item.evidence || [],
    updatedAt: item.updatedAt || now()
  };
}

function syncItemsToStages(workflow) {
  workflow.stages.plan.items = workflow.workItems;
  workflow.stages.do.items = workflow.workItems;
  workflow.stages.verify.items = workflow.workItems;
}

function normalizeError(error) {
  if (typeof error === "string") return { message: error, timestamp: now() };
  if (error && typeof error === "object") return { ...error, timestamp: error.timestamp || now() };
  return { message: "unknown error", timestamp: now() };
}

function normalizeProjectPath(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  let relative = path.relative(process.cwd(), absolute);
  if (relative.startsWith("..")) return null;
  relative = relative.split(path.sep).join("/");
  return relative === "" ? null : relative;
}
