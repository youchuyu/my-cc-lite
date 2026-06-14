import { appendFileSync } from "node:fs";
import { formatLocalTimestamp } from "./format.mjs";

export function writeHookLog({ hook, event, label, fields = {}, rawContent = "" }) {
  const lines = [
    `time: ${formatLocalTimestamp()}`,
    `hook: ${hook}`,
    event ? `event: ${event}` : null,
    label ? `label: ${label}` : null,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v ?? ""}`),
    "input:",
    rawContent || "",
    "---"
  ].filter(Boolean);

  try {
    appendFileSync(hookLogPath(), `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    console.error(`my-cc-lite ${hook} hook log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function hookLogPath() {
  return process.env.MY_CC_LITE_HOOK_LOG || "my-cc-lite-hook.log";
}