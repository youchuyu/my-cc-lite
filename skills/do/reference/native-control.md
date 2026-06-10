# my-cc-lite 原生状态接管

本文件定义 `/do` 的 my-cc-lite 原生状态接管流程。所有状态写入必须遵守 `state-boundary.md`。

原生状态接管按单 task 循环推进。每轮只选择一个当前 task，并在确认本轮允许执行后交接执行方；任何状态写入都由 `/do` 通过 `update-task` 完成。

本流程只负责状态读取、当前 task 选择、执行交接、结果接收和状态写入；不读取业务代码、不搜索仓库、不修改业务文件、不运行项目检查命令。

## Hook-assisted chaining experiment

`SubagentStop` hook 可以在 executor、verifier 或 debugger 返回后提供下一步提示，用来提醒 `/do` 继续进入 verifier、debugger、executor 或状态写入步骤。

hook 输出只作为流程提示；`/do` 仍负责 agent 调度判断和所有状态写入。如果 hook 提示与本文件规则冲突，以本文件规则为准。

## 阶段总览

流程阶段如下：

1. 进入与读取状态
2. 选择当前 task
3. 确认执行意图
4. 准备执行交接
5. 接收 executor 结果
6. 检查当前 task
7. 写入结果并继续或停止

完成一个 task 后回到“进入与读取状态”，重新读取最新 `task.json.tasks[]`，直到全部完成或必须停止。

## 1. 进入与读取状态

### 工作内容

判断本轮 `/do` 是否进入 my-cc-lite 原生状态接管，并调用 `scripts/run.mjs do inspect` 读取最新 task 状态快照。

### 进入条件

- 首次物化后，用户选择 my-cc-lite 原生状态接管。
- 已有 `task.json`，本轮用户明确要求继续执行。

### 边界

恢复阶段只读取 `inspect` 返回的状态快照，不读取业务代码、不搜索仓库、不补全文件清单。已有 `task.json` 时，只根据 `inspect.result.task.tasks[]` 选择当前 task，不重新解释完整 `plan.md`，不重新物化，也不重新选择外部接管方式。

### 跳转

进入“选择当前 task”。

## 2. 选择当前 task

### 工作内容

根据最新 `task.json.tasks[]` 选择本轮要推进的 task。

### 跳转

- 如果所有 task 都是 **completed** 或 **skipped**，停止 `/do`，提示进入 `/verify`。
- 如果存在 **in_progress** task，选择该 task，进入“确认执行意图”。
- 如果没有 **in_progress**，但存在 **pending** task，选择第一个 **pending**，进入“确认执行意图”。
- 如果只剩 **blocked** 或 **failed** task，停止并请求用户确认恢复、重试、跳过或回到 `/plan`。

## 3. 确认执行意图

### 工作内容

确认本轮用户是否明确要求继续执行当前 task。已有 `task.json` 的恢复请求默认只恢复状态，不等同于执行许可。

状态检查型请求包括“恢复任务”、“查看进度”、“看当前状态”等；这类请求只输出当前 task 和建议动作，然后停止，不写入状态，不调度 executor。

继续执行型请求包括“继续执行”、“继续推进”、“执行当前 task”，或用户手动调用 `/do` 且没有查看状态/只恢复的限定。

### 跳转

- 如果本轮只是状态检查，停止 `/do`，说明当前 task、剩余 task 和建议下一步。
- 如果当前 task 是 **pending** 且本轮允许继续执行，写入 **in_progress**，进入“准备执行交接”。
- 如果当前 task 是 **in_progress** 且本轮允许继续执行，进入“准备执行交接”。

## 4. 准备执行交接

### 工作内容

基于当前 task 和状态边界准备执行交接信息。交接信息只表达当前 task、必要上下文和结果返回契约，不包含业务代码读取步骤、文件清单补全步骤或项目检查命令。

交接信息应包含：

