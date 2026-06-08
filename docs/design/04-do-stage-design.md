# Do Stage Design

本设计定义 my-cc-lite `/do` 阶段的职责、执行模型和脚本协议。它建立在 `00-core-workflow-state.md`、`01-stage-scripts.md` 和 `03-plan-stage-design.md` 之上。

`/do` 的核心作用是把当前 active task 从 `plan.md` 推进到可恢复的执行状态，并按 `task.json.tasks[]` 推进实际工作。

## 核心契约

`/do` 必须保持这些边界：

- `/plan` 只创建任务目录和 `plan.md`。
- `/do` 首次执行时根据最新 `plan.md` 创建 `task.json`。
- `task.json` 是执行阶段的唯一机器状态源。
- `tasks[]` 面向 executor 子 agent。
- `steps[]` 可以嵌套表达动作拆解，但不维护 step 级状态。
- `checks[]` 保持扁平字符串数组，供后续 `/verify` 使用。
- `/do` skill 是轻量 orchestrator，负责状态读写调用、task 选择和 agent 协作。
- `/do` 不更新 `project.json`，不记录 changed files，不保存执行日志。

`/do` 可以补充局部实现细节，例如任务顺序、文件落点、局部技术判断和执行检查口径；但不应重新定义 `/plan` 已确认的目标、范围、核心方案或完成标准。

如果执行时发现缺口会改变方案方向、范围边界或验收口径，`/do` 应暂停执行，并提示用户回到 `/plan` 更新 `plan.md`。

## 输入和输出

`/do` 开始时必须满足：

- `.my-cc-lite/project.json` 存在且结构合法。
- `.my-cc-lite/tasks/` 下只有一个 active task 目录。
- 当前 task 目录下存在 `plan.md`。

`task.json` 可以不存在。不存在表示当前任务还没有进入执行阶段，`/do` 会在本次执行中创建它。

如果没有 active task，`/do` 应提示先执行 `/plan`。如果存在多个 active task，`/do` 必须停止，不做隐式选择。

`/do` 的输出是一次连续执行推进结果：

- 首次执行时创建 `.my-cc-lite/tasks/<taskId>/task.json`。
- 后续执行时更新已有 `task.json` 中的 task 级状态。
- 在对话中说明本次完成内容、局部检查结果、阻塞原因或下一步建议。

`/do` 不负责：

- 创建新任务目录。
- 修改 `plan.md` 的目标、范围或验收口径。
- 更新 `project.json`。
- 替代 `/verify` 给出最终通过结论。
- 自动归档任务。
- 维护 step/check 级状态、执行日志或 changed files。

## 执行模型

`/do` skill 负责模型侧协作，`scripts/do.mjs` 只负责确定性状态读写。

默认一次 `/do` 连续推进当前 active task 中所有可执行的 task。每次状态写入仍只更新一个 task；用户再次调用 `/do` 时，从已有 `task.json` 恢复进度并继续处理剩余可执行 task。

### 执行方式选择

`/do` skill 开始连续执行前，先让模型基于当前 `plan.md`、`task.json`、当前 task 和可见上下文，列举可用于编排 agent 完成这些 task 的高阶执行能力，再整理给用户选择或直接采用推荐方式。

候选项只包括能编排或委派执行的高阶能力，例如 my-cc-lite `/do` 原生执行、外部高阶执行能力如：Workflow
、TeamCreate等。不要列举 `Read`、`Write`、`Edit`、`Bash` 等原子工具，也不要列举 my-cc-lite 内置的 `executor`、`verifier`、`debugger`。

模型列举时应说明每个候选项的适用性、风险和是否推荐。如果用户已明确要求连续执行，或没有合适的外部高阶能力，默认使用 my-cc-lite `/do` 原生执行，不在每个 task 前反复请求确认。

执行方式选择只影响本次 `/do` 如何执行当前 task，不写入 `project.json`、`task.json` 或新的 metadata。`scripts/do.mjs` 不负责发现、选择或调用执行方式。

