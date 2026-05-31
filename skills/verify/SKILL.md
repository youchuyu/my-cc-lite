---
name: verify
description: Validate a my-cc-lite run and record evidence
argument-hint: ""
---

# my-cc-lite /verify

Use this skill to verify completed work and mark the run done only when evidence supports completion.

Use the helper from the installed plugin root while keeping the target project as the current working directory:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

## Steps

1. Read `.my-cc-lite/state.json`, `.my-cc-lite/plan.md`, `.my-cc-lite/events.jsonl`, and `.my-cc-lite/capabilities.json`.
2. If required items are still pending or in progress, do not pass verification. Recommend `/do`.
3. Run relevant local checks for the changed files and acceptance criteria.
4. Add each evidence item:

```bash
node "$MY_CC_LITE_HELPER" add-evidence
```

Pass JSON on stdin when useful:

```json
{"source":"my-cc-lite","summary":"npm test passed","status":"passed","command":"npm test"}
```

5. Consume companion plugin events of type `verification.evidence.added` or `verification.failed`.
6. If evidence is sufficient, run:

```bash
node "$MY_CC_LITE_HELPER" set-verification passed
```

7. If checks fail or evidence is incomplete, run:

```bash
node "$MY_CC_LITE_HELPER" set-verification failed
```

## Output

- Verification commands or checks used
- Evidence list
- Pass/fail result
- Next action
