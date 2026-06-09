---
name: do
description: 执行当前 my-cc-lite plan.md 并推进 task.json 任务状态
---

# Do

`/do` 是 my-cc-lite 的执行阶段。它把当前 active task 的 `plan.md` 首次物化为 `task.json`，然后默认连续推进其中所有可执行的 `tasks[]` entry。

`/do` 只维护 task 级执行状态，不维护 step/check 级状态，不做最终验收，不归档任务。

## 使用条件

当用户手动调用 `/do`，或明确要求继续执行当前 my-cc-lite 任务时使用。

当前工作目录必须是目标项目根目录。项目必须已执行 `/init`，且 `.my-cc-lite/tasks/` 下只能有一个未归档任务目录。

## 执行步骤

1. 调用 `scripts/run.mjs do inspect`，读取当前 `/do` 状态快照。
2. 如果 `inspect` 返回 `PROJECT_NOT_INITIALIZED`、`NO_ACTIVE_TASK`、`MULTIPLE_ACTIVE_TASKS` 或 `PLAN_NOT_FOUND`，按错误码提示用户处理，不自行绕过脚本扫描状态。
3. 如果 `inspect.result.task.exists === false`，将 `inspect.result.plan.content`、`inspect.result.taskDir` 和首次物化约束交给 `task-materializer`，获取 `materialize` 输入草案。
4. 检查 `task-materializer.result`：`ready` 时调用 do 阶段脚本执行 `materialize`；`coarse_ready` 时先让用户确认；`needs_plan_update` 或 `blocked` 时停止并说明原因。
5. 如果 `ready` 分支刚刚物化成功且本轮需要继续执行，再次调用 `scripts/run.mjs do inspect` 获取最新状态快照。
6. 根据最新 `inspect.result.task.tasks[]` 判断当前执行状态：
   - 如果所有 task 都是 `completed` 或 `skipped`，提示进入 `/verify`。
   - 如果只剩 `blocked` 或 `failed`，说明原因并请求用户处理阻塞、确认重试、跳过或回到 `/plan`。
   - 如果存在 `in_progress` 或 `pending`，继续执行方式判断。
7. 基于当前 `plan.md` 和完整 `task.json.tasks[]` 分析本任务整体执行结构，列出可编排或委派 agent 的高阶执行方式候选。
8. 判断本次 `/do` 的执行方式：
   - 用户已明确指定执行方式时，直接使用该方式。
   - 用户明确要求连续执行但未指定方式时，默认使用 my-cc-lite 内置 agent 调度链。
   - 存在明显匹配的外部高阶执行能力时，说明候选项的适用性、风险和推荐项，并让用户选择。
   - 没有外部高阶能力时，默认使用 my-cc-lite 内置 agent 调度链。
9. 本次 `/do` 后续 task 沿用选定执行方式；只有后续 task 性质明显变化或触发停止条件，才重新判断。
10. 根据最新 `inspect.result.task.tasks[]` 选择可执行 task：优先 `in_progress`，否则第一个 `pending`。
11. 对当前 task 调用 do 阶段脚本执行 `update-task`，标记为 `in_progress`。
12. 按选定执行方式推进当前 task：使用 my-cc-lite 原生执行时，调度 `executor` agent 执行当前 task；使用外部高阶执行方式时，将当前 task、必要 plan 摘要、完整 `tasks[]` 摘要、执行边界和状态更新规则提供给调度方，由其完成 agent 编排并返回执行结果和状态建议。
13. 使用 `verifier` 的 `task_review` mode 或必要检查判断当前 task 是否满足自己的 `checks[]`。
14. 根据结果调用 `update-task` 写入 `completed`、`blocked` 或 `failed`。
15. 当前 task 完成后重新读取或使用最新 `task.json.tasks[]` 摘要，继续选择下一个 `pending` task。
16. 循环直到所有 task 完成或跳过，或遇到停止条件。
17. 向用户汇总本次连续执行完成内容、局部检查结果、剩余 task 和下一步。

首次 materialize 成功后，默认继续执行第一个 `pending` task，并在每个 task 通过局部检查后继续推进下一个 `pending` task。只有任务拆解会改变计划目标、范围或验收口径，才在创建 `task.json` 后停止并提示回到 `/plan`。

恢复阶段只读取 `inspect` 返回的状态摘要，不读取业务代码、不搜索仓库、不补全文件清单。业务代码阅读由 executor 在当前 task 范围内渐进完成。

恢复到 `in_progress` task 后，`/do` 仍只负责选择 task 和调度 executor，不在主流程中补读业务上下文。

