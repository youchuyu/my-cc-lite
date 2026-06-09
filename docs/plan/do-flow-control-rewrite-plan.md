# /do 流程控制重写方案

## 背景

当前 `skills/do/SKILL.md` 中的 `/do` 流程把首次物化、执行方式选择、task 状态路由、单 task 执行链和停止条件写在一条线性步骤里。这样容易让“执行方式选择”被误读成单个 task 的局部分支，也容易让外部高阶流程变成只能返回建议、无法在多 agent 编排中可靠落盘执行进度。

本方案将 `/do` 重写为“首次物化后选择接管方式”的结构：

- 如果当前任务还没有 `task.json`，先进入首次物化流程。
- 首次物化成功并拿到完整 `task.json.tasks[]` 后，选择后续完整执行流程的接管方式。
- 接管方式分为 my-cc-lite 原生接管和外部高阶接管。
- my-cc-lite 原生接管由 `/do` skill 编排 task loop，并调用 `update-task` 写入状态。
- 外部高阶接管由外部流程编排完整 `tasks[]`，并通过受限的 `update-task` 接口持续写入执行状态。
- 如果当前任务已经有 `task.json`，不重新选择接管方式，只由 my-cc-lite 原生恢复接管。

本方案只重写流程表达和提示结构，不新增状态字段、不新增 agent、不修改 `task.json` 结构。

## Goal

将 `/do` 流程改写成更通顺的结构：

```text
/do
-> 入口检查
-> 根据 task.json 是否存在分流
   -> 不存在：首次物化流程
      -> ready 物化成功后：选择接管方式
         -> my-cc-lite 原生接管
         -> 外部高阶接管
      -> coarse_ready 物化后默认停止
      -> needs_plan_update / blocked 停止
   -> 已存在：my-cc-lite 原生恢复接管
-> 汇总 / 停止 / 提示进入 verify
```

目标包括：

- 明确接管方式选择只在首次物化成功后出现，基于完整 `task.json.tasks[]` 做整体判断。
- 明确已有 `task.json` 的后续 `/do` 只能走 my-cc-lite 原生恢复接管。
- 明确 my-cc-lite 原生接管和外部高阶接管是两个平级执行流程。
- 明确外部高阶接管可以推进执行状态，以支持多 agent 编排中断后的恢复。
- 明确两种接管方式都不能修改任务结构。
- 保持状态写入经过 my-cc-lite 的受限脚本接口。

## Scope

建议修改：

- `skills/do/SKILL.md`
- `skills/do/reference/native-control.md`
- `skills/do/reference/external-control.md`
- `skills/do/reference/state-boundary.md`
- `docs/design/04-do-stage-design.md`

可能需要同步确认：

- `docs/design/01-stage-scripts.md`

不修改：

- `task.json` schema
- `agents/*.md` 职责边界
- `project.json.stageHelpers`
- `/verify`、`/archive` 流程

暂不新增：

- 新 agent
- 新持久字段
- 新任务结构字段

## Do

### 1. 重写 `skills/do/SKILL.md` 的流程总览

将当前 `## 执行步骤` 改写为 `## 流程总览`。

建议流程总览开头写成：

```markdown
`/do` 每次从 `inspect` 开始，读取当前 active task 的状态快照。入口检查通过后，`/do` 先根据当前任务是否已经存在 `task.json` 分流：

- 如果 `task.json` 不存在，进入首次物化流程。首次物化成功后，`/do` 基于完整 `task.json.tasks[]` 选择后续完整执行流程的接管方式。
- 如果 `task.json` 已存在，`/do` 不重新选择接管方式，只进入 my-cc-lite 原生恢复接管。

接管方式面向完整 `task.json`，决定后续整个 `tasks[]` 如何推进：

- my-cc-lite 原生接管：`/do` skill 使用内置 task loop 编排执行，并调用 `update-task` 写入执行状态。
- 外部高阶接管：外部流程接管完整 `tasks[]` 的执行编排，并通过受限的 `update-task` 接口持续写入执行状态。

无论采用哪种接管方式，都只能推进执行状态，不能修改任务结构。
```

### 2. 增加入口检查小节

