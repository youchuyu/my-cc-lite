# my-cc-lite

`my-cc-lite` is a lightweight state-backed orchestration plugin for Claude Code.

This document is a quick reference. The project entry point is `../README.md`.

It provides a minimal workflow:

```text
/init
/plan -> /do -> /verify -> /status
```

The core keeps state in `.my-cc-lite/` inside the active project. It does not bundle browser automation, memory, HUD, team execution, research, LSP tooling, or advanced autonomous loops.

## What Is Included

- Skills: `init`, `plan`, `do`, `verify`, `status`
- Agents: `explore`, `planner`, `executor`, `verifier`
- Hooks: `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `Stop`
- State helper: `scripts/my-cc-lite-state.mjs`
- Workflow parser: `scripts/my-cc-lite-workflow-parser.mjs`
- Contracts: task-local workflow state, append-only events, curated capability inventory, optional capability providers

## State Files

```text
.my-cc-lite/
  current-task.json
  capabilities.json
  config.json
  tasks/
    <taskId>/
      workflow.json
      plan.md
      events.jsonl
      session-summary.md
      artifacts/
```

## Basic Flow

1. Run `/plan "<task>"`.
2. Review `.my-cc-lite/tasks/<taskId>/plan.md`.
3. Run `/do` until required items are complete.
4. Run `/verify`.
5. Use `/status` at any point to inspect progress and next action.

## Hook Setup

The plugin includes `hooks/hooks.json`, and the plugin manifest references it. Some Claude Code plugin environments may still require explicit hook setup; in that case, merge `hooks/hooks.json` through the active Claude Code hook configuration.

## Helper Commands

Set the helper path to the installed plugin root before running manual commands:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, replace it with the absolute path to the installed `my-cc-lite` directory. Run helper commands from the target project, because `.my-cc-lite/` state is written to the current working directory.

```bash
node "$MY_CC_LITE_HELPER" status
node "$MY_CC_LITE_HELPER" init-capabilities capabilities-inventory.json
node "$MY_CC_LITE_HELPER" plan-start "Implement a small change"
node "$MY_CC_LITE_HELPER" append-event event.json
node "$MY_CC_LITE_HELPER" register-capability capability.json
node "$MY_CC_LITE_HELPER" add-evidence evidence.json
node "$MY_CC_LITE_HELPER" summarize
```

Additional workflow helpers:

```bash
node "$MY_CC_LITE_HELPER" set-work-items '[{"id":"T1","title":"Create manifest","status":"pending"}]'
node "$MY_CC_LITE_HELPER" set-work-item T1 in_progress
node "$MY_CC_LITE_HELPER" set-work-item T1 completed "npm test passed"
node "$MY_CC_LITE_HELPER" add-changed-file src/file.ts
node "$MY_CC_LITE_HELPER" set-verification passed
```

## Verification Smoke Test

From a temporary project directory:

```bash
node "$MY_CC_LITE_HELPER" plan-start "smoke test"
node "$MY_CC_LITE_HELPER" status
node "$MY_CC_LITE_HELPER" add-evidence '{"source":"manual","summary":"state command works","status":"passed"}'
node "$MY_CC_LITE_HELPER" summarize
```

If the plugin is installed, use the command/skill flow instead:

```text
/init
/plan "make a tiny README edit"
/do
/status
/verify
/status
```