- 当前 task entry：`id`、`title`、`status`、`statusReason`、`steps`、`checks`。
- 必要的 `objective` 或 `plan.md` 摘要，用于说明当前 task 的执行边界。
- 状态边界：执行方不得修改 `tasks[]` 结构，不得直接读写 `task.json`，不得直接调用 `scripts/run.mjs do ...`。
- 返回契约：执行方必须返回建议状态、简短结果摘要、关键证据摘要，以及需要写入时使用的 `statusReason`。

执行方如何读取业务代码、修改业务文件或运行检查命令，不属于本 reference 流程描述范围。

### 跳转

完成交接后等待 executor 返回结果，进入“接收 executor 结果”。

## 5. 接收 executor 结果

### 工作内容

接收 executor 返回的结果，并只做状态层判断。`/do` 不在本阶段补读业务代码、不自行验证业务实现、不自行修复失败。

executor 结果应归一为以下状态之一：

- **completed**：executor 已完成当前 task 的执行，并提供了支撑 `checks[]` 的摘要或证据摘要；该结果只表示可以进入 `verifier(task_review)`，不直接等同于可写入 **completed**。
- **blocked**：当前 task 无法继续，需要用户决策、权限、外部条件或计划调整。
- **failed**：当前 task 执行失败，且当前 `/do` 不应继续扩大修改范围。
- **skipped**：仅在用户明确确认跳过时允许。

### 跳转

- 如果结果是 **completed**，进入“检查当前 task”。
- 如果结果是 **skipped**，确认用户已经明确要求跳过后，进入“写入结果并继续或停止”。
- 如果结果是 **blocked** 或 **failed**，进入“写入结果并继续或停止”，写入后停止。
- 如果结果缺少必要摘要、证据或状态不明确，停止并请求执行方或用户补充，不猜测写入状态。

## 6. 检查当前 task

### 工作内容

委派 `verifier` 的 `task_review` mode，判断当前 task 是否满足自己的 `checks[]`。`/do` 只准备检查输入并接收判断结果，不自行补读业务代码、不自行验收当前 task。

`verifier(task_review)` 的输入应包含：

- 当前 task entry：`id`、`title`、`status`、`statusReason`、`steps`、`checks`。
- executor 的简短执行摘要、关键文件和检查结果摘要。
- 必要的文件上下文、命令输出摘要或用户补充信息。

### 跳转

- 如果 `verifier.result` 是 **passed**，进入“写入结果并继续或停止”，写入 **completed**。
- 如果 `verifier.result` 是 **needs_fix**，不写入 **completed**，当前 task 保持 **in_progress**；如果问题可由 executor 收敛，回到“准备执行交接”，如果是明确构建、类型、测试或运行时报错，可委派 `debugger`。
- 如果 `verifier.result` 是 **blocked**，停止；阻塞原因明确且当前 task 无法继续时，进入“写入结果并继续或停止”，写入 **blocked**。
- 如果检查结果缺少必要摘要、证据或状态不明确，停止并请求 verifier 或用户补充，不猜测写入状态。

## 7. 写入结果并继续或停止

### 工作内容

由 `/do` 调用 `scripts/run.mjs do update-task` 写入当前 task 的执行状态，并决定继续循环还是停止。

executor、verifier 和 debugger 不调用阶段脚本，不读写 `task.json`，不自行标记状态。

### 规则

- 写入 **completed** 后，回到“进入与读取状态”，继续选择下一个可执行 task。
- 写入 **blocked** 后，停止。
- 写入 **failed** 后，停止。
- 写入 **skipped** 只在用户明确确认跳过时发生，写入后回到“进入与读取状态”。
- **blocked**、**failed** 和 **skipped** 必须写入简短 `statusReason`。
- **pending**、**in_progress** 和 **completed** 可以清空 `statusReason`。

### 必须停止的情况

- 所有 task 都是 **completed** 或 **skipped**，停止并提示进入 `/verify`。
- 当前 task 执行、检查或修复结果为 **blocked** 或 **failed**。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 修复路径不清晰，继续会扩大修改范围或改变验收口径。
- 只剩 **blocked** 或 **failed** task，需要用户确认恢复、重试、跳过或回到 `/plan`。
