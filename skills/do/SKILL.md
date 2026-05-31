---
name: do
description: Execute the next pending my-cc-lite plan item
argument-hint: "[item id]"
---

# my-cc-lite /do

Use this skill to execute the current plan through scoped work items.

Use the helper from the installed plugin root while keeping the target project as the current working directory:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

## Steps

1. Read `.my-cc-lite/state.json` and `.my-cc-lite/plan.md`.
2. If state or plan is missing, recommend `/plan` or create a minimal plan only when the user's intent is unambiguous.
3. Select the requested item id, or the first `pending` item.
4. Mark it in progress:

```bash
node "$MY_CC_LITE_HELPER" set-item T1 in_progress
```

5. Implement only that item, using the local codebase patterns.
6. Record changed files. Hooks normally do this; if not, run:

```bash
node "$MY_CC_LITE_HELPER" add-changed-file path/to/file
```

7. Run relevant checks.
8. Mark the item `completed` with evidence, or `blocked` with a clear blocker:

```bash
node "$MY_CC_LITE_HELPER" set-item T1 completed "check command or file evidence"
```

9. If all required items are terminal, recommend `/verify`.

## Output

- Completed item summary
- Changed files
- Checks run
- Blockers, if any
- Recommended next command