## 从 plan.md 生成 tasks[]

生成规则：

- `Objective` 形成 `task.json.objective`。
- `Plan` 的主要编号项通常形成一个 task。
- `Goal` 形成 task `title` 和执行边界。
- `Do` 形成 `steps[]`。
- `Check` 形成 `checks[]`。
- 需要独立状态、失败重试、跳过或单独委派的工作提升为独立 task。
- 复杂动作可以在 `steps[]` 中嵌套为 `{ "title": "...", "steps": [...] }`。

如果 `Objective` 缺失或过于空泛，停止并提示回到 `/plan`。

如果 `Plan` 缺少可执行工作项，但目标仍清楚，可以形成一个粗粒度 task；如果验收口径也缺失，应停止并提示回到 `/plan`。

首次物化默认只依赖 `plan.md` 的目标、计划项和验收口径。允许的有限事实确认包括：

- 读取 `plan.md` 明确提到的文件或目录。
- 查看项目顶层结构，用于判断任务应按文件、模块还是文档拆分。
- 读取少量已有约定文档，例如 README 或设计说明。

如果拆解必须依赖大量实现细节，不要在 `/do` 主流程里继续展开读取。此时应暂停并提示回到 `/plan` 补清范围，或本次只形成粗粒度 `tasks[]` 后停止，不继续执行 task。

## 脚本输入

脚本调用统一使用 my-cc-lite runtime entry。`scripts/run.mjs` 必须来自 my-cc-lite 插件根目录，不能因为目标项目根目录下存在同名 `scripts/run.mjs` 就直接调用。

- 如果当前工作目录就是 my-cc-lite 插件源码根目录，且确认该 `scripts/run.mjs` 属于 my-cc-lite，可以使用：

