#!/usr/bin/env node
import { injectionText } from "../scripts/my-cc-lite-state.mjs";

const text = await injectionText().catch((error) => `my-cc-lite: unable to read state (${error.message})`);
if (text) process.stdout.write(`${text}\n`);
