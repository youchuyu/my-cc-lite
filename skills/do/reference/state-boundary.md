# Do State Boundary

my-cc-lite 原生接管和外部高阶接管共享同一套状态边界。

## 允许推进的执行状态

- `tasks[].status`
- `tasks[].statusReason`
- 由脚本维护的顶层 `status`
- 由脚本维护的顶层 `updatedAt`

## 禁止修改的任务结构和阶段状态

- `tasks[].id`
- `tasks[].title`
- `tasks[].steps`
- `tasks[].checks`
- `tasks[]` 的新增、删除、重排、合并、拆分
- `project.json`
- `plan.md`
- `verification`
- `archive`

两种接管方式都只能推进执行状态，不能修改任务结构。执行状态必须通过 my-cc-lite 的受限脚本接口写入，不能手写 `task.json`。

顶层 `stage` 在 `/do` 阶段只保持为 `executing`，不由 `/do` 推进到后续阶段。

## 状态迁移

- 常规路径是 `pending -> in_progress -> completed | blocked | failed`。
- `blocked -> in_progress` 需要用户确认，或执行方能明确判断阻塞条件已经解除。
- `failed -> in_progress` 需要明确重试意图，或 debugger / 外部流程已给出可继续执行的最小修复路径。
- `completed` 和 `skipped` 默认不回退；只有用户明确要求重新执行，或回到 `/plan` 调整计划后，才允许重新进入执行路径。
