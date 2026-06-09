# External Control

本文件定义 `/do` 的外部高阶接管流程。所有状态写入必须遵守 `state-boundary.md`。

选择外部高阶接管时，`/do` 不进入 my-cc-lite 原生 task loop，而是将完整执行上下文交给外部流程编排。

外部高阶流程接管完整 `tasks[]` 的执行编排，并可以通过 my-cc-lite 允许的状态写入接口持续更新 task 执行状态。

外部流程拥有 task 执行结果的判定权和执行状态推进权，但不拥有 task 结构修改权。它只能更新 `tasks[].status`、`tasks[].statusReason`，以及由脚本派生的顶层 `status` 和 `updatedAt`。

## 外部流程上下文

提供给外部流程的上下文包括：

- 当前 `plan.md` 摘要。
- 完整 `task.json.tasks[]`。
- 当前顶层 `status`、`stage` 和 `verification` 摘要。
- 执行边界和状态写入规则。
- 只能通过受限 `update-task` 接口写入执行状态的约束。
- 禁止修改任务结构的约束。

外部流程可以自行决定如何推进多个 task，例如：

- 按顺序执行。
- 并行分析后串行写入结果。
- 跨 task 共享上下文。
- 委派自己的 agent/helper。
- 对多个 task 持续推进状态。
- 一次性执行完整 `tasks[]`。

## 状态写入

外部流程可以通过受限接口持续落盘执行状态：

```text
scripts/run.mjs do update-task
```

每次写入必须对应现有 task id，并且只能写入允许的执行状态。

外部流程不得：

- 直接手写 `task.json`。
- 新增、删除、重排、合并或拆分 `tasks[]`。
- 修改 `tasks[].id`、`tasks[].title`、`tasks[].steps` 或 `tasks[].checks`。
- 修改 `plan.md`。
- 修改 `verification`。
- 修改 `archive`。

如果外部流程中断，后续 `/do` 看到已有 `task.json` 后，只由 my-cc-lite 原生恢复接管，根据已经落盘的 task 状态继续推进。

## 停止条件

外部流程可以自行决定如何连续推进完整 `tasks[]`，但遇到以下情况必须停止并说明原因：

- 外部流程无法可靠映射到现有 `tasks[]`。
- 外部流程需要新增、删除、重排、合并或拆分 task 才能继续。
- 外部流程需要修改 `plan.md`、`verification`、`archive` 或任务结构。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。

停止前已经形成的执行状态，仍只能通过受限 `update-task` 接口落盘到现有 task。
