#!/usr/bin/env node
import {
  readWorkflow,
  setWorkItems,
  startPlanTask
} from "../my-cc-lite-workflow-parser.mjs";
import { readStdinJson } from "../my-cc-lite-state.mjs";

const task = process.argv.slice(2).join(" ").trim();
if (!task) {
  process.stderr.write("my-cc-lite: usage: stages/plan.mjs <task>\n");
  process.exit(1);
}

const input = await readStdinJson();
const workflow = await startPlanTask(task, {
  plan: typeof input.plan === "string" ? input.plan : undefined
});

if (Array.isArray(input.items)) {
  await setWorkItems(input.items, workflow.taskId);
}

process.stdout.write(`${JSON.stringify(await readWorkflow(workflow.taskId), null, 2)}\n`);
