import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { StateError, validateProject } from "./schema.mjs";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 2000;

export function statePaths(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const stateRoot = path.join(resolvedRoot, ".my-cc-lite");
  return {
    projectRoot: resolvedRoot,
    stateRoot,
    projectPath: path.join(stateRoot, "project.json"),
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

export async function withStateLock(projectRoot, fn) {
  await ensureStateRoot(projectRoot);
  const { lockPath } = statePaths(projectRoot);
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
          operation: "init-project"
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
