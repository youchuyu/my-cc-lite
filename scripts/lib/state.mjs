import { access, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { StateError, validateProject, validateTask } from "./schema.mjs";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 2000;

export function statePaths(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const stateRoot = path.join(resolvedRoot, ".my-cc-lite");
  return {
    projectRoot: resolvedRoot,
    stateRoot,
    projectPath: path.join(stateRoot, "project.json"),
    tasksRoot: path.join(stateRoot, "tasks"),
    archivedTasksRoot: path.join(stateRoot, "archived_tasks"),
    lockPath: path.join(stateRoot, "state.lock")
  };
}

export async function ensureStateRoot(projectRoot) {
  const { stateRoot } = statePaths(projectRoot);
  await mkdir(stateRoot, { recursive: true });
}

export async function readProject(projectRoot) {
  const { projectPath } = statePaths(projectRoot);
  let content;
  try {
    content = await readFile(projectPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new StateError("INVALID_PROJECT_STATE", "project.json is not valid JSON.");
  }
}

export async function writeProject(projectRoot, project) {
  validateProject(project);
  const { projectPath } = statePaths(projectRoot);
  const tempPath = `${projectPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await rename(tempPath, projectPath);
}

export async function listActiveTaskDirs(projectRoot) {
  const { tasksRoot } = statePaths(projectRoot);
  let entries;
  try {
    entries = await readdir(tasksRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tasksRoot, entry.name))
    .sort();
}

export async function getCurrentTaskDir(projectRoot) {
  const taskDirs = await listActiveTaskDirs(projectRoot);
  if (taskDirs.length === 0) return null;
  if (taskDirs.length === 1) return taskDirs[0];
  throw new StateError("MULTIPLE_ACTIVE_TASKS", "Multiple active task directories exist.");
}

export async function createTaskDir(projectRoot, taskId) {
  const { tasksRoot } = statePaths(projectRoot);
  await mkdir(tasksRoot, { recursive: true });
  const taskDir = path.join(tasksRoot, taskId);
  try {
    await mkdir(taskDir);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new StateError("TASK_ID_COLLISION", `Task directory already exists: ${taskId}.`);
    }
    throw error;
  }
  return taskDir;
}

export function getArchivedTaskDir(projectRoot, taskId) {
  const { archivedTasksRoot } = statePaths(projectRoot);
  return path.join(archivedTasksRoot, taskId);
}

export async function archiveTaskDir(projectRoot, taskId) {
  const { tasksRoot, archivedTasksRoot } = statePaths(projectRoot);
  const sourceDir = path.join(tasksRoot, taskId);
  const archivedDir = getArchivedTaskDir(projectRoot, taskId);
  await mkdir(archivedTasksRoot, { recursive: true });
  try {
    await access(archivedDir);
    throw new StateError("ARCHIVE_TARGET_EXISTS", `Archived task directory already exists: ${taskId}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rename(sourceDir, archivedDir);
  return archivedDir;
}

export async function writePlan(taskDir, markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new StateError("INVALID_INPUT", "planMarkdown must be a non-empty string.");
  }
  const planPath = path.join(taskDir, "plan.md");
  const tempPath = `${planPath}.tmp-${process.pid}-${Date.now()}`;
  const content = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, planPath);
  return planPath;
}

export async function readPlan(taskDir) {
  const planPath = path.join(taskDir, "plan.md");
  let content;
  try {
    content = await readFile(planPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new StateError("PLAN_NOT_FOUND", "Current task is missing plan.md.");
    }
    throw error;
  }
  if (!content.trim()) {
    throw new StateError("PLAN_NOT_FOUND", "Current task plan.md is empty.");
  }
  return content;
}

export async function readTask(taskDir) {
  const taskPath = path.join(taskDir, "task.json");
  let content;
  try {
    content = await readFile(taskPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    return validateTask(JSON.parse(content));
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError("INVALID_TASK_STATE", "task.json is not valid JSON.");
  }
}

export async function writeTask(taskDir, task) {
  validateTask(task);
  const taskPath = path.join(taskDir, "task.json");
  const tempPath = `${taskPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await rename(tempPath, taskPath);
  return taskPath;
}

export async function withStateLock(projectRoot, fn, options = {}) {
  await ensureStateRoot(projectRoot);
  const { lockPath } = statePaths(projectRoot);
  const operation = options.operation || "init-project";
  const start = Date.now();
  let handle = null;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - start >= LOCK_TIMEOUT_MS) {
        throw new StateError("LOCK_TIMEOUT", "Timed out waiting for .my-cc-lite/state.lock.");
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          operation
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await handle.close();
    handle = null;
    return await fn();
  } finally {
    if (handle) await handle.close();
    await rm(lockPath, { force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