### 主流程

1. 读取 `.my-cc-lite/project.json`。
2. 定位唯一 active task。
3. 读取当前 `plan.md`。
4. 读取 `task.json`。
5. 如果 `task.json` 不存在，执行首次物化。
6. 选择下一个可执行 task。
7. 确定本次执行方式。
8. 调用 `scripts/do.mjs update-task` 将该 task 标记为 `in_progress`。
9. 按已选执行方式执行当前 task。
10. 执行完成后，委派 `verifier` 的 `task_review` mode，或由 `/do` skill 自行做局部检查。
11. 根据执行和局部检查结果，将该 task 标记为 `completed`、`blocked` 或 `failed`。
12. 重新读取或使用最新 `task.json.tasks[]` 摘要。
13. 如果仍有可执行 `pending` task，继续执行步骤 6。
14. 如果所有 task 都是 `completed` 或 `skipped`，提示进入 `/verify`。
15. 如果出现停止条件，返回本次完成内容、局部检查结果、当前剩余 task 和下一步建议。

首次 `/do` 在 `materialize` 成功后，默认继续选择第一个 `pending` task，并在该 task 通过局部检查后继续推进下一个 `pending` task。只有当首次拆解结果还需要用户确认，或拆解本身暴露了会影响计划方向、范围边界或验收口径的缺口时，才在创建 `task.json` 后停止。

### 停止条件

连续执行遇到以下情况必须停止：

- 当前 task 执行失败，或局部检查结论为 `needs_fix` 且无法给出清晰的最小修复路径。
- 当前 task 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 当前 task 被标记为 `blocked` 或 `failed`。
- 继续执行会扩大修改范围、改变验收口径，或让后续 task 依赖不可信的中间状态。
- 所有 task 都已是 `completed` 或 `skipped`。

### 首次物化

首次 `/do` 是 `task.json` 的创建点。`materialize` 是一次性边界。

输入来源是最新 `plan.md`，不是 `/plan` 阶段保存的隐藏 metadata。用户在 `/plan` 后手动编辑 `plan.md`，`/do` 直接以编辑后的内容为准。

首次物化规则：

- `task.json.objective` 来自最新 `plan.md` 的 `Objective` 部分。
- `Plan` 中每个主要工作项通常对应一个 `tasks[]` entry。
- `Goal` 帮助形成 task `title` 和边界。
- `Do` 帮助形成 `steps[]`。
- `Check` 帮助形成 `checks[]`。
- 复杂动作可以在 `steps[]` 中继续嵌套。
- 需要独立状态、失败重试、跳过或单独委派的工作应提升为独立 task。

若 `plan.md` 中缺少明确 `Objective`，`/do` 应暂停并提示回到 `/plan` 补清目标。

任务拆解属于 `/do` skill 的 orchestration 职责，不单独定义 task materializer agent。原因是拆解结果和 `task.json` 写入边界强相关，且当前目标是保持单一路径。

首次物化默认只依赖 `plan.md` 的目标、计划项和验收口径。`/do` 不为了拆解任务而大范围读取业务代码。

允许的有限事实确认包括：

- 读取 `plan.md` 明确提到的文件或目录。
- 查看项目顶层结构，用于判断任务应按文件、模块还是文档拆分。
- 读取少量已有约定文档，例如 README 或设计说明。

如果拆解必须依赖大量实现细节，`/do` 不应在主流程里继续展开读取。此时应暂停执行，提示回到 `/plan` 补清范围，或本次只形成粗粒度 `tasks[]` 后停止，不继续执行 task。

### 后续执行

如果 `task.json` 已存在，`/do` 以 `task.json` 为准继续执行。

后续 `/do` 可以读取 `plan.md` 作为背景和验收来源，但不根据 `plan.md` 自动重写 `tasks[]`。

`task.json` 创建后，`/do` 不自动修改：

