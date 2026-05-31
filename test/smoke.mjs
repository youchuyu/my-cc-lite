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

function runFail(args, options = {}) {
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
      if (code === 0) {
        reject(new Error(`command unexpectedly passed: ${args.join(" ")}\n${stdout}`));
        return;
      }
      resolve(stderr || stdout);
    });
    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

try {
  await run(["register-capability"], {
    stdin: JSON.stringify({
      provider: "review.example",
      type: "review",
      plugin: "my-cc-lite-review-example",
      description: "Example review provider"
    })
  });
  await run(["init-capabilities"], {
    stdin: JSON.stringify({
      inventory: {
        planning: {
          skills: [
            { name: "plan-hunter", kind: "skill", description: "Compare draft plans", invoke: "plan-hunter", source: "visible-context", confidence: "high" },
            { name: "my-cc-lite:plan", kind: "skill", description: "Create a my-cc-lite task-backed plan", invoke: "my-cc-lite:plan", source: "visible-context", confidence: "high" }
          ],
          agents: [
            { name: "Plan", kind: "agent", description: "Native planning agent", invoke: "Plan", source: "visible-context", confidence: "high" },
            { name: "strategy-reviewer", kind: "agent", description: "Review task strategy", invoke: "strategy-reviewer", source: "visible-context", confidence: "high" }
          ],
          tools: [
            { name: "WebSearch", kind: "tool", description: "Native web search", invoke: "WebSearch", source: "visible-context", confidence: "high" },
            { name: "codegraph_context", kind: "tool", description: "Collect code context", invoke: "mcp__codegraph.codegraph_context", source: "visible-context", confidence: "high" }
          ]
        },
        execution: {
          skills: [
            { name: "run", kind: "skill", description: "Native run helper", source: "visible-context", confidence: "high" },
            { name: "change-applier", kind: "skill", description: "Apply feature changes", source: "visible-context", confidence: "high" }
          ],
          agents: [
            { name: "general-purpose", kind: "agent", description: "Native task agent", source: "visible-context", confidence: "high" },
            { name: "workspace-runner", kind: "agent", description: "Execute workspace tasks", source: "visible-context", confidence: "high" }
          ],
          tools: [
            { name: "Bash", kind: "tool", description: "Native shell", source: "visible-context", confidence: "high" },
            { name: "browser_click", kind: "tool", description: "Click in browser", invoke: "mcp__browser__click", source: "visible-context", confidence: "high" }
          ]
        },
        review: {
          skills: [
            { name: "verify", kind: "skill", description: "Native verification helper", source: "visible-context", confidence: "high" },
            { name: "code-review", kind: "skill", description: "Review code changes", source: "visible-context", confidence: "high" }
          ],
          agents: [
            { name: "Explore", kind: "agent", description: "Native read-only agent", source: "visible-context", confidence: "high" }
          ],
          tools: [
            { name: "LSP", kind: "tool", description: "Native code intelligence", source: "visible-context", confidence: "high" },
            { name: "semgrep_scan", kind: "tool", description: "Scan changed code", invoke: "mcp__semgrep__scan", source: "visible-context", confidence: "high" }
          ]
        }
      }
    })
  });
  const capabilitiesPath = path.join(targetDir, ".my-cc-lite", "capabilities.json");
  const capabilities = JSON.parse(await readFile(capabilitiesPath, "utf8"));
  if (capabilities.source.kind !== "current-session-context") throw new Error("capability source was not normalized");
  if (capabilities.inventory.planning.skills[0]?.name !== "plan-hunter") throw new Error("planning skill inventory was not filtered");
  if (capabilities.inventory.planning.agents[0]?.name !== "strategy-reviewer") throw new Error("planning agent inventory was not filtered");
  if (!capabilities.inventory.planning.tools.length) throw new Error("planning tools inventory was not written");
  if (capabilities.inventory.planning.tools[0].invoke !== "mcp__codegraph.codegraph_context") throw new Error("capability invoke was not preserved");
  if (capabilities.inventory.execution.skills[0]?.name !== "change-applier") throw new Error("execution skills inventory was not filtered");
  if (capabilities.inventory.execution.agents[0]?.name !== "workspace-runner") throw new Error("execution agents inventory was not filtered");
  if (capabilities.inventory.execution.tools[0]?.invoke !== "mcp__browser__click") throw new Error("execution tools inventory was not filtered");
  if (capabilities.inventory.review.skills[0]?.name !== "code-review") throw new Error("review skills inventory was not filtered");
  if (capabilities.inventory.review.agents.length) throw new Error("native review agents were not filtered");
  if (capabilities.inventory.review.tools[0]?.invoke !== "mcp__semgrep__scan") throw new Error("review tools inventory was not filtered");
  const inventoryKeys = Object.values(capabilities.inventory)
    .flatMap((category) => Object.values(category))
    .flat()
    .flatMap((entry) => [entry.name, entry.invoke])
    .filter(Boolean);
  for (const excludedName of ["my-cc-lite:plan", "WebSearch", "Bash", "LSP", "general-purpose", "Explore", "verify", "run"]) {
    if (inventoryKeys.includes(excludedName)) throw new Error(`excluded capability remained in inventory: ${excludedName}`);
  }
  if (!capabilities.providers["review.example"]) throw new Error("existing provider was not preserved");
  const capabilitiesBeforeFailure = await readFile(capabilitiesPath, "utf8");
  await runFail(["init-capabilities"], { stdin: "not json" });
  const capabilitiesAfterFailure = await readFile(capabilitiesPath, "utf8");
  if (capabilitiesAfterFailure !== capabilitiesBeforeFailure) throw new Error("malformed capability init changed existing capabilities");

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
