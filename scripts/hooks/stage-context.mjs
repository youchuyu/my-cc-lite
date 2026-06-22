#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolveHookLogDir, writeHookLog } from "../lib/hook-log.mjs";
import { validateProject } from "../lib/schema.mjs";
import { getCurrentTaskDir, readProject, readTask } from "../lib/state.mjs";

const STAGES = new Set(["init", "plan", "do", "verify", "archive"]);
const CONTEXT_BUILDERS = {
  plan: buildPlanContext,
  do: buildDoContext,
  verify: buildVerifyContext,
  archive: () => "",
  init: () => "",
};

async function main() {
  const { input, rawContent } = readHookStdinJson();
  const eventName = input.hook_event_name || input.hookEventName;
  const expansionType = input.expansion_type || input.expansionType;
  const commandName = input.command_name || input.commandName;
  const stage = normalizeStage(commandName);
  const projectRoot = input.cwd || process.cwd();
  const taskDir = await resolveHookLogDir(projectRoot);
  writeHookLog({
    hook: "stage-context",
    event: eventName,
    label: "enter",
    fields: {
      expansion: expansionType,
      command: commandName,
      stage,
      cwd: input.cwd,
    },
    rawContent,
    logDir: taskDir,
  });

  if (
    eventName !== "UserPromptExpansion" ||
    expansionType !== "slash_command" ||
    !stage
  ) {
    return silentContinue();
  }

  const project = await readValidProject(projectRoot);
  if (!project) {
    return silentContinue();
  }

  const builder = CONTEXT_BUILDERS[stage];
  const context = builder ? await builder(project, projectRoot) : "";
  if (!context) {
    return silentContinue();
  }

  writeHookLog({
    hook: "stage-context",
    event: eventName,
    label: "context",
    fields: {
      expansion: expansionType,
      command: commandName,
      stage,
      cwd: projectRoot,
      contextLines: context.split("\n").length,
      context,
    },
    rawContent,
    logDir: taskDir,
  });
  return appendContext("UserPromptExpansion", context);
}

function buildPlanContext(project, _projectRoot) {
  const planningHelpers = selectStageHelpers(project, {
    sourceStage: "planning",
  });
  const executionSkills = selectStageHelpers(project, {
    sourceStage: "execution",
    type: "skill",
  });

  if (
    !project.projectSummary &&
    planningHelpers.length === 0 &&
    executionSkills.length === 0
  ) {
    return "";
  }

  const sections = [
    `- projectSummary: ${project.projectSummary}`,
    buildPlanningHelpersPrompt(planningHelpers),
    buildExecutionSkillsPrompt(executionSkills),
  ]
    .filter(Boolean)
    .join("\n");

  return sections;
}

function buildPlanningHelpersPrompt(planningHelpers) {
  if (planningHelpers.length === 0) {
    return "";
  }

  return [
    "- planning helpers:",
    ...planningHelpers.map((helper) => `${helper.name}`),
    "这些 planning helpers 可作为 /plan 阶段的参考能力。",
  ].join("\n");
}

function buildExecutionSkillsPrompt(executionSkills) {
  if (executionSkills.length === 0) {
    return "";
  }

  return [
    "- execution skills:",
    ...executionSkills.map((helper) => `  ${helper.name}`),
    "如果某个 execution skill 能直接承担或配合完成某个工作项，应在该工作项的 Do 中注明使用该 skill；不要在 /plan 阶段调用这些 skills。",
  ].join("\n");
}

async function buildDoContext(_project, projectRoot) {
  let taskDir;
  try {
    taskDir = await getCurrentTaskDir(projectRoot);
  } catch {
    return "";
  }
  if (!taskDir) {
    return "my-cc-lite /do Hooks注入状态:\n- task.exists: false";
  }
  const task = await readTask(taskDir).catch(() => null);
  if (!task) {
    return "my-cc-lite /do Hooks注入状态:\n- task.exists: false";
  }
  const taskLines = task.subtasks.map(
    (t) =>
      `  - ${t.id} [${t.status}]: "${t.title}"${t.statusReason ? ` (${t.statusReason})` : ""}`,
  );
  return [
    "my-cc-lite /do Hooks注入状态:",
    `- task.exists: true, status: ${task.status}, stage: ${task.stage}`,
    "- subtasks:",
    ...taskLines,
  ].join("\n");
}

async function buildVerifyContext(project, projectRoot) {
  let taskDir;
  try {
    taskDir = await getCurrentTaskDir(projectRoot);
  } catch {
    return "";
  }
  if (!taskDir) return "";
  const task = await readTask(taskDir).catch(() => null);
  if (!task) return "";
  const checkLines = task.subtasks.flatMap((t) => {
    const header = `  - ${t.id} [${t.status}]: "${t.title}"`;
    if (t.checks.length === 0) return [header];
    return [header, ...t.checks.map((c) => `    - ${c}`)];
  });
  return [
    "my-cc-lite /verify Hooks注入状态:",
    `- projectSummary: ${project.projectSummary}`,
    `- objective: ${task.objective}`,
    `- verification.status: ${task.verification.status}`,
    "- checks（subtasks[].checks[]）:",
    ...checkLines,
    "以上 checks[] 是首要验收标准；结合 projectSummary 判断哪些分组对当前项目有意义，按 reference/verification-plan.md 规则从前往后分组制定全量验证计划。",
  ].join("\n");
}

function selectStageHelpers(project, { sourceStage, type }) {
  return (project.stageHelpers?.[sourceStage] ?? [])
    .filter((helper) => !type || helper.type === type)
    .map(({ name, invoke, description }) => ({ name, invoke, description }));
}

async function readValidProject(projectRoot) {
  try {
    const project = await readProject(projectRoot);
    if (!project) return null;
    validateProject(project);
    return project;
  } catch {
    return null;
  }
}

function readHookStdinJson() {
  const content = readFileSync(0, "utf8");
  if (!content.trim()) {
    return {
      input: {},
      rawContent: "",
    };
  }
  try {
    return {
      input: JSON.parse(content),
      rawContent: content,
    };
  } catch {
    return {
      input: {},
      rawContent: content,
    };
  }
}

function normalizeStage(commandName) {
  const value = String(commandName || "").trim();
  if (!value.startsWith("my-cc-lite:")) return "";
  const stage = value.slice("my-cc-lite:".length);
  return STAGES.has(stage) ? stage : "";
}

function silentContinue() {
  return {
    continue: true,
    suppressOutput: true,
  };
}

function appendContext(hookEventName, message) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: message,
    },
  };
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
} catch {
  process.stdout.write(`${JSON.stringify(silentContinue(), null, 2)}\n`);
}