- `tasks[].id`
- `tasks[].title`
- `tasks[].steps`
- `tasks[].checks`
- `tasks[]` 的新增、删除、重排、合并、拆分

若需要改变这些内容，应回到 `/plan` 重新规划当前任务，而不是由 `/do` 静默同步。

这样可以避免把 `/do` 做成复杂同步系统。`task.json` 创建后，后续 `/do` 只推进执行状态。

### task 选择

`/do` 在连续执行循环中每次选择一个可执行 task。

推荐顺序：

1. 如果存在 `in_progress` task，优先把它视为上次中断的 task，并继续执行；如果恢复风险不清，应先提示用户确认。
2. 没有 `in_progress` 时，选择第一个 `pending` task。
3. 如果用户明确要求恢复某个 `blocked` task，且阻塞条件已经解除，可以将它重新标记为 `in_progress`。
4. `failed` task 默认不自动重试；需要用户确认重试，或进入 debugger 路径后再恢复为 `in_progress`。
5. 如果所有 task 都是 `completed` 或 `skipped`，提示进入 `/verify`。
6. 如果只剩无法恢复的 `blocked` 或 `failed` task，提示用户处理失败或调整计划。

`/do` 不需要维护单独的 current task pointer。当前要执行哪个 task 由 `tasks[]` 状态和循环中的选择结果决定。

## 状态写入

执行任务状态沿用 `00-core-workflow-state.md`：

```text
pending
in_progress
completed
failed
blocked
skipped
```

状态语义：

- `pending`：尚未执行。
- `in_progress`：本次 `/do` 当前正在执行。
- `completed`：本 task 的执行动作已经完成，等待 `/verify` 根据 `checks[]` 做最终验证。
- `failed`：执行失败，且不是简单等待用户输入或外部条件。
- `blocked`：需要用户决策、权限、外部条件或计划调整后才能继续。
- `skipped`：用户或执行阶段明确决定不做，且不影响后续验证判断。

`/do` 只回写当前 `task.json` 中的最小执行状态：

- `tasks[].status`
- `tasks[].statusReason`
- 顶层 `status`
- 顶层 `updatedAt`

`statusReason` 只在 `blocked`、`failed`、`skipped` 时保存一句短原因，不记录完整执行日志、命令输出、changed files 或 agent 响应。`/do` 不回写每个 step 的状态，也不记录每条 check 的结果。

状态迁移保持单一路径：

- 常规路径是 `pending -> in_progress -> completed | blocked | failed`。
- `blocked -> in_progress` 需要用户确认，或 `/do` 能明确判断阻塞条件已经解除。
- `failed -> in_progress` 需要明确重试意图，或 debugger 已给出可继续执行的最小修复路径。
- `completed` 和 `skipped` 默认不回退；只有用户明确要求重新执行、或回到 `/plan` 调整计划后，才允许重新进入执行路径。

顶层 `status` 汇总规则：

- 如果存在 `pending` 或 `in_progress` task，顶层 `status` 保持 `active`。
- 如果所有 task 都是 `completed` 或 `skipped`，顶层 `status` 保持 `active`，等待 `/verify` 推进为 `verified`。
- 如果不存在 `pending` / `in_progress`，且存在 `blocked` 或 `failed` task，顶层 `status` 设置为 `blocked`。

顶层 `stage` 在 `/do` 阶段保持 `executing`。即使所有 task 都是 `completed` 或 `skipped`，也由 `/verify` 推进到 `verifying` 或 `verified`。

## 协作边界

`/do` 主流程是状态和任务编排层，不是代码理解层。它默认只读取阶段状态和计划产物：

- `.my-cc-lite/project.json`
- 当前任务目录
- 当前 `plan.md`
- 当前 `task.json`
- 当前要推进的单个 task

业务代码阅读、修改和检查由 agent 或 helper 在单个 task 范围内完成。`/do` 主流程不直接承载完整代码阅读、完整命令日志、完整执行历史或多轮修复细节。

### do skill