来源是现有第 1-2 步。

保留语义：

- 调用 `scripts/run.mjs do inspect`。
- 如果返回 `PROJECT_NOT_INITIALIZED`、`NO_ACTIVE_TASK`、`MULTIPLE_ACTIVE_TASKS` 或 `PLAN_NOT_FOUND`，按错误码提示用户处理。
- 不自行绕过脚本扫描状态。

建议补一句边界：

```markdown
入口检查只确认当前是否存在可执行的 active task，不物化 `task.json`，不选择接管方式，不调度 agent。
```

### 3. 增加首次物化流程小节

来源是现有第 3-5 步，以及 `从 plan.md 生成 tasks[]` 的相关规则。

进入条件：

```text
inspect.result.task.exists === false
```

流程：

```text
1. 将 inspect.result.plan.content、inspect.result.taskDir 和首次物化约束交给 task-materializer。
2. 检查 task-materializer 返回的 result。
3. 对 ready 调用 materialize，成功后重新 inspect。
4. 对 coarse_ready 先让用户确认，确认后 materialize，并默认停止。
5. 对 needs_plan_update 或 blocked 停止并说明原因。
```

保留现有结果路由：

- `ready`：调用 `scripts/run.mjs do materialize`，只传入 `objective` 和 `tasks`；成功后重新 `inspect`，进入接管方式选择。
- `coarse_ready`：先让用户确认粗粒度拆解；确认后调用 `materialize`，并默认在物化成功后停止。
- `needs_plan_update`：不创建 `task.json`，提示回到 `/plan` 补清目标、范围、执行边界或验收口径。
- `blocked`：不创建 `task.json`，说明缺少的文件、权限、外部条件或上下文。

保留语义：

- `task-materializer` 只生成 `materialize` 输入草案。
- `/do` 只消费 `result`、`objective`、`tasks`、`shouldStopAfterMaterialize` 和 `reason`。
- 调用 `materialize` 前只传入 `objective` 和 `tasks`。
- `shouldStopAfterMaterialize` 只影响本轮 `/do` 是否继续执行，不写入 `task.json`。
- 首次物化不大范围读取业务代码。

### 4. 增加 ready 物化后的接管方式选择小节

进入条件：

```text
task.json 首次物化成功，并且 /do 已重新 inspect 拿到完整 task.json.tasks[]
```

建议写法：

```markdown
接管方式选择只在首次物化成功后出现。此时 `/do` 已经拿到完整 `task.json.tasks[]`，可以基于当前 `plan.md` 和完整任务结构判断后续执行流程由谁接管。

接管方式选择不是当前 task 的局部选择，而是完整 `task.json` 的整体执行策略。它决定后续 `tasks[]` 是由 my-cc-lite 原生 task loop 推进，还是由外部高阶流程整体接管编排。
```

判断依据：

- `plan.md` 的目标、范围和验收口径。
- `tasks[]` 的数量、顺序、依赖关系和同质性。
- 子 task 是否需要跨 task 共享上下文。
- 子 task 是否适合由外部 workflow/helper 统一编排。
- `project.json.stageHelpers.execution` 中是否存在明确匹配的外部 helper。
- 用户是否明确指定外部 workflow/helper。

选择规则：

- 用户已明确指定接管方式时，直接使用该方式。
- 用户明确要求使用 my-cc-lite 原生执行时，进入原生接管。
- 用户明确要求连续执行但未指定方式，且没有明显外部高阶能力时，默认进入 my-cc-lite 原生接管。
- 存在明显匹配的外部高阶执行能力时，说明候选项的适用性、风险和推荐项，并让用户选择。
- 没有外部高阶能力时，默认进入 my-cc-lite 原生接管。

候选项只包括能接管或编排完整执行流程的高阶能力：

- my-cc-lite 原生接管。
- 当前上下文可见的外部高阶执行能力，例如 Workflow、TeamCreate 等。
- `project.json.stageHelpers.execution` 中的外部 execution helper。
- 用户明确指定的外部 workflow/helper。

保留限制：

