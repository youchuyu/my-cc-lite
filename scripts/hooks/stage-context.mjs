#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { validateProject } from "../lib/schema.mjs";
import { readProject } from "../lib/state.mjs";

const STAGES = new Set(["init", "plan", "do", "verify", "archive"]);
const CONTEXT_BUILDERS = {
  plan: buildPlanContext,
  do: () => "",
  verify: () => "",
  archive: () => "",
  init: () => ""
};

async function main() {
  const { input } = readHookStdinJson();
  const eventName = input.hook_event_name || input.hookEventName;
  const expansionType = input.expansion_type || input.expansionType;
  const commandName = input.command_name || input.commandName;
  const stage = normalizeStage(commandName);

  if (eventName !== "UserPromptExpansion" || expansionType !== "slash_command" || !stage) {
    return silentContinue();
  }

  const project = await readValidProject(input.cwd || process.cwd());
  if (!project) {
    return silentContinue();
  }

  const builder = CONTEXT_BUILDERS[stage];
  const context = builder ? builder(project) : "";
  if (!context) {
    return silentContinue();
  }

  return appendContext("UserPromptExpansion", context);
}

function buildPlanContext(project) {
  const executionSkills = selectStageHelpers(project, {
    sourceStage: "execution",
    type: "skill"
  });
  if (executionSkills.length === 0) {
    return "";
  }

  return [
    "my-cc-lite plan context: 当前项目声明了后续 /do 可选使用的 execution skills。",
    "",
    "在 /plan 阶段，如果某个 skill 明确适合某个计划项，可以把它写入 plan.md 作为执行建议。不要在 /plan 阶段调用这些 skills，也不要把它们写成必须执行的路由。",
    "",
    "可选 execution skills：",
    ...executionSkills.map((helper) => `- ${helper.name}: ${helper.description}`)
  ].join("\n");
}

function selectStageHelpers(project, { sourceStage, type }) {
  return (project.stageHelpers?.[sourceStage] ?? [])
    .filter((helper) => helper.type === type)
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
      input: {}
    };
  }
  try {
    return {
      input: JSON.parse(content)
    };
  } catch {
    return {
      input: {}
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
    suppressOutput: true
  };
}

function appendContext(hookEventName, message) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: message
    }
  };
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
} catch {
  process.stdout.write(`${JSON.stringify(silentContinue(), null, 2)}\n`);
}