`/do` skill 统一负责判断本次调用是首次物化还是后续执行、从 `plan.md` 生成首次 `tasks[]`、循环选择可执行 task、调用阶段脚本写入状态，并根据 executor、verifier 或 debugger 返回结果决定 task 状态。

`/do` 阶段的状态写入只能由 `/do` skill 完成。executor、verifier、debugger 和 execution helper 不直接调用 `scripts/do.mjs materialize` 或 `scripts/do.mjs update-task`，也不读写 `task.json`。

### executor

`executor` 是 do 阶段的核心执行 agent。它接收单个 `tasks[]` entry，按 `title`、`steps[]` 和必要的 plan 摘要执行，读取和编辑相关文件，运行必要检查命令，并返回简短执行结果。

executor 不重新拆分整个 `plan.md`，不修改 `plan.md` 的目标、范围或验收口径，不自行标记 task 状态，也不给出最终任务通过结论。

### verifier

`verifier` 是检查 agent，但不拆成 `task-reviewer` 和 `final verifier` 两个 agent。当前阶段只定义一个 `verifier`，用 mode 区分调用范围。

`task_review` mode 用于 `/do` 阶段：

- 输入是当前 task、`steps[]`、`checks[]`、executor 的简短执行结果和必要文件上下文。
- 只判断当前 task 是否满足自己的 `checks[]`。
- 输出 `passed`、`needs_fix` 或 `blocked`。
- 不调用阶段脚本，不写 `task.json`，不修改文件，不自行标记 task 状态，不给出整个任务是否完成的结论。

这里的 `needs_fix` 和 `blocked` 是 `/do` 阶段的局部检查结论，只影响当前 task 后续如何由 `/do` 写入 `tasks[].status` 和 `tasks[].statusReason`，不直接写入 `task.json.verification.status`。

`final_verify` mode 用于 `/verify` 阶段：

- 输入是 `plan.md`、完整 `task.json`、所有 `tasks[]` 和必要项目上下文。
- 判断整个任务是否满足计划目标和验收口径。
- 只有这个 mode 可以建议写入 `verification.status`。

`final_verify` 输出的 `needs_fix` 和 `blocked` 是任务级最终验证结论，由 `/verify` skill 通过 verify 阶段脚本写入 `task.json.verification.status`。

### debugger

`debugger` 是可选 agent，不是第一版必须能力。

它只在 executor 执行失败、`task_review` 返回 `needs_fix` 且失败原因是构建/类型/测试/运行时报错，或同一个 task 多次修复失败时介入。

debugger 先读取失败证据，再定位根因。它一次只处理一个明确失败，做最小修复或给出最小修复建议；多次同类尝试失败后返回 `blocked`，不继续扩大修改。

debugger 不负责普通 feature 实现，不重写计划，不直接写入失败或阻塞状态，也不做最终验收。

### execution helpers

`project.json.stageHelpers.execution` 只作为提示层参考，不由 `do.mjs` 自动调用。

`/do` skill 可以根据 helper 描述决定是否调用或委派 execution helper，例如代码结构分析工具、专项 executor agent、专项 verifier/reviewer helper、专项 debugger helper、外部编排工具或项目特定执行辅助 skill。

外部 workflow/helper 可以调用 do 阶段定义的 `executor`、`verifier(task_review)` 和可选 `debugger`，但不改变这些 agent 的职责边界。

helper 输出只能用于执行判断或执行结果，不直接成为新的状态模型。helper 不拥有 task 状态写入权，不替代 `/verify` 的最终通过判断。如果 helper 不可用，`/do` 应退回 Claude Code 原生读写、编辑和命令执行能力。

do 阶段核心只保留 `executor` 和 `verifier`，`debugger` 作为可选补充。`writer`、`designer`、`test-engineer` 等专项能力可以作为 `stageHelpers.execution` 中的外部 companion helper 按需使用，不进入核心设计。

