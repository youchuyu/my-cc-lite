# Native Control

本文件定义 `/do` 的 my-cc-lite 原生接管流程。所有状态写入必须遵守 `state-boundary.md`。

选择 my-cc-lite 原生接管，或已有 `task.json` 需要恢复执行时，`/do` 使用内置 task loop 推进 `tasks[]`。

## 状态路由

每轮循环先根据最新 `task.json.tasks[]` 做状态路由：

- 如果所有 task 都是 `completed` 或 `skipped`，停止 `/do`，提示进入 `/verify`。
- 如果存在 `in_progress` task，优先恢复该 task。
- 如果没有 `in_progress`，但存在 `pending` task，选择第一个 `pending`。
- 如果只剩 `blocked` 或 `failed` task，停止并请求用户确认恢复、重试、跳过或回到 `/plan`。

恢复阶段只读取 `inspect` 返回的状态摘要，不读取业务代码、不搜索仓库、不补全文件清单。业务代码阅读由 executor 在当前 task 范围内渐进完成。

## 原生链路

选出当前 task 后，原生链路如下：

1. 调用 `scripts/run.mjs do update-task`，将当前 task 标记为 `in_progress`。
2. 委派 `executor` 执行当前 task。输入只包含当前 task entry、必要 `plan.md` 摘要和执行边界。
3. 委派 `verifier` 的 `task_review` mode，判断当前 task 是否满足自己的 `checks[]`。
4. 必要时委派 `debugger` 处理明确失败。
5. `/do` 根据 agent 输出调用 `update-task` 写入 `completed`、`blocked` 或 `failed`。
6. 当前 task 完成后回到状态路由，继续下一个 `pending` task。

## Agent 结果路由

agent 结果路由只属于 my-cc-lite 原生接管：

- `executor.result: completed`：进入 `verifier(task_review)`。
- `executor.result: failed`：如果失败明确且适合最小修复，可以进入 `debugger`；否则写入 `failed` 或 `blocked` 并停止。
- `executor.result: blocked`：写入 `blocked` 并停止。
- `verifier.result: passed`：写入 `completed`，然后回到 task 状态路由。
- `verifier.result: needs_fix`：如果原因明确且适合最小修复，可以进入 `debugger`；否则写入 `failed` 或 `blocked` 并停止。
- `verifier.result: blocked`：写入 `blocked` 并停止。
- `debugger.result: fixed`：回到 `verifier(task_review)`。
- `debugger.result: suggested_fix`：由 `/do` 判断是否交回 executor 执行建议；如果需要用户确认，停止。
- `debugger.result: blocked`：写入 `blocked`，或停止并请求用户决策。

`executor`、`verifier` 和 `debugger` 都不调用阶段脚本，不读写 `task.json`，不自行标记状态。

## 停止条件

原生接管默认连续推进可执行 task，直到遇到以下情况：

- 所有 task 都是 `completed` 或 `skipped`，停止并提示进入 `/verify`。
- 当前 task 执行或局部检查结果为 `blocked` 或 `failed`。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 修复路径不清晰，继续会扩大修改范围或改变验收口径。

停止时必须说明原因，并在需要落盘时通过 `update-task` 写入对应 task 的执行状态。
