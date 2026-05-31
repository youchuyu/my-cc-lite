#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATE_DIR = ".my-cc-lite";
const STATE_PATH = path.join(STATE_DIR, "state.json");
const PLAN_PATH = path.join(STATE_DIR, "plan.md");
const EVENTS_PATH = path.join(STATE_DIR, "events.jsonl");
const SUMMARY_PATH = path.join(STATE_DIR, "session-summary.md");
const CAPABILITIES_PATH = path.join(STATE_DIR, "capabilities.json");
const CONFIG_PATH = path.join(STATE_DIR, "config.json");
const LOCK_PATH = path.join(STATE_DIR, "state.lock");

const VALID_PHASES = new Set(["idle", "planning", "ready", "executing", "verifying", "blocked", "done"]);
const TERMINAL_ITEM_STATUSES = new Set(["completed", "skipped", "not_applicable"]);

function now() {
  return new Date().toISOString();
}

function compactId(input) {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function slug(input) {
  return String(input || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "task";
}

function runIdFor(task) {
  return `${now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${slug(task)}-${compactId(task + now())}`;
}

async function ensureStateDir() {
  await fs.mkdir(path.join(STATE_DIR, "artifacts"), { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function atomicWrite(filePath, data) {
  await ensureStateDir();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

async function withStateLock(work) {
  await ensureStateDir();
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(LOCK_PATH, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 5000) {
        await fs.rm(LOCK_PATH, { force: true }).catch(() => {});
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n${now()}\n`);
    return await work();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(LOCK_PATH, { force: true }).catch(() => {});
  }
}

export async function readConfig() {
  const config = await readJson(CONFIG_PATH, {});
  return {
    version: 1,
    strictness: "soft",
    verificationRequired: true,
    autoPlanWhenMissing: true,
    autoSummarizeBeforeCompact: true,
    maxInjectedItems: 5,
    ...config
  };
}

export async function readState() {
  const state = await readJson(STATE_PATH, null);
  if (!state) return null;
  validateState(state);
  return state;
}

export function validateState(state) {
  if (!state || typeof state !== "object") {
    throw new Error("state must be an object");
  }
  if (state.version !== 1) {
    throw new Error("state.version must be 1");
  }
  if (!state.runId) {
    throw new Error("state.runId is required");
  }
  if (!VALID_PHASES.has(state.phase)) {
    throw new Error(`state.phase is invalid: ${state.phase}`);
  }
  if (!Array.isArray(state.items)) {
    throw new Error("state.items must be an array");
  }
  if (!state.verification || typeof state.verification !== "object") {
    throw new Error("state.verification is required");
  }
}

export async function writeState(state) {
  state.updatedAt = now();
  validateState(state);
  await atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export async function initState(task, options = {}) {
  const state = await withStateLock(async () => {
    const config = await readConfig();
    const createdAt = now();
    const next = {
      version: 1,
      runId: runIdFor(task),
      task,
      phase: options.phase || "planning",
      strictness: options.strictness || config.strictness,
      createdAt,
      updatedAt: createdAt,
      plan: {
        path: PLAN_PATH,
        accepted: Boolean(options.accepted),
        updatedAt: createdAt
      },
      items: options.items || [],
      changedFiles: [],
      verification: {
        required: config.verificationRequired !== false,
        status: "not_started",
        evidence: []
      },
      blockers: [],
      extensions: {}
    };
    await writeState(next);
    return next;
  });
  await ensureCapabilities();
  await appendEvent({
    runId: state.runId,
    source: "my-cc-lite",
    type: "run.created",
    payload: { task }
  });
  return state;
}

export async function ensureCapabilities() {
  const existing = await readJson(CAPABILITIES_PATH, null);
  if (existing) return existing;
  const capabilities = {
    version: 1,
    providers: {}
  };
  await atomicWrite(CAPABILITIES_PATH, `${JSON.stringify(capabilities, null, 2)}\n`);
  return capabilities;
}

export async function appendEvent(event) {
  await ensureStateDir();
  const state = await readJson(STATE_PATH, null);
  const entry = {
    version: 1,
    id: event.id || `event-${Date.now()}-${compactId(JSON.stringify(event))}`,
    runId: event.runId || state?.runId || "unknown",
    source: event.source || "my-cc-lite",
    type: event.type,
    timestamp: event.timestamp || now(),
    payload: event.payload || {}
  };
  if (!entry.type) throw new Error("event.type is required");
  await fs.appendFile(EVENTS_PATH, `${JSON.stringify(entry)}\n`);
  return entry;
}

export async function readEvents(limit = 20) {
  try {
    const lines = (await fs.readFile(EVENTS_PATH, "utf8")).split(/\r?\n/).filter(Boolean);
    const parsed = [];
    for (const line of lines.slice(-limit)) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        parsed.push({ malformed: true, raw: line });
      }
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function setItemStatus(itemId, status, evidence = []) {
  const state = await withStateLock(async () => {
    const next = await requireState();
    const item = next.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`item not found: ${itemId}`);
    item.status = status;
    item.evidence = Array.from(new Set([...(item.evidence || []), ...evidence]));
    if (status === "in_progress") next.phase = "executing";
    if (status === "blocked" && !next.blockers.some((blocker) => blocker.itemId === itemId)) {
      next.phase = "blocked";
      next.blockers.push({ itemId, summary: item.title, createdAt: now() });
    }
    await writeState(next);
    return next;
  });
  const item = state.items.find((candidate) => candidate.id === itemId);
  await appendEvent({
    runId: state.runId,
    type: status === "in_progress" ? "item.started" : `item.${status}`,
    payload: { itemId, title: item.title, evidence }
  });
  return state;
}

export async function setItems(items, options = {}) {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  const state = await withStateLock(async () => {
    const next = await requireState();
    next.items = items.map((item, index) => ({
      id: item.id || `T${index + 1}`,
      title: item.title || `Work item ${index + 1}`,
      status: item.status || "pending",
      owner: item.owner || "executor",
      evidence: item.evidence || []
    }));
    next.plan = {
      ...(next.plan || {}),
      path: PLAN_PATH,
      accepted: options.accepted !== false,
      updatedAt: now()
    };
    if (options.phase || next.phase === "planning") next.phase = options.phase || "ready";
    await writeState(next);
    return next;
  });
  await appendEvent({
    runId: state.runId,
    type: options.eventType || "plan.updated",
    payload: { itemCount: state.items.length, phase: state.phase }
  });
  return state;
}

export async function addChangedFile(filePath, source = "my-cc-lite") {
  const normalized = normalizeProjectPath(filePath);
  const state = await withStateLock(async () => {
    const next = await readState();
    if (!next) return null;
    if (!normalized || normalized.startsWith(`${STATE_DIR}/`)) return next;
    next.changedFiles = Array.from(new Set([...(next.changedFiles || []), normalized])).sort();
    if (next.verification?.status === "passed") {
      next.verification.status = "not_started";
    }
    await writeState(next);
    return next;
  });
  if (!state || !normalized || normalized.startsWith(`${STATE_DIR}/`)) return state;
  await appendEvent({
    runId: state.runId,
    source,
    type: "file.changed",
    payload: { path: normalized }
  });
  return state;
}

export async function registerCapability(providerName, capability) {
  if (!providerName) throw new Error("provider name is required");
  const capabilities = await ensureCapabilities();
  capabilities.providers ||= {};
  capabilities.providers[providerName] = {
    ...(capabilities.providers[providerName] || {}),
    ...capability
  };
  await atomicWrite(CAPABILITIES_PATH, `${JSON.stringify(capabilities, null, 2)}\n`);
  const state = await readState();
  await appendEvent({
    runId: state?.runId || "unknown",
    type: "capability.registered",
    payload: { provider: providerName }
  });
  return capabilities;
}

export async function addEvidence(evidence) {
  const entry = {
    id: evidence.id || `evidence-${Date.now()}-${compactId(JSON.stringify(evidence))}`,
    source: evidence.source || "my-cc-lite",
    summary: evidence.summary || evidence.command || evidence.path || "verification evidence",
    status: evidence.status || "passed",
    command: evidence.command,
    path: evidence.path,
    timestamp: evidence.timestamp || now()
  };
  const state = await withStateLock(async () => {
    const next = await requireState();
    next.verification.evidence = [...(next.verification.evidence || []), entry];
    next.verification.status = entry.status === "failed" ? "failed" : next.verification.status;
    await writeState(next);
    return next;
  });
  await appendEvent({
    runId: state.runId,
    source: entry.source,
    type: entry.status === "failed" ? "verification.failed" : "verification.evidence.added",
    payload: entry
  });
  return entry;
}

export async function setVerification(status, evidence = []) {
  const state = await withStateLock(async () => {
    const next = await requireState();
    if (status === "passed") {
      const pending = next.items.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status));
      if (pending.length) {
        throw new Error(`cannot pass verification with pending items: ${pending.map((item) => item.id).join(", ")}`);
      }
    }
    next.phase = status === "passed" ? "done" : status === "failed" ? "executing" : "verifying";
    next.verification.status = status;
    next.verification.evidence = [...(next.verification.evidence || []), ...evidence];
    await writeState(next);
    return next;
  });
  await appendEvent({
    runId: state.runId,
    type: status === "passed" ? "verification.passed" : status === "failed" ? "verification.failed" : "verification.started",
    payload: { status, evidence }
  });
  if (status === "passed") {
    await appendEvent({ runId: state.runId, type: "run.completed", payload: { task: state.task } });
  }
  return state;
}

export async function summarize() {
  const state = await readState();
  if (!state) return "";
  const completed = state.items.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status)).map((item) => item.id);
  const active = state.items.find((item) => item.status === "in_progress");
  const pending = state.items.filter((item) => item.status === "pending").map((item) => `${item.id} ${item.title}`);
  const summary = [
    "# my-cc-lite Session Summary",
    "",
    `- Task: ${state.task || "unknown"}.`,
    `- Phase: ${state.phase}.`,
    `- Completed: ${completed.length ? completed.join(", ") : "none"}.`,
    `- Active: ${active ? `${active.id} ${active.title}` : "none"}.`,
    `- Pending: ${pending.length ? pending.join("; ") : "none"}.`,
    `- Changed files: ${(state.changedFiles || []).length ? state.changedFiles.join(", ") : "none"}.`,
    `- Verification: ${state.verification?.status || "unknown"}.`,
    `- Blockers: ${(state.blockers || []).length ? state.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ") : "none"}.`,
    `- Next action: ${nextAction(state)}.`
  ].join("\n");
  await atomicWrite(SUMMARY_PATH, `${summary}\n`);
  await appendEvent({
    runId: state.runId,
    type: "context.summary.added",
    payload: { path: SUMMARY_PATH }
  });
  return summary;
}

export function statusText(state, events = []) {
  if (!state) {
    return [
      "Task: none",
      "Phase: idle",
      "Progress: no active my-cc-lite run",
      "Verification: not started",
      "Next: run /plan \"<task>\""
    ].join("\n");
  }
  const completeCount = state.items.filter((item) => TERMINAL_ITEM_STATUSES.has(item.status)).length;
  const active = state.items.find((item) => item.status === "in_progress");
  const blockers = state.blockers || [];
  const malformedEvents = events.filter((event) => event.malformed).length;
  return [
    `Task: ${state.task || "unknown"}`,
    `Phase: ${state.phase}`,
    `Progress: ${completeCount}/${state.items.length} items complete`,
    `Active: ${active ? `${active.id} ${active.title}` : "none"}`,
    `Verification: ${state.verification?.status || "unknown"}`,
    `Changed files: ${(state.changedFiles || []).length ? state.changedFiles.join(", ") : "none"}`,
    `Blockers: ${blockers.length ? blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ") : "none"}`,
    malformedEvents ? `Warnings: ${malformedEvents} malformed event line(s) ignored` : null,
    `Next: ${nextAction(state)}`
  ].filter(Boolean).join("\n");
}

export function nextAction(state) {
  if (!state) return "run /plan \"<task>\"";
  if (state.phase === "planning") return "finish the plan, then set phase to ready";
  if (state.phase === "blocked") return "resolve blockers or ask the user for the missing input";
  const active = state.items.find((item) => item.status === "in_progress");
  if (active) return `finish ${active.id}, then mark it completed or blocked`;
  const pending = state.items.find((item) => item.status === "pending");
  if (pending) return `run /do for ${pending.id}`;
  if (state.verification?.required !== false && state.verification?.status !== "passed") return "run /verify";
  return "final response can cite verification evidence";
}

export function completionProblems(state) {
  if (!state || state.phase === "idle" || state.phase === "done") return [];
  const problems = [];
  const pending = state.items.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status));
  if (pending.length) {
    problems.push(`Pending items: ${pending.map((item) => `${item.id} ${item.title}`).join("; ")}`);
  }
  if (state.verification?.required !== false && state.verification?.status !== "passed") {
    problems.push(`Verification: ${state.verification?.status || "not_started"}`);
  }
  if ((state.blockers || []).length) {
    problems.push(`Blockers: ${state.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ")}`);
  }
  return problems;
}

export async function injectionText() {
  const state = await readState().catch(() => null);
  if (!state || state.phase === "done" || state.phase === "idle") return "";
  const config = await readConfig();
  const pending = state.items
    .filter((item) => item.status === "pending")
    .slice(0, config.maxInjectedItems)
    .map((item) => `${item.id} ${item.title}`);
  const active = state.items.find((item) => item.status === "in_progress");
  const summary = existsSync(SUMMARY_PATH) ? await fs.readFile(SUMMARY_PATH, "utf8").catch(() => "") : "";
  return [
    "my-cc-lite active run:",
    `- Task: ${state.task || "unknown"}`,
    `- Phase: ${state.phase}`,
    `- Current item: ${active ? `${active.id} ${active.title}` : "none"}`,
    `- Pending: ${pending.length ? pending.join("; ") : "none"}`,
    `- Verification: ${state.verification?.status || "unknown"}`,
    `- Recommended next action: ${nextAction(state)}`,
    state.phase === "blocked" && (state.blockers || []).length ? `- Blockers: ${state.blockers.map((blocker) => blocker.summary || blocker.itemId).join("; ")}` : null,
    summary ? "- Resume summary exists at .my-cc-lite/session-summary.md" : null
  ].filter(Boolean).join("\n");
}

export async function requireState() {
  const state = await readState();
  if (!state) throw new Error("No .my-cc-lite/state.json found. Run /plan first.");
  return state;
}

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function extractChangedFiles(input) {
  const values = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (/file|path/i.test(key) && looksLikeProjectPath(value)) values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    }
  };
  visit(input);
  return Array.from(new Set(values.map(normalizeProjectPath).filter(Boolean)));
}

function looksLikeProjectPath(value) {
  if (value.includes("\n") || value.length > 400) return false;
  return /^\.?[\w./ -]+\.[a-z0-9]+$/i.test(value) || value.startsWith(process.cwd());
}

function normalizeProjectPath(filePath) {
  if (!filePath || typeof filePath !== "string") return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  let relative = path.relative(process.cwd(), absolute);
  if (relative.startsWith("..")) return null;
  relative = relative.split(path.sep).join("/");
  return relative === "" ? null : relative;
}

async function cli(argv) {
  const command = argv[2] || "status";
  if (command === "get") {
    process.stdout.write(`${JSON.stringify(await readState(), null, 2)}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(`${statusText(await readState().catch(() => null), await readEvents())}\n`);
    return;
  }
  if (command === "init") {
    const task = argv.slice(3).join(" ").trim();
    if (!task) throw new Error("usage: my-cc-lite-state init <task>");
    process.stdout.write(`${JSON.stringify(await initState(task), null, 2)}\n`);
    return;
  }
  if (command === "append-event") {
    const event = await readJsonArgument(argv[3]);
    process.stdout.write(`${JSON.stringify(await appendEvent(event), null, 2)}\n`);
    return;
  }
  if (command === "register-capability") {
    const capability = await readJsonArgument(argv[3]);
    const provider = capability.provider || capability.name;
    delete capability.provider;
    delete capability.name;
    process.stdout.write(`${JSON.stringify(await registerCapability(provider, capability), null, 2)}\n`);
    return;
  }
  if (command === "add-evidence") {
    const evidence = await readJsonArgument(argv[3]);
    process.stdout.write(`${JSON.stringify(await addEvidence(evidence), null, 2)}\n`);
    return;
  }
  if (command === "summarize") {
    process.stdout.write(`${await summarize()}\n`);
    return;
  }
  if (command === "set-item") {
    const [itemId, status, ...evidence] = argv.slice(3);
    if (!itemId || !status) throw new Error("usage: my-cc-lite-state set-item <item-id> <status> [evidence...]");
    process.stdout.write(`${JSON.stringify(await setItemStatus(itemId, status, evidence), null, 2)}\n`);
    return;
  }
  if (command === "set-items") {
    const items = await readJsonArgument(argv[3]);
    process.stdout.write(`${JSON.stringify(await setItems(items), null, 2)}\n`);
    return;
  }
  if (command === "add-changed-file") {
    const file = argv[3];
    if (!file) throw new Error("usage: my-cc-lite-state add-changed-file <path>");
    process.stdout.write(`${JSON.stringify(await addChangedFile(file), null, 2)}\n`);
    return;
  }
  if (command === "set-verification") {
    const status = argv[3];
    if (!status) throw new Error("usage: my-cc-lite-state set-verification <passed|failed|not_started>");
    process.stdout.write(`${JSON.stringify(await setVerification(status), null, 2)}\n`);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

async function readJsonArgument(argument) {
  if (!argument) return readStdinJson();
  const trimmed = argument.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed);
  return JSON.parse(await fs.readFile(argument, "utf8"));
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  cli(process.argv).catch((error) => {
    process.stderr.write(`my-cc-lite: ${error.message}\n`);
    process.exitCode = 1;
  });
}
