#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(pluginRoot, "scripts", "my-cc-lite-state.mjs");
const targetDir = await mkdtemp(path.join(os.tmpdir(), "my-cc-lite-smoke-"));

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, ...args], {
      cwd: targetDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`command failed: ${args.join(" ")}\n${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });
    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

try {
  await run(["plan-start", "smoke test"]);
  await run(["set-work-items"], {
    stdin: JSON.stringify([
      { id: "T1", title: "Create standalone state", status: "pending", owner: "executor", evidence: [] }
    ])
  });
  await run(["set-work-item", "T1", "in_progress"]);
  await run(["add-changed-file", "README.md"]);
  await run(["set-work-item", "T1", "completed", "state helper smoke path passed"]);
  await run(["add-evidence"], {
    stdin: JSON.stringify({
      source: "smoke",
      summary: "state helper works from plugin path against target cwd",
      status: "passed",
      command: "npm run smoke"
    })
  });
  await run(["set-verification", "passed"]);

  const pointer = JSON.parse(await readFile(path.join(targetDir, ".my-cc-lite", "current-task.json"), "utf8"));
  const workflowPath = path.join(targetDir, ".my-cc-lite", "tasks", pointer.currentTaskId, "workflow.json");
  const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
  if (workflow.version !== 1) throw new Error(`expected workflow version 1, got ${workflow.version}`);
  if (workflow.stages.verify.status !== "completed") throw new Error(`expected completed verify stage, got ${workflow.stages.verify.status}`);
  if (!workflow.changedFiles.includes("README.md")) throw new Error("changed file was not recorded");

  await run(["plan-start", "second smoke task"]);
  const secondPointer = JSON.parse(await readFile(path.join(targetDir, ".my-cc-lite", "current-task.json"), "utf8"));
  if (secondPointer.currentTaskId === pointer.currentTaskId) throw new Error("plan-start reused an existing task id");

  process.stdout.write(`smoke passed: ${targetDir}\n`);
} finally {
  await rm(targetDir, { recursive: true, force: true });
}