- 不要把 `Read`、`Write`、`Edit`、`Bash` 等原子工具列为接管方式选项。
- 不要把 my-cc-lite 内置的 `executor`、`verifier`、`debugger` 列为接管方式选项。
- 接管方式只影响首次物化后的完整 `task.json` 执行编排，不写入状态文件。
- 因为接管方式不写入状态文件，后续已有 `task.json` 的 `/do` 只能走 my-cc-lite 原生恢复接管。

### 5. 抽出共享状态边界 reference

新增 `skills/do/reference/state-boundary.md`，承载 my-cc-lite 原生接管和外部高阶接管共享的状态边界。

允许推进的执行状态：

- `tasks[].status`
- `tasks[].statusReason`
- 由脚本维护的顶层 `status`
- 由脚本维护的顶层 `updatedAt`

禁止修改的任务结构和阶段状态：

- `tasks[].id`
- `tasks[].title`
- `tasks[].steps`
- `tasks[].checks`
- `tasks[]` 的新增、删除、重排、合并、拆分
- `project.json`
- `plan.md`
- `verification`
- `archive`

`skills/do/SKILL.md` 中只保留 reference 引用。建议写法：

```markdown
两种接管方式都必须遵守 `reference/state-boundary.md`，只能通过受限 `update-task` 接口推进执行状态，不能修改任务结构。
```

### 6. 将 my-cc-lite 原生接管抽成独立 reference

my-cc-lite 原生接管用于两种入口：

- 首次物化后，接管方式选择结果是 my-cc-lite 原生接管。
- 当前任务已经存在 `task.json`，本轮 `/do` 进入恢复执行。

新增 `skills/do/reference/native-control.md` 承载详细流程。`skills/do/SKILL.md` 中保留摘要和引用，建议写法：

```markdown
## my-cc-lite 原生接管

用于首次物化后选择原生接管，或已有 `task.json` 的恢复执行。按 `reference/native-control.md` 执行，并遵守 `reference/state-boundary.md`。

核心路径是：根据最新 `task.json.tasks[]` 做状态路由，标记当前 task 为 `in_progress`，委派 `executor`，调用 `verifier(task_review)`，必要时委派 `debugger`，再通过 `update-task` 写入结果并继续下一个可执行 task。
```

每轮循环先根据最新 `task.json.tasks[]` 做状态路由：

- 如果所有 task 都是 `completed` 或 `skipped`，停止 `/do`，提示进入 `/verify`。
- 如果存在 `in_progress` task，优先恢复该 task。
- 如果没有 `in_progress`，但存在 `pending` task，选择第一个 `pending`。
- 如果只剩 `blocked` 或 `failed` task，停止并请求用户确认恢复、重试、跳过或回到 `/plan`。

保留恢复边界：

```markdown
恢复阶段只读取 `inspect` 返回的状态摘要，不读取业务代码、不搜索仓库、不补全文件清单。业务代码阅读由 executor 在当前 task 范围内渐进完成。
```

选出当前 task 后，保留原生链路：

```text
1. 调用 scripts/run.mjs do update-task，将当前 task 标记为 in_progress。
2. 委派 executor 执行当前 task。
3. 委派 verifier 的 task_review mode，判断当前 task 是否满足自己的 checks[]。
4. 必要时委派 debugger 处理明确失败。
5. /do 根据 agent 输出调用 update-task 写入 completed、blocked 或 failed。
6. 当前 task 完成后回到状态路由，继续下一个 pending task。
```

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

保留边界：

- `executor`、`verifier` 和 `debugger` 都不调用阶段脚本。
- `executor`、`verifier` 和 `debugger` 都不读写 `task.json`。
- `executor`、`verifier` 和 `debugger` 都不自行标记状态。

### 7. 将外部高阶接管抽成独立 reference

外部高阶接管只用于一种入口：

- 首次物化后，接管方式选择结果是外部高阶接管。

新增 `skills/do/reference/external-control.md` 承载详细流程。`skills/do/SKILL.md` 中保留摘要和引用，建议写法：

```markdown
## 外部高阶接管

只用于首次物化成功后的接管方式选择。按 `reference/external-control.md` 执行，并遵守 `reference/state-boundary.md`。

外部流程可以编排完整 `tasks[]`，但只能通过受限 `update-task` 接口推进现有 task 状态，不能修改任务结构。中断后，后续 `/do` 由 my-cc-lite 原生恢复接管。
```

