# archive module design

`/archive` 是任务关闭阶段。它关闭当前 task，释放 `currentTaskId`，不代表任务已经验证成功。

## 目标

- 关闭当前 task。
- 保留当前 `verification.status`。
- 在 `task.json.archive` 中写入简短归档摘要。
- 将 task 标记为 `archived`。
- 将任务目录移动到 `.my-cc-lite/archived_tasks/`。
- 将 `project.json.currentTaskId` 置为 `null`。

## 输入

- `.my-cc-lite/project.json`。
- 当前任务的 `task.json`，如果任务从未执行则可以不存在。
- 当前任务的 `plan.md`。

## 运行规则

- `/archive` 不要求 `verification.status` 为 `passed`。
- `/archive` 不提供 `--force` 分支。
- `/archive` 不修改 `verification.status`。
- 如果任务从未执行且没有 `task.json`，`/archive` 仍可关闭这个 plan-only task。
- 如果当前任务未验证通过，归档摘要应说明当前验证状态。
- 如果 `project.json.currentTaskId` 为 `null`，提示当前没有 active task。

```json
{
  "verification": {
    "status": "failed"
  },
  "archive": {
    "summary": "Archived without passed verification. Verification status: failed."
  }
}
```

## 状态变化

```text
active -> archived
blocked -> archived
verified -> archived
```

`task.json` 更新：

```json
{
  "status": "archived",
  "stage": "archived",
  "verification": {
    "status": "failed",
    "summary": "Final verification failed."
  },
  "archive": {
    "summary": "Archived without passed verification. Verification status: failed.",
    "archivedAt": "2026-06-06T16:00:00+08:00"
  }
}
```

`verification` 保留归档前的状态，不因为归档而改成 `passed`。

## 目录移动

归档成功后，将任务目录从：

```text
.my-cc-lite/tasks/<taskId>/
```

移动到：

```text
.my-cc-lite/archived_tasks/<taskId>/
```

同时将 `project.json.currentTaskId` 置为 `null`，这样 `/status` 能明确提示当前没有 active task。

## helper 操作

建议 helper 提供：

```text
archive-preflight
archive-task
```

## 输出给用户

```text
Archived task: 20260606-153012-add-feature
Verification: failed
Archive: .my-cc-lite/archived_tasks/20260606-153012-add-feature/
Next: /plan "<next task>"
```
