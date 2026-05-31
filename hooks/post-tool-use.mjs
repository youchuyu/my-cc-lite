#!/usr/bin/env node
import { addChangedFile, appendEvent, extractChangedFiles, readState, readStdinJson } from "../scripts/my-cc-lite-state.mjs";

const input = await readStdinJson();
const state = await readState().catch(() => null);
if (!state || state.phase === "done" || state.phase === "idle") process.exit(0);

const files = extractChangedFiles(input);
for (const file of files) {
  await addChangedFile(file, "my-cc-lite-hook").catch(() => {});
}

const toolName = input.tool_name || input.toolName || input.name || input.tool || "unknown";
const failed = Boolean(input.error || input.failure || input.is_error);
await appendEvent({
  runId: state.runId,
  source: "my-cc-lite-hook",
  type: failed ? "tool.failed" : "tool.succeeded",
  payload: {
    tool: toolName,
    changedFiles: files
  }
}).catch(() => {});
