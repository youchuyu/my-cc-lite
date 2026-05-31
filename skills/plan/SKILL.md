---
name: plan
description: Create a my-cc-lite task-backed plan
argument-hint: "<task description>"
---

# my-cc-lite /plan

Use this skill to initialize a task, produce `.my-cc-lite/tasks/<taskId>/plan.md`, and populate `.my-cc-lite/tasks/<taskId>/workflow.json`.

Use the helper from the installed plugin root while keeping the target project as the current working directory:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, use the absolute path to the installed plugin directory.

## Steps

1. Explore the codebase only when discovery is needed.
2. Create concise acceptance criteria and ordered work items with ids `T1`, `T2`, ...
3. Run `node "$MY_CC_LITE_HELPER" plan-start "<task>"` from the target project. Every `/plan` call creates a new task and updates `.my-cc-lite/current-task.json`.
4. Write `.my-cc-lite/tasks/<taskId>/plan.md` with task, acceptance criteria, work items, verification steps, and risks.
5. Update the task's `workflow.json` so the plan stage is complete and `workItems` match the plan:

```bash
node "$MY_CC_LITE_HELPER" set-work-items '[{"id":"T1","title":"Create plugin manifest","status":"pending","owner":"executor","evidence":[]}]'
```

6. The `set-work-items` helper appends `plan.updated` to the task-local `events.jsonl` automatically.

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
- Current task id and stage
- Recommended next command: `/do`
