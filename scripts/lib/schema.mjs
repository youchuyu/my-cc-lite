const STAGE_NAMES = ["planning", "execution", "review"];
const HELPER_TYPES = new Set(["skill", "agent", "tool"]);
const TASK_STATUSES = new Set(["pending", "in_progress", "completed", "failed", "blocked", "skipped"]);
const TOP_LEVEL_TASK_STATUSES = new Set(["active", "blocked", "verified", "archived"]);
const TASK_STAGES = new Set(["executing", "verifying", "verified", "archived"]);
const DENYLIST = new Set(
  [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "WebSearch",
    "WebFetch",
    "TodoWrite",
    "Task",
    "general-purpose",
    "Plan",
    "Explore",
    "init",
    "plan",
    "do",
    "verify",
    "status",
    "archive",
    "planner",
    "executor",
    "verifier",
    "my-cc-lite:init",
    "my-cc-lite:plan",
    "my-cc-lite:do",
    "my-cc-lite:verify",
    "my-cc-lite:status",
    "my-cc-lite:archive"
  ].map(normalizeToken)
);

export class StateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StateError";
    this.code = code;
  }
}

export function normalizeInitInput(input) {
  if (!isPlainObject(input)) {
    throw new StateError("INVALID_INPUT", "init-project input must be a JSON object.");
  }
  if (Object.hasOwn(input, "providers") || Object.hasOwn(input, "inventory") || Object.hasOwn(input, "capabilities")) {
    throw new StateError("INVALID_INPUT", "init-project input must use stageHelpers, not a full capability inventory.");
  }
  const projectSummary = normalizeRequiredString(input.projectSummary, "projectSummary");
  const stageHelpers = normalizeStageHelpers(input.stageHelpers ?? {});
  return {
    projectSummary,
    stageHelpers: filterStageHelpers(stageHelpers)
  };
}

export function normalizePlanInput(input) {
  if (!isPlainObject(input)) {
    throw new StateError("INVALID_INPUT", "create-task input must be a JSON object.");
  }
  const objective = normalizeRequiredString(input.objective, "objective");
  const planMarkdown = normalizeRequiredString(input.planMarkdown, "planMarkdown").trimEnd();
  if (!planMarkdown.includes("## Objective")) {
    throw new StateError("INVALID_INPUT", "planMarkdown must include a ## Objective section.");
  }
  if (!planMarkdown.includes("## Plan")) {
    throw new StateError("INVALID_INPUT", "planMarkdown must include a ## Plan section.");
  }
  return {
    objective,
    planMarkdown
  };
}

export function normalizeDoMaterializeInput(input) {
  if (!isPlainObject(input)) {
    throw new StateError("INVALID_INPUT", "materialize input must be a JSON object.");
  }
  const objective = normalizeRequiredString(input.objective, "objective");
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    throw new StateError("INVALID_INPUT", "tasks must be a non-empty array.");
  }
  const seen = new Set();
  const tasks = input.tasks.map((entry, index) => {
    const task = normalizeTaskEntry(entry, "INVALID_INPUT");
    if (task.status !== "pending") {
      throw new StateError("INVALID_INPUT", `tasks[${index}].status must be pending.`);
    }
    if (seen.has(task.id)) {
      throw new StateError("INVALID_INPUT", `Duplicate task id: ${task.id}.`);
    }
    seen.add(task.id);
    return task;
  });
  return {
    objective,
    tasks
  };
}

export function normalizeDoTaskPatch(input) {
  if (!isPlainObject(input)) {
    throw new StateError("INVALID_INPUT", "update-task input must be a JSON object.");
  }
  for (const key of Object.keys(input)) {
    if (!["id", "status", "statusReason"].includes(key)) {
      throw new StateError("INVALID_INPUT", `Unsupported update-task field: ${key}.`);
    }
  }
  const id = normalizeRequiredString(input.id, "id");
  const status = normalizeRequiredString(input.status, "status");
  if (!TASK_STATUSES.has(status)) {
    throw new StateError("INVALID_INPUT", `status must be one of: ${[...TASK_STATUSES].join(", ")}.`);
  }
  const statusReason = typeof input.statusReason === "string" ? input.statusReason.trim() : "";
  if (["blocked", "failed", "skipped"].includes(status) && !statusReason) {
    throw new StateError("INVALID_INPUT", `statusReason is required when status is ${status}.`);
  }
  return {
    id,
    status,
    statusReason
  };
}