外部高阶接管的核心语义：

```markdown
外部高阶流程接管完整 `tasks[]` 的执行编排，并可以通过 my-cc-lite 允许的状态写入接口持续更新 task 执行状态。

外部流程拥有 task 执行结果的判定权和执行状态推进权，但不拥有 task 结构修改权。它只能更新 `tasks[].status`、`tasks[].statusReason`，以及由脚本派生的顶层 `status` 和 `updatedAt`。
```

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

### 8. 调整连续执行和停止小节

保留现有连续执行语义，但区分两种接管方式：

- my-cc-lite 原生接管默认连续推进 `pending` task，直到所有 task 完成或跳过，或遇到停止条件。
- 外部高阶接管由外部流程决定如何连续推进完整 `tasks[]`，并通过受限 `update-task` 接口持续落盘执行状态。

停止条件：

- 当前 task 执行或局部检查结果为 `blocked` 或 `failed`。
- 外部流程无法可靠映射到现有 `tasks[]`。
- 外部流程需要修改任务结构才能继续。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 修复路径不清晰，继续会扩大修改范围或改变验收口径。
- 所有 task 都已是 `completed` 或 `skipped`，此时提示进入 `/verify`。

完成反馈保留现有语义，并补充接管方式：

- 使用的接管方式。
- 已推进的 task id 和标题。
- 本次执行结果。
- 局部检查结论或外部检查摘要。
- 剩余 `pending` / `blocked` / `failed` task。
- 如果所有 task 都已完成或跳过，说明下一步进入 `/verify`。

### 9. 同步 `docs/design/04-do-stage-design.md`

只同步设计表达，不扩展状态结构。

重点同步：

- 流程总览先根据 `task.json` 是否存在分流。
- 接管方式选择只在首次物化成功后出现。
- 已有 `task.json` 的 `/do` 只能走 my-cc-lite 原生恢复接管。
- my-cc-lite 原生接管和外部高阶接管是两个平级执行流程。
- `skills/do/reference/native-control.md`、`skills/do/reference/external-control.md` 和 `skills/do/reference/state-boundary.md` 是 `/do` skill 的运行时参考。
- 外部高阶接管可以通过受限 `update-task` 接口推进执行状态。
- 外部高阶接管不能修改任务结构。
- `executor`、`verifier`、`debugger` 是原生接管的内置链路，不是外部高阶接管必须经过的节点。

### 10. 评估 `docs/design/01-stage-scripts.md` 是否需要补充外部写入边界

当前脚本层已有 `do update-task`，可以作为受限状态写入接口。

需要检查 `01-stage-scripts.md` 是否存在过强表述，例如：

- 只有 `/do` skill 可以调用 `update-task`。
- 外部 helper 不得调用任何 do 阶段脚本。

如果存在，应改成更精确的边界：

```markdown
`update-task` 是 do 阶段唯一允许推进 task 执行状态的受限接口。my-cc-lite 原生接管由 `/do` skill 调用该接口；外部高阶接管时，外部流程也只能通过该接口推进执行状态，不能直接手写 `task.json` 或修改任务结构。
```

该调整不新增脚本，只是明确已有脚本接口在外部高阶接管下的使用边界。

## Check

本轮是文档和 prompt 流程结构调整，不需要新增测试文件。

建议检查：

```bash
git diff --check
```

人工检查重点：

- `ready`、`coarse_ready`、`needs_plan_update`、`blocked` 的首次物化语义没有变化。
- 接管方式选择只在首次物化成功后出现，并且明确是完整 `task.json` 级别。
- 已有 `task.json` 的后续 `/do` 只能走 my-cc-lite 原生恢复接管。
- my-cc-lite 原生接管和外部高阶接管是两个独立章节。
- 外部高阶接管可以推进执行状态，但不能修改任务结构。
- 状态写入仍通过 `scripts/run.mjs do update-task` 受限接口。
- 外部流程不能直接手写 `task.json`。
- `executor`、`verifier`、`debugger` 不直接写 `task.json`，也不自行标记状态。
