# Native Control

本文件定义 `/do` 的 my-cc-lite 原生接管流程。所有状态写入必须遵守 `state-boundary.md`。

原生接管按单 task 循环推进。每轮只处理一个当前 task，任何状态写入都由 `/do` 通过 `update-task` 完成。

## 阶段总览

流程阶段如下：

1. 进入与读取状态
2. 选择当前 task
3. 执行当前 task
4. 检查当前 task
5. 处理失败和修复
6. 写入结果并继续或停止

完成一个 task 后回到“进入与读取状态”，重新读取最新 `task.json.tasks[]`，直到全部完成或必须停止。

## 1. 进入与读取状态

### 工作内容

判断本轮 `/do` 是否进入 my-cc-lite 原生接管，并调用 `scripts/run.mjs do inspect` 读取最新 task 状态摘要。

### 进入条件

- 首次物化后，用户选择 my-cc-lite 原生接管。
- 已有 `task.json`，本轮 `/do` 需要恢复执行。

### 边界

恢复阶段只读取 `inspect` 返回的状态摘要，不读取业务代码、不搜索仓库、不补全文件清单。业务代码阅读由 executor 在当前 task 范围内渐进完成。

### 跳转

进入“选择当前 task”。

## 2. 选择当前 task

### 工作内容

根据最新 `task.json.tasks[]` 选择本轮要推进的 task。

### 跳转

- 如果所有 task 都是 **completed** 或 **skipped**，停止 `/do`，提示进入 `/verify`。
- 如果存在 **in_progress** task，恢复该 task，进入“执行当前 task”。
- 如果没有 **in_progress**，但存在 **pending** task，选择第一个 **pending**，写入 **in_progress**，进入“执行当前 task”。
- 如果只剩 **blocked** 或 **failed** task，停止并请求用户确认恢复、重试、跳过或回到 `/plan`。

## 3. 执行当前 task

### 工作内容

委派 `executor` 执行当前 task。

`executor` 的输入只包含当前 task entry、必要 `plan.md` 摘要和执行边界。`executor` 只在当前 task 范围内渐进读取业务代码，并返回执行摘要、关键证据和结果判断。

### 跳转

根据 `executor.result` 跳转：

- **completed**：进入“检查当前 task”。
- **failed**：进入“处理失败和修复”。
- **blocked**：写入 **blocked** 并停止。

## 4. 检查当前 task

### 工作内容

委派 `verifier` 的 `task_review` mode，判断当前 task 是否满足自己的 `checks[]`。

`verifier` 的输入包含当前 task、`checks[]`、executor 摘要和必要证据。

### 跳转

根据 `verifier.result` 跳转：

- **passed**：写入 **completed**，回到“进入与读取状态”。
- **needs_fix**：进入“处理失败和修复”。
- **blocked**：写入 **blocked** 并停止。

## 5. 处理失败和修复

### 工作内容

判断失败是否明确、局部、适合最小修复；必要时委派 `debugger`。

### 跳转

- 如果失败明确且适合最小修复，委派 `debugger`，并根据 `debugger.result` 跳转：
  - **fixed**：回到“检查当前 task”。
  - **suggested_fix**：由 `/do` 判断是否交回 executor 执行建议；如果需要用户确认，停止。
  - **blocked**：写入 **blocked**，或停止并请求用户决策。
- 如果失败不适合继续修复，写入 **failed** 或 **blocked** 并停止。
- 如果需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整，停止。

## 6. 写入结果并继续或停止

### 工作内容

由 `/do` 调用 `scripts/run.mjs do update-task` 写入当前 task 的执行状态，并决定继续循环还是停止。

`executor`、`verifier` 和 `debugger` 都不调用阶段脚本，不读写 `task.json`，不自行标记状态。

### 规则

- 写入 **completed** 后，回到“进入与读取状态”，继续选择下一个可执行 task。
- 写入 **blocked** 后，停止。
- 写入 **failed** 后，停止。
- 写入 **skipped** 只在用户明确确认跳过时发生，写入后回到“进入与读取状态”。
- **blocked**、**failed** 和 **skipped** 必须写入简短 `statusReason`。
- **pending**、**in_progress** 和 **completed** 可以清空 `statusReason`。

### 必须停止的情况

- 所有 task 都是 **completed** 或 **skipped**，停止并提示进入 `/verify`。
- 当前 task 执行或局部检查结果为 **blocked** 或 **failed**。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 修复路径不清晰，继续会扩大修改范围或改变验收口径。
- 只剩 **blocked** 或 **failed** task，需要用户确认恢复、重试、跳过或回到 `/plan`。