export function validateProject(project) {
  if (!isPlainObject(project)) {
    throw new StateError("INVALID_PROJECT_STATE", "project must be a JSON object.");
  }
  normalizeRequiredString(project.initializedAt, "initializedAt", "INVALID_PROJECT_STATE");
  normalizeRequiredString(project.updatedAt, "updatedAt", "INVALID_PROJECT_STATE");
  const projectRoot = normalizeRequiredString(project.projectRoot, "projectRoot", "INVALID_PROJECT_STATE");
  if (!projectRoot.startsWith("/")) {
    throw new StateError("INVALID_PROJECT_STATE", "projectRoot must be an absolute path.");
  }
  normalizeRequiredString(project.projectSummary, "projectSummary", "INVALID_PROJECT_STATE");
  normalizeStageHelpers(project.stageHelpers, "INVALID_PROJECT_STATE");
  return project;
}

export function validateTask(task) {
  if (!isPlainObject(task)) {
    throw new StateError("INVALID_TASK_STATE", "task.json must be a JSON object.");
  }
  normalizeRequiredString(task.taskId, "taskId", "INVALID_TASK_STATE");
  normalizeRequiredString(task.objective, "objective", "INVALID_TASK_STATE");
  const status = normalizeRequiredString(task.status, "status", "INVALID_TASK_STATE");
  if (!TOP_LEVEL_TASK_STATUSES.has(status)) {
    throw new StateError("INVALID_TASK_STATE", `task status must be one of: ${[...TOP_LEVEL_TASK_STATUSES].join(", ")}.`);
  }
  const stage = normalizeRequiredString(task.stage, "stage", "INVALID_TASK_STATE");
  if (!TASK_STAGES.has(stage)) {
    throw new StateError("INVALID_TASK_STATE", `task stage must be one of: ${[...TASK_STAGES].join(", ")}.`);
  }
  normalizeRequiredString(task.createdAt, "createdAt", "INVALID_TASK_STATE");
  normalizeRequiredString(task.updatedAt, "updatedAt", "INVALID_TASK_STATE");
  if (!Array.isArray(task.tasks) || task.tasks.length === 0) {
    throw new StateError("INVALID_TASK_STATE", "tasks must be a non-empty array.");
  }
  const seen = new Set();
  for (const entry of task.tasks) {
    const normalized = validateTaskEntry(entry, "INVALID_TASK_STATE");
    if (seen.has(normalized.id)) {
      throw new StateError("INVALID_TASK_STATE", `Duplicate task id: ${normalized.id}.`);
    }
    seen.add(normalized.id);
  }
  if (!isPlainObject(task.verification)) {
    throw new StateError("INVALID_TASK_STATE", "verification must be a JSON object.");
  }
  normalizeRequiredString(task.verification.status, "verification.status", "INVALID_TASK_STATE");
  if (typeof task.verification.summary !== "string") {
    throw new StateError("INVALID_TASK_STATE", "verification.summary must be a string.");
  }
  if (!isPlainObject(task.archive)) {
    throw new StateError("INVALID_TASK_STATE", "archive must be a JSON object.");
  }
  if (typeof task.archive.summary !== "string") {
    throw new StateError("INVALID_TASK_STATE", "archive.summary must be a string.");
  }
  if (task.archive.archivedAt !== null && typeof task.archive.archivedAt !== "string") {
    throw new StateError("INVALID_TASK_STATE", "archive.archivedAt must be null or a string.");
  }
  return task;
}

export function validateTaskEntry(entry, code = "INVALID_TASK_STATE") {
  return normalizeTaskEntry(entry, code);
}

export function validateSteps(steps, code = "INVALID_TASK_STATE") {
  if (!Array.isArray(steps)) {
    throw new StateError(code, "steps must be an array.");
  }
  return steps.map((step) => normalizeStep(step, code));
}

export function validateChecks(checks, code = "INVALID_TASK_STATE") {
  if (!Array.isArray(checks)) {
    throw new StateError(code, "checks must be an array.");
  }
  return checks.map((check) => normalizeRequiredString(check, "check", code));
}

export function summarizeTask(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusReason: task.statusReason || ""
  };
}

export function assertInitializedProject(project) {
  if (!project) {
    throw new StateError("PROJECT_NOT_INITIALIZED", "Project is not initialized. Run /init before /plan.");
  }
  validateProject(project);
  return project;
}

