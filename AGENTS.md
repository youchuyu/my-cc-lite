# my-cc-lite

This directory is the source of truth for the standalone lightweight Claude Code orchestration plugin.

## Scope

- Keep the core small: planning, execution guidance, verification, status, local state, events, capabilities, and lifecycle hooks.
- Do not add team runtime, browser automation, memory, HUD, LSP, research, or advanced autonomous loops to the core.
- Prefer file-backed state under `.my-cc-lite/` over databases, daemons, or hidden global state.
- Default behavior is soft guidance. Strict behavior may be represented in config/state, but hooks should not hard-block by default.

## Implementation Rules

- Keep scripts dependency-free Node.js modules.
- Preserve inspectable JSON and Markdown artifacts.
- Update docs when changing state, event, capability, or hook contracts.
- Keep implementation decisions grounded in this project. Do not introduce external project names, runtime assumptions, or unrelated orchestration features.

## Verification

- For script changes, run the relevant `node scripts/my-cc-lite-state.mjs ...` command from this directory and the package smoke test when behavior changes.
- For hook changes, run the hook file directly with representative JSON on stdin when practical.
- For documentation-only changes, verify paths and command examples.
