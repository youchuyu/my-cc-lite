#!/usr/bin/env node
import { summarize } from "../scripts/my-cc-lite-state.mjs";

const summary = await summarize().catch((error) => `my-cc-lite: unable to summarize state (${error.message})`);
if (summary) process.stdout.write(`${summary}\n`);