export function assertNoActiveTask(activeTaskDirs) {
  if (!Array.isArray(activeTaskDirs)) {
    throw new StateError("INVALID_PROJECT_STATE", "activeTaskDirs must be an array.");
  }
  if (activeTaskDirs.length === 0) return;
  if (activeTaskDirs.length === 1) {
    throw new StateError(
      "ACTIVE_TASK_EXISTS",
      "已有未归档任务。请先查看 /status，继续 /do 或 /verify，或者用 /archive 关闭当前任务后再创建新计划。"
    );
  }
  throw new StateError("MULTIPLE_ACTIVE_TASKS", "Multiple active task directories exist.");
}

export function filterStageHelpers(stageHelpers) {
  const filtered = emptyStageHelpers();
  for (const stage of STAGE_NAMES) {
    const seen = new Set();
    for (const helper of stageHelpers[stage]) {
      const normalized = normalizeHelper(helper);
      if (isDeniedHelper(normalized)) continue;
      const key = `${normalized.type}:${normalized.invoke}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered[stage].push(normalized);
    }
  }
  return filtered;
}

function normalizeStageHelpers(value, code = "INVALID_INPUT") {
  if (!isPlainObject(value)) {
    throw new StateError(code, "stageHelpers must be a JSON object.");
  }
  const normalized = emptyStageHelpers();
  for (const stage of STAGE_NAMES) {
    const helpers = value[stage] ?? [];
    if (!Array.isArray(helpers)) {
      throw new StateError(code, `stageHelpers.${stage} must be an array.`);
    }
    normalized[stage] = helpers.map(normalizeHelper);
  }
  return normalized;
}

function normalizeHelper(helper) {
  if (!isPlainObject(helper)) {
    throw new StateError("INVALID_INPUT", "stage helper must be a JSON object.");
  }
  const name = normalizeRequiredString(helper.name, "helper.name");
  const type = normalizeRequiredString(helper.type, "helper.type");
  const invoke = normalizeRequiredString(helper.invoke, "helper.invoke");
  const description = normalizeRequiredString(helper.description, "helper.description");
  if (!HELPER_TYPES.has(type)) {
    throw new StateError("INVALID_INPUT", `helper.type must be one of: ${[...HELPER_TYPES].join(", ")}.`);
  }
  return { name, type, invoke, description };
}

function normalizeTaskEntry(entry, code) {
  if (!isPlainObject(entry)) {
    throw new StateError(code, "task entry must be a JSON object.");
  }
  const id = normalizeRequiredString(entry.id, "task.id", code);
  const title = normalizeRequiredString(entry.title, "task.title", code);
  const status = normalizeTaskStatus(entry.status ?? "pending", code);
  const steps = validateSteps(entry.steps ?? [], code);
  const checks = validateChecks(entry.checks ?? [], code);
  const statusReason = typeof entry.statusReason === "string" ? entry.statusReason.trim() : "";
  if (["blocked", "failed", "skipped"].includes(status) && !statusReason) {
    throw new StateError(code, `statusReason is required when task ${id} status is ${status}.`);
  }
  return {
    id,
    title,
    status,
    steps,
    checks,
    statusReason
  };
}

function normalizeTaskStatus(value, code) {
  const status = normalizeRequiredString(value, "task.status", code);
  if (!TASK_STATUSES.has(status)) {
    throw new StateError(code, `task.status must be one of: ${[...TASK_STATUSES].join(", ")}.`);
  }
  return status;
}

function normalizeStep(step, code) {
  if (typeof step === "string") {
    return normalizeRequiredString(step, "step", code);
  }
  if (!isPlainObject(step)) {
    throw new StateError(code, "step must be a string or a step group.");
  }
  for (const key of Object.keys(step)) {
    if (!["title", "steps"].includes(key)) {
      throw new StateError(code, `Unsupported step field: ${key}.`);
    }
  }
  return {
    title: normalizeRequiredString(step.title, "step.title", code),
    steps: validateSteps(step.steps, code)
  };
}

function normalizeRequiredString(value, fieldName, code = "INVALID_INPUT") {
  if (typeof value !== "string" || !value.trim()) {
    throw new StateError(code, `${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function emptyStageHelpers() {
  return {
    planning: [],
    execution: [],
    review: []
  };
}

function isDeniedHelper(helper) {
  return DENYLIST.has(normalizeToken(helper.name)) || DENYLIST.has(normalizeToken(helper.invoke));
}

function normalizeToken(value) {
  return String(value).trim().toLowerCase();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
