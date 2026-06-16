import { appendFileSync } from "node:fs";
import path from "node:path";
import { formatLocalTimestamp } from "./format.mjs";
import { getCurrentTaskDir } from "./state.mjs";

export async function resolveHookLogDir(cwd) {
  const projectRoot = cwd || process.cwd();
  return getCurrentTaskDir(projectRoot).catch(() => null);
}

export function writeHookLog({ hook, event, label, fields = {}, rawContent = "", logDir }) {
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
    appendFileSync(hookLogPath(logDir), `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    console.error(`my-cc-lite ${hook} hook log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function hookLogPath(logDir) {
  if (logDir) return path.join(logDir, "hook.log");
  if (process.env.MY_CC_LITE_HOOK_LOG) return process.env.MY_CC_LITE_HOOK_LOG;
  return "my-cc-lite-hook.log";
}