---
name: status
description: Show my-cc-lite task state, progress, blockers, and next action
---

# my-cc-lite /status

Use this skill to inspect or recover the current workflow.

Use the helper from the installed plugin root while keeping the target project as the current working directory:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

## Steps

1. Run:

```bash
node "$MY_CC_LITE_HELPER" status
```

2. If state is missing, recommend `/plan "<task>"`.
3. If workflow state is malformed, report the exact file and JSON error.
4. If blockers exist, surface them before recommending more execution.
5. If changed files exist and verification has not passed, recommend `/verify`.

## Output

```text
Task: ...
Stage: do
Progress: 2/4 items complete
Active: T3 Add stop hook
Verification: not started
Next: finish T3, then /verify
```
