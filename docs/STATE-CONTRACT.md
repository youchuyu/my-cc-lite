# my-cc-lite State Contract

The source of truth is the project-local `.my-cc-lite/` directory.

## `state.json`

Required top-level fields:

```json
{
  "version": 1,
  "runId": "20260531T120000Z-task-id",
  "task": "Task summary",
  "phase": "executing",
  "strictness": "soft",
  "createdAt": "2026-05-31T12:00:00.000Z",
  "updatedAt": "2026-05-31T12:15:00.000Z",
  "plan": {
    "path": ".my-cc-lite/plan.md",
    "accepted": true,
    "updatedAt": "2026-05-31T12:05:00.000Z"
  },
  "items": [],
  "changedFiles": [],
  "verification": {
    "required": true,
    "status": "not_started",
    "evidence": []
  },
  "blockers": [],
  "extensions": {}
}
```

Allowed phases:

| Phase | Meaning |
| --- | --- |
| `idle` | No active run |
| `planning` | Plan is being created or updated |
| `ready` | Plan exists and execution can start |
| `executing` | Work items are being implemented |
| `verifying` | Checks and evidence collection are active |
| `blocked` | User input or external condition is needed |
| `done` | Work is complete and verified |

Terminal item statuses are `completed`, `skipped`, and `not_applicable`.

## `events.jsonl`

Events are append-only JSON lines.

```json
{"version":1,"id":"event-001","runId":"run-id","source":"my-cc-lite","type":"item.completed","timestamp":"2026-05-31T12:10:00.000Z","payload":{"itemId":"T1"}}
```

Core event types:

| Event type | Purpose |
| --- | --- |
| `run.created` | A run has started |
| `run.completed` | A run has completed |
| `plan.created` | A new plan was written |
| `plan.updated` | Existing plan changed |
| `item.started` | A work item started |
| `item.completed` | A work item completed |
| `item.blocked` | A work item is blocked |
| `file.changed` | A file changed |
| `tool.succeeded` | A command/tool succeeded |
| `tool.failed` | A command/tool failed |
| `verification.started` | Verification started |
| `verification.evidence.added` | Evidence was added |
| `verification.passed` | Verification passed |
| `verification.failed` | Verification failed |
| `capability.registered` | A plugin registered a capability |
| `context.summary.added` | A plugin contributed context |

Malformed event lines must not break the core workflow. Readers should ignore malformed lines and surface a warning.

## `capabilities.json`

Capability providers are grouped by function.

```json
{
  "version": 1,
  "providers": {
    "verification.browser": {
      "type": "verification",
      "plugin": "my-cc-lite-browser",
      "commands": ["/browser-test"],
      "events": ["verification.evidence.added", "verification.failed"],
      "artifacts": ["screenshot", "console-log"],
      "description": "Runs browser checks and contributes UI evidence"
    }
  }
}
```

Provider types:

| Type | Description |
| --- | --- |
| `context` | Adds project, memory, research, or domain context |
| `diagnostics` | Adds lint, typecheck, LSP, AST, static analysis, or runtime diagnostics |
| `verification` | Adds tests, browser screenshots, QA checks, or review evidence |
| `execution` | Adds execution workers or task routing |
| `status` | Adds display surfaces such as HUD/statusLine |

## Ownership

Core-owned fields:

- `phase`
- `items`
- `verification.status`
- `changedFiles`
- `blockers`

Companion plugins should write only:

- their namespace under `extensions.<pluginName>`
- append-only events in `events.jsonl`
- artifacts under `.my-cc-lite/artifacts/<pluginName>/`
- provider declarations in `capabilities.json`
