# my-cc-lite Architecture

`my-cc-lite` is intentionally small. The core coordinates a single state-backed work loop and leaves specialized capabilities to companion plugins.

## Core Responsibilities

- create and maintain a project-local plan
- track work item status
- record changed files
- collect verification evidence
- summarize active state before context compaction
- remind the agent when the run is not complete
- expose state, event, and capability contracts for companion plugins

## Non-core Responsibilities

The following capabilities are intentionally outside the core:

- browser automation
- long-term memory
- HUD or status-line rendering
- team or parallel execution
- external research
- LSP, AST, or language-server diagnostics
- advanced autonomous loops

These can integrate through `.my-cc-lite/events.jsonl`, `.my-cc-lite/capabilities.json`, and namespaced data under `state.extensions`.

## Runtime Model

The plugin code lives in the installed plugin directory. Runtime state lives in the target project:

```text
target-project/
  .my-cc-lite/
    state.json
    plan.md
    events.jsonl
    session-summary.md
    capabilities.json
```

Hooks and skills should call the helper from the plugin root while preserving the target project as the current working directory. This keeps project state inspectable and avoids copying plugin scripts into every target project.
