---
name: verify
description: 验收当前 my-cc-lite 任务并写入 task.json 最终验证结论
---

# Verify

`/verify` 是 my-cc-lite 的任务级验收阶段。它判断当前 active task 是否满足 `plan.md` 的目标、范围和验收口径，并通过 `scripts/verify.mjs` 把最终结论写回当前任务目录下的 `task.json`。

`/verify` 不执行修复，不改写 `plan.md`，不改写已有 task、step 或 check，不更新 `project.json`，不自动归档任务。

## 使用条件

当用户手动调用 `/verify`，或明确要求验收当前 my-cc-lite 任务时使用。

当前工作目录必须是目标项目根目录。项目必须已执行 `/init`，且 `.my-cc-lite/tasks/` 下只能有一个未归档任务目录。

## 进入条件

正式验证前必须满足：

- 项目已初始化：`.my-cc-lite/project.json` 存在且结构合法。
- 当前任务唯一：`.my-cc-lite/tasks/` 下刚好存在一个当前任务目录，且该目录下存在非空 `plan.md` 和结构合法的 `task.json`。
- 当前任务可验收：`task.json.tasks[]` 非空，所有 `tasks[].status` 都是 `completed` 或 `skipped`，且至少存在一个 `completed` task。

如果条件不满足，立即停止本次 `/verify`，不写入任何状态，并按以下方式提示下一步：

- 没有当前任务，提示先执行 `/plan`。
- 存在多个当前任务，提示状态异常，需要手动处理。
- 缺少 `task.json`，提示先执行 `/do`。
- 仍有 `pending`、`in_progress`、`blocked` 或 `failed` task，提示回到 `/do` 继续执行、修复或处理阻塞。
- 所有 task 都是 `skipped`，提示回到 `/plan` 重新确认当前任务是否仍然成立。

## 执行步骤

1. 读取 `.my-cc-lite/project.json`，确认项目已初始化。
2. 装载当前任务上下文：扫描 `.my-cc-lite/tasks/` 确认唯一当前任务目录，并读取该目录下的 `plan.md` 和 `task.json`。
3. 检查 verify 进入条件。
4. 如果任一进入条件不满足，停止，不写状态，并说明下一步。
5. 根据 `plan.md`、`task.json.objective`、`tasks[]` 和 `checks[]` 形成最终验收判断。
6. 必要时委派 `verifier` 的 `final_verify` mode，或调用 `project.json.stageHelpers.review` 中明确匹配的 review helper。
7. 必要时读取相关项目文件或运行轻量检查命令；这些上下文只服务本轮判断，不落盘。
8. 在 `passed`、`needs_fix`、`blocked` 中选择一个结论。
9. 调用 verify 阶段脚本执行 `complete`，通过 stdin 传入 JSON。
10. 向用户返回结论、简短原因、写入摘要和下一步。

## 判断依据

- `plan.md` 是最终人类语义来源。
- `task.json.objective` 是执行目标快照。
- `task.json.tasks[]` 和 `checks[]` 是 `/do` 阶段固化的执行检查结构。
- 必要项目文件、轻量命令输出摘要、review helper 输出或用户补充说明可以作为本轮判断依据。

如果 `plan.md` 和 `task.json` 轻微表述不同，以 `plan.md` 判断目标和验收口径，以 `task.json` 判断执行结果是否支撑通过。

如果差异会影响通过判断，不要改写状态强行通过；返回 `blocked`，或提示回到 `/plan` / `/do`。

## 结论处理

只有 `needs_fix` 会新增 repair task。`blocked` 表示当前无法在原计划范围内形成明确 repair task，因此只写入阻塞结论，不追加 `tasks[]`。

`passed`：

- 用于整个任务已经满足 `plan.md` 的目标、范围和验收口径。
- 调用脚本写入 `status: "verified"`、`stage: "verified"`、`verification.status: "passed"`。
- 下一步建议 `/archive`。

`needs_fix`：

- 用于验证未通过，但缺口可以收敛成一个或少量后续 `/do` 可执行 repair tasks。
- 调用脚本把 repair tasks append 到 `tasks[]` 末尾；同时将当前任务的顶层状态写为 `status: "active"`、`stage: "executing"`，并写入 `verification.status: "needs_fix"` 和 `verification.summary`。
- 下一步建议 `/do`。

