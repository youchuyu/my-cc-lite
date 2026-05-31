# my-cc-lite State Contract

The source of truth is the project-local `.my-cc-lite/` directory, with workflow state scoped to a single task.

## Layout

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

`current-task.json` is only a pointer:

```json
{
  "version": 1,
  "currentTaskId": "20260531T120000Z-add-login-a1b2c3d4",
  "updatedAt": "2026-05-31T12:05:00.000Z"
}
```

Only `/plan` creates task directories. `/do`, `/verify`, and `/status` operate on the current task or an explicit `--task <taskId>`.

## `workflow.json`

Each task owns one workflow source of truth:

```json
{
  "version": 1,
  "taskId": "20260531T120000Z-add-login-a1b2c3d4",
  "task": "Add login",
  "currentStage": "do",
  "strictness": "soft",
  "createdAt": "2026-05-31T12:00:00.000Z",
  "updatedAt": "2026-05-31T12:05:00.000Z",
  "stages": {
    "plan": {},
    "do": {},
    "verify": {},
    "status": {}
  },
  "workItems": [],
  "changedFiles": [],
  "blockers": [],
  "extensions": {}
}
```

Required stages are `plan`, `do`, `verify`, and `status`. All stages use the same shape:

```json
{
  "name": "do",
  "status": "pending",
  "startedAt": null,
  "updatedAt": null,
  "completedAt": null,
  "summary": "",
  "input": {},
  "output": {},
  "capabilities": {
    "items": true,
    "files": true,
    "evidence": true,
    "checks": false,
    "snapshot": false,
    "blockers": true
  },
  "items": [],
  "files": [],
  "evidence": [],
  "checks": [],
  "snapshot": null,
  "blockers": [],
  "errors": []
}
```

Allowed stage statuses are `pending`, `in_progress`, `completed`, `failed`, and `blocked`.

Terminal work item statuses are `completed`, `skipped`, and `not_applicable`. Verification cannot pass while any work item is non-terminal or while blockers exist.

## CLI Surface

The installed helper remains:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

Primary commands:

```text
init-capabilities [capabilities-json]
plan-start <task>
use-task <taskId>
current-task
start-stage <do|verify|status> [--task <taskId>]
update-stage <plan|do|verify|status> [patch-json] [--task <taskId>]
complete-stage <plan|do|verify|status> [output-json] [--task <taskId>]
fail-stage <plan|do|verify|status> [error-json|string] [--task <taskId>]
set-work-items [items-json] [--task <taskId>]
set-work-item <id> <status> [evidence...] [--task <taskId>]
add-changed-file <path> [--task <taskId>]
add-evidence [evidence-json] [--task <taskId>]
set-verification <passed|failed|not_started> [--task <taskId>]
status [--task <taskId>]
summarize [--task <taskId>]
```

Stage-specific wrappers exist only where they add useful behavior:

- `scripts/stages/plan.mjs` creates a new task and can initialize `plan.md` plus work items from stdin JSON.
- `scripts/stages/verify.mjs` starts verification, records optional evidence from stdin JSON, and applies the verification gate.

## `events.jsonl`

Events are append-only JSON lines inside the task directory.

```json
{"version":1,"id":"event-001","taskId":"task-id","source":"my-cc-lite","type":"item.completed","timestamp":"2026-05-31T12:10:00.000Z","payload":{"itemId":"T1"}}
```

Malformed event lines must not break the core workflow. Readers should ignore malformed lines and surface a warning.

## `capabilities.json`

Capabilities are project-level. The `/init` command writes a curated current-session stage capability inventory under `inventory`; companion plugins register external providers under `providers`. The inventory is not a dump of every visible Claude Code tool. It should contain only non-native, non-my-cc-lite skills, agents, and tools that the current my-cc-lite stage can directly use.

```json
{
  "version": 1,
  "initializedAt": "2026-05-31T12:00:00.000Z",
  "source": {
    "kind": "current-session-context"
  },
  "inventory": {
    "planning": {
      "skills": [],
      "agents": [],
      "tools": []
    },
    "execution": {
      "skills": [],
      "agents": [],
      "tools": []
    },
    "review": {
      "skills": [],
      "agents": [],
      "tools": []
    }
  },
  "providers": {
    "review.browser": {
      "type": "review",
      "plugin": "my-cc-lite-browser",
      "commands": ["/browser-test"],
      "events": ["verification.evidence.added", "verification.failed"],
      "artifacts": ["screenshot", "console-log"],
      "description": "Runs browser checks and contributes UI evidence"
    }
  }
}
```

Inventory buckets:

- `skills`: skills the current stage can call, or skills that can replace the current stage skill.
- `agents`: agents the current stage can delegate to for part or all of the stage responsibility.
- `tools`: other callable abilities that the current stage can directly use, including MCP tools and callable tools exposed by companion plugins.

Each inventory entry must include `name` and `kind`; `description`, `invoke`, `source`, and `confidence` are normalized by the helper when absent. `invoke` defaults to `name`.

Companion plugins should write only:

- their namespace under `workflow.extensions.<pluginName>`
- append-only task events in `tasks/<taskId>/events.jsonl`
- artifacts under `tasks/<taskId>/artifacts/<pluginName>/`
- provider declarations in `capabilities.json`
