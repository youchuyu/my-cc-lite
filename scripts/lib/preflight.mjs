import { access } from "node:fs/promises";
import path from "node:path";
import { StateError, validateProject } from "./schema.mjs";
import { getArchivedTaskDir, listActiveTaskDirs, readPlan, readProject, readTask } from "./state.mjs";

export async function readPreflightState(projectRoot) {
  const summary = {
    projectRoot: path.resolve(projectRoot),
    project: {
      exists: false,
      valid: false,
      errorCode: "",
      errorMessage: ""
    },
    activeTasks: {
      count: 0,
      taskId: "",
      taskDir: "",
      taskIds: []
    },
    plan: {
      exists: false,
      empty: false,
      errorCode: "",
      errorMessage: ""
    },
    task: {
      exists: false,
      valid: false,
      taskId: "",
      status: "",
      stage: "",
      verificationStatus: "",
      unfinishedTasks: [],
      completedCount: 0,
      allSkipped: false,
      errorCode: "",
      errorMessage: ""
    },
    archive: {
      targetExists: false
    }
  };

  await readProjectSummary(summary);
  await readActiveTaskSummary(summary);

  if (summary.activeTasks.count !== 1) {
    return summary;
  }

  await readPlanSummary(summary);
  await readTaskSummary(summary);
  await readArchiveTargetSummary(summary);

  return summary;
}

async function readProjectSummary(summary) {
  try {
    const project = await readProject(summary.projectRoot);
    if (!project) return;
    summary.project.exists = true;
    validateProject(project);
    summary.project.valid = true;
  } catch (error) {
    const normalized = normalizeError(error, "INVALID_PROJECT_STATE");
    summary.project.exists = true;
    summary.project.errorCode = normalized.code;
    summary.project.errorMessage = normalized.message;
  }
}

async function readActiveTaskSummary(summary) {
  try {
    const taskDirs = await listActiveTaskDirs(summary.projectRoot);
    summary.activeTasks.count = taskDirs.length;
    summary.activeTasks.taskIds = taskDirs.map((taskDir) => path.basename(taskDir));
    if (taskDirs.length === 1) {
      summary.activeTasks.taskDir = taskDirs[0];
      summary.activeTasks.taskId = path.basename(taskDirs[0]);
    }
  } catch (error) {
    const normalized = normalizeError(error, "INVALID_PROJECT_STATE");
    summary.activeTasks.errorCode = normalized.code;
    summary.activeTasks.errorMessage = normalized.message;
  }
}

async function readPlanSummary(summary) {
  try {
    await readPlan(summary.activeTasks.taskDir);
    summary.plan.exists = true;
  } catch (error) {
    const normalized = normalizeError(error, "PLAN_NOT_FOUND");
    summary.plan.errorCode = normalized.code;
    summary.plan.errorMessage = normalized.message;
    if (normalized.code === "PLAN_NOT_FOUND" && normalized.message.includes("empty")) {
      summary.plan.exists = true;
      summary.plan.empty = true;
    }
  }
}

async function readTaskSummary(summary) {
  try {
    const task = await readTask(summary.activeTasks.taskDir);
    if (!task) return;
    summary.task.exists = true;
    summary.task.valid = true;
    summary.task.taskId = task.taskId;
    summary.task.status = task.status;
    summary.task.stage = task.stage;
    summary.task.verificationStatus = task.verification.status;
    summary.task.unfinishedTasks = task.tasks
      .filter((entry) => !["completed", "skipped"].includes(entry.status))
      .map((entry) => ({
        id: entry.id,
        status: entry.status
      }));
    summary.task.completedCount = task.tasks.filter((entry) => entry.status === "completed").length;
    summary.task.allSkipped = task.tasks.length > 0 && task.tasks.every((entry) => entry.status === "skipped");
  } catch (error) {
    const normalized = normalizeError(error, "INVALID_TASK_STATE");
    summary.task.exists = true;
    summary.task.errorCode = normalized.code;
    summary.task.errorMessage = normalized.message;
  }
}

async function readArchiveTargetSummary(summary) {
  const taskId = summary.task.taskId || summary.activeTasks.taskId;
  if (!taskId) return;
  const archivedDir = getArchivedTaskDir(summary.projectRoot, taskId);
  try {
    await access(archivedDir);
    summary.archive.targetExists = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      const normalized = normalizeError(error, "INVALID_PROJECT_STATE");
      summary.archive.errorCode = normalized.code;
      summary.archive.errorMessage = normalized.message;
    }
  }
}

function normalizeError(error, fallbackCode) {
  if (error instanceof StateError) {
    return {
      code: error.code,
      message: error.message
    };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error)
  };
}