`blocked`：

- 用于验证未通过，且无法形成明确 repair task，或缺少用户决策、权限、外部条件、计划调整、可靠判断条件。
- 调用脚本写入 `status: "blocked"`、`stage: "verifying"`、`verification.status: "blocked"`。
- 下一步建议 `/plan`、用户决策或处理外部阻塞。

## Repair Task

`needs_fix` 的 repair task 必须满足：

- 来源必须是原 `plan.md` 的目标、范围、验收口径，或已有 `tasks[].checks[]`。
- 不能引入新需求。
- 不能扩大任务范围。
- 默认优先 append 一个 repair task。
- 多个 repair tasks 只用于多个修复入口明确、互相独立、仍属于原计划验收口径的情况。
- 只能 append 到 `tasks[]` 末尾。
- 不能删除、重排、合并、拆分或改写已有 task。
- `steps[]` 和 `checks[]` 保持短，不保存完整 review 报告、命令输出、文件列表或 evidence。

repair task id 由脚本生成，输入不要包含 `id`、`status` 或 `statusReason`。

## 脚本输入

脚本路径解析：

- 如果当前工作目录存在 `scripts/verify.mjs`，使用：

```bash
node scripts/verify.mjs complete
```

- 如果当前工作目录不是 my-cc-lite 插件源码目录，先定位插件根目录，再使用绝对路径调用 `<pluginRoot>/scripts/verify.mjs`。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/verify.mjs`。

脚本输入 JSON：

- `status` 必须是 `passed`、`needs_fix` 或 `blocked`。
- `summary` 必须是简短验证结论摘要。
- 只有 `status: "needs_fix"` 时允许传入 `repairTasks`，且必须是非空数组。
- `passed` 和 `blocked` 不传 `repairTasks`。
- `repairTasks[]` 只包含 `title`、`steps` 和 `checks`，不要包含 `id`、`status` 或 `statusReason`。

最小示例：

```json
{
  "status": "passed",
  "summary": "Short verification result summary."
}
```

需要修复时：

```json
{
  "status": "needs_fix",
  "summary": "Short summary of the verification gap.",
  "repairTasks": [
    {
      "title": "Bounded repair task title",
      "steps": ["Bounded repair step"],
      "checks": ["Check tied to the original plan.md acceptance criteria"]
    }
  ]
}
```

## 禁止事项

- 不直接手写 `task.json`。
- 不修改 `.my-cc-lite/project.json`。
- 不修改 `plan.md`。
- 不修改已有 `tasks[]`、`steps[]` 或 `checks[]`。
- 不保存完整 review 报告、命令日志、changed files、事件日志或证据文件。
- 不自动调用 `/do` 修复。
- 不自动调用 `/archive` 归档。
- 不让 `verifier` 或 review helper 直接调用阶段脚本或写入状态。

## 错误处理

- `PROJECT_NOT_INITIALIZED`：提示先执行 `/init`。
- `NO_ACTIVE_TASK`：提示先执行 `/plan`。
- `MULTIPLE_ACTIVE_TASKS`：提示当前状态异常，需要手动处理多 active task。
- `PLAN_NOT_FOUND`：提示当前 task 缺少 `plan.md`，回到 `/plan` 或手动修复。
- `TASK_STATE_NOT_FOUND`：提示先执行 `/do` 生成 `task.json`。
- `TASK_NOT_VERIFIABLE`：提示回到 `/do` 继续执行、修复或处理阻塞。
- `INVALID_INPUT`：修正传给 verify 脚本的 JSON 输入。
- `INVALID_TASK_STATE`：当前 `task.json` 结构异常，需要手动检查状态文件。

## 完成反馈

本次 `/verify` 结束时说明：

- 结论：`passed` / `needs_fix` / `blocked`。
- 简短原因。
- 写入的 `verification.summary`。
- 如果是 `needs_fix`，列出新增 repair task id 和标题。
- 下一步：`/archive`、`/do`、`/plan` 或用户决策。
