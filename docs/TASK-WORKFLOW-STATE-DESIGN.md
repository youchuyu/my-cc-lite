# Task Workflow State Design

This document defines the task-scoped workflow state design for `my-cc-lite`.

## Summary

Every `/plan` call creates a new task directory under `.my-cc-lite/tasks/`, named by a generated `taskId`. All task-specific state, plan, events, summaries, and artifacts live inside that task directory.

Only `/plan` creates tasks. The `do`, `verify`, and `status` stages can only operate on an existing task.

The unified workflow state is still a single JSON file, but its scope is one task:

```text
.my-cc-lite/
  tasks/
    20260531T120000Z-add-login-a1b2c3d4/
      workflow.json
      plan.md
      events.jsonl
      session-summary.md
      artifacts/
  current-task.json
  capabilities.json
  config.json
```

`workflow.json` is the only workflow state source for that task. `current-task.json` is only a pointer to the active task and must not store stage state.

## Task Directory Model

Task ids are generated when `/plan` starts. They should be stable and readable:

```text
<timestamp>-<task-slug>-<hash>
```

Example:

```text
20260531T120000Z-add-login-a1b2c3d4
```

Each task directory contains:

```text
.my-cc-lite/tasks/<taskId>/
  workflow.json
  plan.md
  events.jsonl
  session-summary.md
  artifacts/
```

Project-level files have project-level responsibilities:

- `current-task.json`: active task pointer.
- `capabilities.json`: companion plugin capability registration.
- `config.json`: project-level `my-cc-lite` configuration.

Each `/plan` call must:

- generate a new `taskId`
- create `.my-cc-lite/tasks/<taskId>/`
- initialize `<taskId>/workflow.json`
- initialize `<taskId>/events.jsonl`
- write or initialize `<taskId>/plan.md`
- update `current-task.json` to point at the new task

`/plan` must not silently reuse or update an existing task. Follow-up planning for an existing task should be modeled later as an explicit command, not as the default `/plan` behavior.

`current-task.json` shape:

```json
{
  "version": 1,
  "currentTaskId": "20260531T120000Z-add-login-a1b2c3d4",
  "updatedAt": "2026-05-31T12:05:00.000Z"
}
```

## Workflow State Shape

Each task has one unified workflow state file:

```text
.my-cc-lite/tasks/<taskId>/workflow.json
```

Top-level shape:

```json
{
  "version": 1,
  "taskId": "20260531T120000Z-add-login-a1b2c3d4",
  "task": "Add login",
  "currentStage": "plan",
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

The four workflow stages are:

- `plan`
- `do`
- `verify`
- `status`

All four stages must use the same stage shape. Stage-specific behavior is represented by optional capabilities, not by changing the structure.

## Unified Stage Shape

Required stage shape:

```json
{
  "name": "plan",
  "status": "pending",
  "startedAt": null,
  "updatedAt": null,
  "completedAt": null,
  "summary": "",
  "input": {},
  "output": {},
  "capabilities": {
    "items": false,
    "files": false,
    "evidence": false,
    "checks": false,
    "snapshot": false,
    "blockers": false
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

Core fields required for every stage:

- `name`
- `status`
- `startedAt`
- `updatedAt`
- `completedAt`
- `summary`
- `input`
- `output`
- `capabilities`
- `errors`

Capability-backed fields are present on every stage for shape consistency, but only meaningful when the matching capability is enabled:

- `items`
- `files`
- `evidence`
- `checks`
- `snapshot`
- `blockers`

Recommended default capabilities:

```json
{
  "plan": {
    "items": true,
    "files": false,
    "evidence": false,
    "checks": false,
    "snapshot": false,
    "blockers": true
  },
  "do": {
    "items": true,
    "files": true,
    "evidence": true,
    "checks": false,
    "snapshot": false,
    "blockers": true
  },
  "verify": {
    "items": true,
    "files": true,
    "evidence": true,
    "checks": true,
    "snapshot": false,
    "blockers": true
  },
  "status": {
    "items": false,
    "files": false,
    "evidence": false,
    "checks": false,
    "snapshot": true,
    "blockers": false
  }
}
```

## State Parser

Add a unified workflow parser script:

```text
scripts/my-cc-lite-workflow-parser.mjs
```

The parser owns all workflow state interpretation:

- task directory resolution
- current task lookup
- workflow creation
- workflow reading and writing
- stage creation
- state validation
- stage transition validation
- next action derivation
- completion problem derivation

All hooks, CLI commands, and stage-specific scripts must use this parser. They should not parse or mutate `workflow.json` directly.

Suggested parser API:

- `createTaskFromPlan(task, options)`
- `readCurrentTaskPointer()`
- `writeCurrentTaskPointer(taskId)`
- `resolveTaskDir(taskId)`
- `readWorkflow(taskId)`
- `writeWorkflow(workflow)`
- `validateWorkflow(workflow)`
- `createStage(name, capabilities)`
- `startPlanTask(task, options)`
- `startExistingStage(taskId, stageName)`
- `updateStage(taskId, stageName, patch)`
- `completeStage(taskId, stageName, output)`
- `failStage(taskId, stageName, error)`
- `deriveOverallStatus(workflow)`
- `nextAction(workflow)`
- `completionProblems(workflow)`

## CLI Changes

Keep `scripts/my-cc-lite-state.mjs` as the CLI entry point if desired, but it should delegate state parsing and mutation to `my-cc-lite-workflow-parser.mjs`.

Recommended CLI commands:

```text
plan-start <task>
use-task <taskId>
current-task
start-stage <do|verify|status> [--task <taskId>]
update-stage <plan|do|verify|status> [--task <taskId>]
complete-stage <plan|do|verify|status> [--task <taskId>]
fail-stage <plan|do|verify|status> [--task <taskId>]
set-work-items [--task <taskId>]
set-work-item <id> <status> [--task <taskId>]
add-changed-file <path> [--task <taskId>]
add-evidence [--task <taskId>]
status [--task <taskId>]
```

Default behavior:

- Commands without `--task` use `current-task.json`.
- Commands with `--task` operate on the specified task directory.
- `plan-start` is the only command that creates a task directory.
- `/plan` must call `plan-start <task>` at the beginning of each invocation.
- `start-stage` cannot start `plan`; plan is started only as part of task creation.
- `status` must not advance business progress.

## Stage-Specific Scripts

Do not create a separate script for every stage by default. Add a stage-specific script only when the stage has meaningful behavior beyond generic state transitions.

Recommended initial split:

- `scripts/stages/plan.mjs`: create a new task for every `/plan`, sync `plan.md`, write `workItems`, and complete the `plan` stage.
- `scripts/stages/verify.mjs`: enforce verification gates, collect checks, write evidence, and pass or fail the `verify` stage.
- No dedicated `do` script initially. Use generic CLI commands for work item status, changed files, and evidence.
- No dedicated `status` script initially. Use parser-derived snapshots.

## Hook Changes

Hooks should resolve the current task first, then operate on that task's `workflow.json`.

- `prompt-submit`: read `current-task.json`, load the workflow, and inject current stage, active item, pending items, blockers, and next action.
- `post-tool-use`: record changed files and tool events in the current task.
- `stop`: check the current task for incomplete work items, missing verification, and blockers.
- `pre-compact`: write `session-summary.md` inside the current task directory.

Task-local event files should be used:

```text
.my-cc-lite/tasks/<taskId>/events.jsonl
```

## State Independence

The core workflow reads and writes only the project-local task model described above. Task state lives under `.my-cc-lite/tasks/<taskId>/`, and project-level files only hold pointers, capabilities, and configuration.

## Test Plan

Task creation:

- Empty project runs `/plan "Add login"`.
- A task directory is created under `.my-cc-lite/tasks/`.
- `workflow.json`, `plan.md`, `events.jsonl`, `session-summary.md`, and `artifacts/` are initialized.
- `current-task.json` points to the new task.
- Running `/plan "Add login"` again creates a second task directory with a different `taskId`.
- `/do`, `/verify`, and `/status` never create task directories.

Current task behavior:

- `status` without `--task` reads the current task.
- `status --task <taskId>` reads the specified task.
- `use-task <taskId>` changes the active task pointer.

Workflow validation:

- Missing any of the four stages fails validation.
- Inconsistent stage shape fails validation.
- Invalid `currentStage` fails validation.
- Invalid stage `status` fails validation.
- Capability-enabled fields with invalid types fail validation.

Stage transitions:

- `/plan` creates a new task and starts the `plan` stage.
- `start-stage do` only updates an existing task workflow.
- Multiple tasks can coexist without cross-task mutation.
- `verify` cannot pass while required work items are still pending or in progress.
- `status` can write a snapshot but cannot complete work items or pass verification.

## Assumptions

- Each task's only workflow state source is `.my-cc-lite/tasks/<taskId>/workflow.json`.
- `current-task.json` is a pointer, not state.
- Every `/plan` invocation creates and activates a new task.
- Only `/plan` creates tasks.
- Stage shape is structurally consistent across all stages.
- Capability flags decide which shared fields are meaningful for a stage.