`planner` 属于 `/plan` 阶段；`code-reviewer`、`security-reviewer` 等最终审查能力属于 `/verify` 或 review 阶段。do 阶段不展开这些角色。

### 上下文控制

agent 输入保持局部：

- executor 接收当前 task、必要 plan 摘要和执行边界，由它自己按 task 读取相关代码。
- `verifier(task_review)` 接收当前 task、`checks[]`、executor 摘要和必要证据，由它自己按检查项读取相关代码。
- debugger 接收失败 task、失败输出摘要和必要错误上下文，由它自己按失败点读取相关代码。

agent 输出保持短摘要：

```text
changed files:
checks run:
result:
blockers:
next suggestion:
```

`/do` 不保存 agent prompt、完整响应、命令日志或文件级 changed files。后续 `/do` 从 `task.json` 恢复执行状态；如果需要重新理解项目事实，由当前 agent 按当前 task 再读取相关文件。

如果当前 task 的 `steps[]` 需要大量上下文才能执行，优先把该 task 拆成多个 `tasks[]` entry，而不是让单个 executor 承载过长上下文。

## scripts/do.mjs

`do.mjs` 对应 `/do` 的确定性状态入口。

建议命令：

```text
node scripts/do.mjs materialize
node scripts/do.mjs update-task
```

### materialize

`materialize` 创建执行阶段机器状态。它只允许在当前任务目录下还不存在 `task.json` 时执行。

输入：

```json
{
  "objective": "Objective snapshot derived from current plan.md",
  "tasks": [
    {
      "id": "T1",
      "title": "Implement the first planned task",
      "status": "pending",
      "steps": [],
      "checks": []
    }
  ]
}
```

行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 定位唯一 active task。
- 读取当前 `plan.md`。
- 校验 `objective` 非空、`tasks[]` 结构合法，以及 `steps[]` / `checks[]` 满足最小结构要求。
- 如果 `task.json` 不存在，创建任务级机器状态。
- 如果 `task.json` 已存在，不做写入，返回 `TASK_ALREADY_MATERIALIZED`。
- 设置顶层 `status: "active"` 和 `stage: "executing"`。
- 初始化或保留 `verification` 和 `archive`。
- 刷新顶层 `updatedAt`。
- 输出 `taskId`、`taskPath`、`planPath` 和 `tasks[]` 摘要。

### update-task

`update-task` 只更新单个 task 的执行状态。

输入：

```json
{
  "id": "T1",
  "status": "completed",
  "statusReason": ""
}
```

行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 定位唯一 active task。
- 读取并校验 `task.json`。
- 找到 `tasks[].id === input.id` 的 task。
- 更新该 task 的 `status`。
- 按输入更新或清空该 task 的 `statusReason`。
- 当 task 进入 `blocked`、`failed` 或 `skipped` 时，`/do` 应写入简短 `statusReason`。
- 当 task 重新进入 `pending`、`in_progress` 或 `completed` 时，`/do` 可以清空旧的 `statusReason`。
- 根据所有 `tasks[].status` 重新计算顶层 `status`。
- 刷新顶层 `updatedAt`。
- 保持顶层 `stage: "executing"`。

### 错误码

`do.mjs` 至少使用这些错误码：

```text
PROJECT_NOT_INITIALIZED
NO_ACTIVE_TASK
MULTIPLE_ACTIVE_TASKS
PLAN_NOT_FOUND
TASK_STATE_NOT_FOUND
TASK_ALREADY_MATERIALIZED
TASK_NOT_FOUND
INVALID_INPUT
INVALID_PROJECT_STATE
INVALID_TASK_STATE
LOCK_TIMEOUT
```

错误语义：

