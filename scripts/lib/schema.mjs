const STAGE_NAMES = ["planning", "execution", "review"];
const HELPER_TYPES = new Set(["skill", "agent", "tool"]);
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
