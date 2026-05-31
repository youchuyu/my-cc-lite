#!/usr/bin/env node
import { completionProblems, nextAction, readState } from "../scripts/my-cc-lite-state.mjs";

const state = await readState().catch(() => null);
const problems = completionProblems(state);
if (!state || !problems.length) process.exit(0);

const strict = state.strictness === "strict";
process.stdout.write([
  `my-cc-lite: This run is not fully complete${strict ? " (strict mode)" : ""}.`,
  ...problems.map((problem) => `- ${problem}`),
  `Recommended next action: ${nextAction(state)}.`
].join("\n") + "\n");