- `PROJECT_NOT_INITIALIZED`：找不到 `.my-cc-lite/project.json`。
- `NO_ACTIVE_TASK`：`.my-cc-lite/tasks/` 下没有 active task。
- `MULTIPLE_ACTIVE_TASKS`：存在多个 active task，状态异常，不能隐式选择。
- `PLAN_NOT_FOUND`：当前任务目录下缺少 `plan.md`。
- `TASK_STATE_NOT_FOUND`：执行 `update-task` 时缺少 `task.json`。
- `TASK_ALREADY_MATERIALIZED`：当前任务目录下已经存在 `task.json`，执行任务已经固化；`/do` 不再重新 materialize。
- `TASK_NOT_FOUND`：输入中的 `id` 不存在于 `tasks[]`。
- `INVALID_INPUT`：stdin JSON 缺少必要字段或字段结构非法。
- `INVALID_PROJECT_STATE`：`project.json` 不合法。
- `INVALID_TASK_STATE`：`task.json` 不合法。
- `LOCK_TIMEOUT`：无法获得 `.my-cc-lite/state.lock`。

## 与 /verify 的交接

`/do` 完成所有执行任务后，不直接给出任务最终通过结论。

当所有 `tasks[].status` 都是 `completed` 或 `skipped` 时，`/do` 应提示进入 `/verify`。`/verify` 读取同一个 `task.json`，根据每个 task 的 `checks[]` 和最新 `plan.md` 做最终判断，并写入 `verification.status` 和 `verification.summary`。

如果 `/verify` 写入 `verification.status: "needs_fix"`，它会把顶层状态调回 `status: "active"`、`stage: "executing"`，并确保 `tasks[]` 中存在后续 `/do` 可执行的 `pending` task。后续 `/do` 不需要判断 `verification.status`，只按既有规则选择 `pending` task 执行。

`/do` 不负责创建这些 pending task，也不因为 `verification.status: "needs_fix"` 自动改写已有 task。`/do` 仍不新增、删除、重排、合并、拆分 task，也不修改已有 `tasks[].id`、`tasks[].title`、`tasks[].steps` 或 `tasks[].checks`。

`/do` 不应为了让 `/verify` 通过而修改 `checks[]`。如果执行中发现检查口径本身不合理，应提示用户回到 `/plan` 或明确修改计划，而不是在执行阶段悄悄降低验收标准。

## 验证

`/do` 阶段的验证以 smoke 为主，不建立完整测试框架。

最小 smoke 场景：

1. 未初始化项目执行 `do.mjs materialize`，返回 `PROJECT_NOT_INITIALIZED`。
2. 已初始化但没有 active task，返回 `NO_ACTIVE_TASK`。
3. active task 缺少 `plan.md`，返回 `PLAN_NOT_FOUND`。
4. 首次执行 `do.mjs materialize`，创建 `task.json`，写入 `status: "active"` 和 `stage: "executing"`。
5. 执行 `do.mjs update-task`，可以把 `T1` 从 `pending` 更新为 `in_progress`，再更新为 `completed`。
6. 对不存在的 task 执行 `update-task`，返回 `TASK_NOT_FOUND`。
7. 确认 `/do` 没有修改 `project.json`、`plan.md` 或写入 changed files / 执行日志。

如果这些场景通过，`/do` 阶段的本地状态契约即可认为成立。

## 取舍

本方案刻意不引入：

- step/check 级状态。
- current execution task 指针。
- 自动 plan-to-task 差异同步。
- 独立 task materializer 或 task-reviewer agent。
- 执行日志、事件日志或 changed files 记录。
- 多 active task 并行执行、隐式计划审批或自动 verify/archive。

保留的核心能力是：

- 从最新 `plan.md` 进入可恢复的机器状态。
- 用 `tasks[]` 表示 executor 可处理的执行任务。
- 用 `steps[]` 表示 task 内部动作拆解。
- 用 `checks[]` 保留后续 verifier 的检查依据。
- 只维护 task 级执行状态。
- 用 executor 承担局部执行。
- 用 verifier 的 `task_review` mode 承担 do 阶段局部检查。
- 保持 `/do` 主上下文轻量，重执行上下文交给 agent。
- 连续调用 `/do` 时可以恢复进度并继续执行。
