# my-cc-lite Architecture

`my-cc-lite` is intentionally small. The core coordinates a single state-backed work loop and leaves specialized capabilities to companion plugins.

## Core Responsibilities

- create and maintain a project-local plan
- initialize a project-level current-session capability inventory
- track work item status
- record changed files
- collect verification evidence
- summarize active state before context compaction
- remind the agent when the run is not complete
- expose state, event, inventory, and provider contracts for companion plugins

## Non-core Responsibilities

The following capabilities are intentionally outside the core:

- browser automation
- long-term memory
- HUD or status-line rendering
- team or parallel execution
- external research
- LSP, AST, or language-server diagnostics
- advanced autonomous loops

These can integrate through task-local `events.jsonl`, project-level `.my-cc-lite/capabilities.json`, and namespaced data under `workflow.extensions`.

## Runtime Model

The plugin code lives in the installed plugin directory. Runtime state lives in the target project:

```text
target-project/
  .my-cc-lite/
    current-task.json
    capabilities.json
    tasks/
      <taskId>/
        workflow.json
        plan.md
        events.jsonl
        session-summary.md
```

Hooks and skills should call the helper from the plugin root while preserving the target project as the current working directory. This keeps project state inspectable and avoids copying plugin scripts into every target project.
