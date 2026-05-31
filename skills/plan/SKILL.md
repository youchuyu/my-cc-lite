---
name: plan
description: Create or update a my-cc-lite state-backed plan
argument-hint: "<task description>"
---

# my-cc-lite /plan

Use this skill to initialize a run, produce `.my-cc-lite/plan.md`, and populate `.my-cc-lite/state.json`.

Use the helper from the installed plugin root while keeping the target project as the current working directory:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, use the absolute path to the installed plugin directory.

## Steps

1. Read `.my-cc-lite/state.json` if present.
2. If an active run exists and the user did not clearly ask to replace it, continue or update that run.
3. Explore the codebase only when discovery is needed.
4. Create concise acceptance criteria and ordered work items with ids `T1`, `T2`, ...
5. Run `node "$MY_CC_LITE_HELPER" init "<task>"` from the target project when no state exists.
6. Write `.my-cc-lite/plan.md` with task, acceptance criteria, work items, verification steps, and risks.
7. Update `.my-cc-lite/state.json` so `phase` is `ready`, `plan.accepted` is true, and `items` match the plan:

```bash
node "$MY_CC_LITE_HELPER" set-items '[{"id":"T1","title":"Create plugin manifest","status":"pending","owner":"executor","evidence":[]}]'
```

8. Append `plan.created` or `plan.updated` to `.my-cc-lite/events.jsonl` when needed. The `set-items` helper appends `plan.updated` automatically.

## State Shape

Each item should look like:

```json
{
  "id": "T1",
  "title": "Create plugin manifest",
  "status": "pending",
  "owner": "executor",
  "evidence": []
}
```

## Output

- Short plan summary
- Current phase
- Recommended next command: `/do`
