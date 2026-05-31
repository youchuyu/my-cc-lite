# my-cc-lite

`my-cc-lite` is a lightweight state-backed orchestration plugin for Claude Code.

It provides a small workflow:

```text
/plan -> /do -> /verify -> /status
```

The core keeps project-local state in `.my-cc-lite/`. It includes planning, scoped execution guidance, verification, status, lifecycle hooks, append-only events, and optional companion-plugin capability registration. Browser automation, long-term memory, HUDs, team execution, research, LSP tooling, and autonomous loops belong in companion plugins.

## Install

Install the plugin directory through your Claude Code plugin workflow. The plugin manifest lives at:

```text
.claude-plugin/plugin.json
```

Lifecycle hook configuration is stored at:

```text
hooks/hooks.json
```

The manifest references the hook config for environments that support it. If your Claude Code plugin environment does not load hooks from the manifest, merge `hooks/hooks.json` into the active Claude Code hook configuration.

## Helper Path

The state helper is part of the plugin, not the user project. In command examples, `MY_CC_LITE_HELPER` means:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

If your environment does not expose `CLAUDE_PLUGIN_ROOT`, replace it with the absolute path to the installed `my-cc-lite` plugin directory. The helper writes state to the current working directory, so run it from the target project where `.my-cc-lite/` should live.

## Basic Flow

1. Run `/plan "<task>"`.
2. Review `.my-cc-lite/plan.md`.
3. Run `/do` until required items are complete.
4. Run `/verify`.
5. Use `/status` at any point to inspect progress and next action.

## State Files

```text
.my-cc-lite/
  state.json
  plan.md
  events.jsonl
  session-summary.md
  capabilities.json
  artifacts/
```

## Development

Run checks from the project root:

```bash
npm run check
npm run validate:json
npm run smoke
```

The smoke test creates a temporary target project and runs the helper from the plugin source path, which verifies that plugin code and user-project state are separated.

## Documentation

- `docs/ARCHITECTURE.md` explains the core boundaries.
- `docs/STATE-CONTRACT.md` defines `.my-cc-lite/` state and event files.
- `docs/PLUGIN-COMPAT.md` defines companion-plugin integration points.
