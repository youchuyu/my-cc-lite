---
name: archive
description: 关闭当前 my-cc-lite 任务并移动到 archived_tasks
---

# Archive

`/archive` 是 my-cc-lite 的任务关闭阶段。它只把唯一 active task 从 `.my-cc-lite/tasks/<taskId>/` 移动到 `.my-cc-lite/archived_tasks/<taskId>/`，并通过 my-cc-lite runtime entry 在移动前写入最小归档摘要。

`/archive` 不重新验证任务，不执行修复，不生成报告，不更新 `project.json`，不自动创建新任务。

## 使用条件

当用户手动调用 `/archive`，或明确要求关闭、归档当前 my-cc-lite 任务时使用。

当前工作目录必须是目标项目根目录。项目必须已执行 `/init`，且 `.my-cc-lite/tasks/` 下只能有一个未归档任务目录。

## 进入条件

归档前必须满足：

- 项目已初始化：`.my-cc-lite/project.json` 存在且结构合法。
- 当前任务唯一：`.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 当前任务目录存在非空 `plan.md`。
- 当前任务目录存在结构合法的 `task.json`。
- 当前任务尚未归档。
- `.my-cc-lite/archived_tasks/<taskId>/` 不存在。

如果条件不满足，停止本次 `/archive`，不写状态，并提示下一步：

- 没有当前任务，提示先执行 `/plan`。
- 存在多个当前任务，提示状态异常，需要手动处理。
- 缺少 `plan.md`，提示回到 `/plan` 或手动修复状态文件。
- 缺少 `task.json`，提示先执行 `/do` 物化任务。
- 目标归档目录已存在，提示手动检查 `archived_tasks/<taskId>/`。

## 归档语义

归档只表示任务目录从 active 工作区移走，不代表任务已经完成。任务是否完成仍以 `verification.status` 为准。

归档前读取当前 `task.json`，并根据状态向用户说明语义：

- `verification.status: "passed"`：常规完成归档。
- `verification.status: "needs_fix"`：仍有修复缺口，归档后表示放弃继续处理当前任务。
- `verification.status: "blocked"`：任务验证被阻塞，归档后表示关闭这个阻塞任务。
- `verification.status: "not_started"`：任务尚未完成最终验证，归档后不代表完成。
- 顶层 `status: "blocked"`：任务仍处于阻塞状态，归档后只表示关闭。

如果用户已经明确要求归档，可以继续。若任务未验证通过，且用户没有表达关闭未完成任务的意图，先说明风险并等待确认。这个确认只发生在对话层，不写入 `task.json`。

## 执行步骤

1. 读取 `.my-cc-lite/project.json`，确认项目已初始化。
2. 扫描 `.my-cc-lite/tasks/`，确认唯一当前任务目录。
3. 读取当前任务目录下的 `plan.md` 和 `task.json`。
4. 根据 `verification.status`、顶层 `status` 和 `stage` 说明归档语义。
5. 未验证通过且用户关闭意图不明确时，先确认。
6. 基于 `plan.md`、`task.json.objective`、`verification.summary` 和当前状态生成短 `archive.summary`。
7. 调用 archive 阶段脚本，通过 stdin 传入 JSON。
8. 向用户返回归档目录、验证状态、归档摘要和下一步。

## 脚本输入

脚本调用统一使用 my-cc-lite runtime entry：

- 如果当前工作目录存在 `scripts/run.mjs`，使用：

```bash
node scripts/run.mjs archive archive
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs archive archive
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

脚本输入 JSON：

- 只允许 `summary` 字段。
- `summary` 必须是非空字符串。
- `summary` 保持一句到几句短结论，可以说明完成情况、验证状态或关闭原因。
- 不保存完整执行报告、命令输出、文件列表或 evidence。

最小示例：

```json
{
  "summary": "Verified and archived after completing the planned task."
}
```

## 禁止事项

- 不重新验证任务。
- 不执行修复。
- 不修改 `plan.md`。
- 不直接手写 `task.json`。
- 不修改 `.my-cc-lite/project.json`。
- 不修改已有 `tasks[]`、`steps[]`、`checks[]` 或 `verification`。
- 不生成 `archive.md`、完整报告、命令日志、changed files、事件日志或证据文件。
- 不自动创建新任务。
- 不设计恢复归档任务。

## 错误处理

- `PROJECT_NOT_INITIALIZED`：提示先执行 `/init`。
- `NO_ACTIVE_TASK`：提示当前没有可归档任务，先执行 `/plan`。
- `MULTIPLE_ACTIVE_TASKS`：提示当前状态异常，需要手动处理多 active task。
- `PLAN_NOT_FOUND`：提示当前 task 缺少 `plan.md`，回到 `/plan` 或手动修复。
- `TASK_STATE_NOT_FOUND`：提示先执行 `/do` 生成 `task.json`。
- `ARCHIVE_TARGET_EXISTS`：提示检查已有归档目录，脚本不会覆盖或合并。
- `INVALID_INPUT`：修正传给 archive 脚本的 JSON 输入。
- `INVALID_PROJECT_STATE`：当前 `project.json` 结构异常，需要手动检查状态文件。
- `INVALID_TASK_STATE`：当前 `task.json` 结构异常或已归档，需要手动检查状态文件。

## 完成反馈

本次 `/archive` 结束时说明：

- 归档目录。
- `verification.status`。
- `archive.summary`。
- 如果验证未通过，明确说明这次归档表示关闭任务，不表示任务完成。
- 下一步可以重新执行 `/plan` 创建新任务。