```bash
node scripts/run.mjs do materialize
node scripts/run.mjs do update-task
node scripts/run.mjs do inspect
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs do materialize
node <pluginRoot>/scripts/run.mjs do update-task
node <pluginRoot>/scripts/run.mjs do inspect
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

首次物化：

```json
{
  "objective": "Objective snapshot derived from plan.md",
  "tasks": [
    {
      "id": "T1",
      "title": "Implement the first planned task",
      "steps": ["Read the relevant files"],
      "checks": ["The implementation matches plan.md"]
    }
  ]
}
```

如果 `task-materializer` 返回的是带流程控制字段的完整结果，调用 `materialize` 前只传入 `objective` 和 `tasks`。`result`、`shouldStopAfterMaterialize` 和 `reason` 只由 `/do` skill 用于流程判断，不传给脚本。

状态更新：

```json
{
  "id": "T1",
  "status": "completed",
  "statusReason": ""
}
```

`blocked`、`failed` 和 `skipped` 必须写一句简短 `statusReason`。`pending`、`in_progress` 和 `completed` 可以清空 `statusReason`。

## 连续执行停止条件

`/do` 默认连续执行，但遇到以下情况必须停止并说明原因：

- 当前 task 执行或局部检查结果为 `blocked` 或 `failed`。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 当前 task 的修复路径不清晰，继续会扩大修改范围或改变验收口径。
- 所有 task 都已是 `completed` 或 `skipped`，此时提示进入 `/verify`。

## 执行方式

执行方式只影响本次 `/do` 调用中的协作，不写入任何状态文件。

外部高阶执行方式可以编排自己的 agent/helper 完成当前 task，但不得直接读写 `task.json` 或调用 do 阶段脚本；它只能返回执行摘要、检查结论、建议状态和必要 `statusReason`，由 `/do` 统一调用 `update-task` 写入状态。

执行方式的主要分析依据是当前 `plan.md` 和完整 `task.json.tasks[]`，而不是某个 task 的局部实现细节。当前 task 只用于确定正在推进的执行单元，以及它在整体任务中的位置。

列出候选执行方式时考虑：

- `plan.md` 的目标、范围和验收口径。
- `tasks[]` 的数量、顺序和依赖关系。
- 子 task 是否同质重复、是否需要共享上下文、是否适合委派。
- `project.json.stageHelpers.execution` 中是否存在明确匹配的外部 helper。
- 用户是否明确指定外部 workflow/helper。

选择执行方式时需要说明每个候选项的适用性、风险和是否推荐。用户已明确要求连续执行时，不要在每个 task 前反复请求选择；沿用推荐方式推进，除非后续 task 的性质明显变化。

候选项只包括能编排或委派执行的能力：

- my-cc-lite `/do` 原生执行。
- 当前上下文可见的外部高阶执行能力，如：Workflow、TeamCreate 等。
- `project.json.stageHelpers.execution` 中的外部 execution helper。
- 用户明确指定的外部 workflow/helper。

不要把 `Read`、`Write`、`Edit`、`Bash` 等原子工具，或 my-cc-lite 内置的 `executor`、`verifier`、`debugger` 列为执行方式选项。

如果没有合适外部高阶能力，默认使用 my-cc-lite `/do` 原生执行。

## 内置 agent 调度

my-cc-lite `/do` 原生执行时，每个 task 默认按以下链路推进：

1. `/do` 调用 `update-task`，将当前 task 标记为 `in_progress`。
2. 委派 `executor` 执行当前 task。输入只包含当前 task entry、必要 `plan.md` 摘要和执行边界。
3. `executor` 返回简短执行摘要、关键文件和必要检查结果。
4. 委派 `verifier` 的 `task_review` mode。输入包含当前 task、`checks[]`、executor 摘要和必要证据。
5. 如果 `task_review` 返回 `passed`，`/do` 调用 `update-task` 将当前 task 标记为 `completed`，然后继续下一个 `pending` task。
6. 如果 executor 执行失败，或 `task_review` 返回 `needs_fix` 且失败原因是明确的构建、类型、测试或运行时报错，可以委派 `debugger` 做最小修复或给出最小修复路径。
7. debugger 修复后回到 executor / verifier 路径；如果无法给出清晰修复路径，`/do` 将当前 task 标记为 `blocked` 或 `failed` 并停止连续执行。
8. 如果 `task_review` 返回 `blocked`，或当前 task 需要用户决策、权限、外部条件或计划调整，`/do` 将当前 task 标记为 `blocked` 并停止连续执行。

`executor`、`verifier` 和 `debugger` 只返回判断和摘要，不调用 `scripts/run.mjs do ...`，不读写 `task.json`，不自行标记状态。

## 状态边界

`/do` skill 必须通过 my-cc-lite runtime entry 写入状态，不直接手写 `task.json`。

`/do` 只允许推进：

- `tasks[].status`
- `tasks[].statusReason`
- 顶层 `status`
- 顶层 `updatedAt`

顶层 `stage` 在 `/do` 阶段只保持为 `executing`，不由 `/do` 推进到后续阶段。

状态迁移保持单一路径：

- 常规路径是 `pending -> in_progress -> completed | blocked | failed`。
- `blocked -> in_progress` 需要用户确认，或 `/do` 能明确判断阻塞条件已经解除。
- `failed -> in_progress` 需要明确重试意图，或 debugger 已给出可继续执行的最小修复路径。
- `completed` 和 `skipped` 默认不回退；只有用户明确要求重新执行，或回到 `/plan` 调整计划后，才允许重新进入执行路径。

`/do` 不修改：

- `project.json`
- `plan.md`
- `tasks[].id`
- `tasks[].title`
- `tasks[].steps`
- `tasks[].checks`
- `verification`
- `archive`

## 禁止事项

`/do` 不做以下事情：

- 不创建新的 active task。
- 不自动同步后续手改的 `plan.md` 到已有 `task.json.tasks[]`。
- 不新增、删除、重排、合并或拆分已有 `tasks[]`。
- 不保存 agent prompt、完整响应、命令日志、changed files 或 check 级结果。
- 不调用 `/verify`、不标记最终通过、不自动归档。
- 不让 executor、verifier、debugger 或外部 helper 直接调用 `scripts/run.mjs do ...`、直接调用 `scripts/do.mjs` 或读写 `task.json`。

## 错误处理

- `PROJECT_NOT_INITIALIZED`：提示先执行 `/init`。
- `NO_ACTIVE_TASK`：提示先执行 `/plan`。
- `MULTIPLE_ACTIVE_TASKS`：提示当前状态异常，需要手动处理多 active task。
- `PLAN_NOT_FOUND`：提示当前 task 缺少 `plan.md`，回到 `/plan` 或手动修复。
- `TASK_ALREADY_MATERIALIZED`：读取现有 `task.json` 并恢复执行。
- `TASK_STATE_NOT_FOUND`：只能在 `update-task` 时出现，先执行 materialize。
- `TASK_NOT_FOUND`：不要隐式新增 task，提示回到 `/plan` 调整。

## 完成反馈

本次 `/do` 结束时说明：

- 已推进的 task id 和标题。
- 本次连续执行结果。
- 局部检查结论。
- 剩余 `pending` / `blocked` / `failed` task。
- 如果所有 task 都已完成或跳过，说明执行阶段 task 已完成，下一步进入 `/verify`；如果中途停止，说明停止原因和下一步处理方式。
