#!/usr/bin/env node
import {
  addEvidence,
  readWorkflow,
  resolveTaskId,
  setVerificationStatus,
  startExistingStage
} from "../my-cc-lite-workflow-parser.mjs";
import { readStdinJson } from "../my-cc-lite-state.mjs";

const status = process.argv[2] || "passed";
if (!["passed", "failed", "not_started"].includes(status)) {
  process.stderr.write("my-cc-lite: usage: stages/verify.mjs <passed|failed|not_started> [--task <taskId>]\n");
  process.exit(1);
}

const taskId = parseTaskId(process.argv.slice(3));
const resolvedTaskId = await resolveTaskId(taskId);
await startExistingStage(resolvedTaskId, "verify");

const input = await readStdinJson();
if (Array.isArray(input.evidence)) {
  for (const evidence of input.evidence) await addEvidence(evidence, resolvedTaskId);
} else if (input.summary || input.command || input.path) {
  await addEvidence(input, resolvedTaskId);
}

await setVerificationStatus(status, [], resolvedTaskId);
process.stdout.write(`${JSON.stringify(await readWorkflow(resolvedTaskId), null, 2)}\n`);

function parseTaskId(args) {
  const index = args.indexOf("--task");
  return index >= 0 ? args[index + 1] : null;
}
