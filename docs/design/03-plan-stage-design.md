# Plan Stage Design

本设计定义 my-cc-lite `/plan` 阶段的方案。它建立在 `00-core-workflow-state.md` 和 `01-stage-scripts.md` 之上，保持已有状态边界：

- `/plan` 是进入任务生命周期的第一个阶段。
- 只要用户调用 my-cc-lite `/plan`，最终都必须生成 `.my-cc-lite/tasks/<taskId>/plan.md`。
- `/plan` 只创建任务目录和 `plan.md`。
- `/plan` 不创建 `task.json`，不更新 `project.json`，不把计划同步成机器任务。
- `/do` 首次执行时再根据最新 `plan.md` 创建 `task.json`。

Claude Code 原生 Plan 模式、外部 planner skill 或 planner agent 只影响计划生成方式，不改变最终落盘边界。

## 阶段定位

`/plan` 是需求分析、方案收敛和计划落盘阶段。它的产物 `plan.md` 是后续 `/do` 的方案来源。

`/plan` 应尽量定义清楚：

- 用户目标。
- 范围边界。
- 关键需求。
- 核心方案。
- 重要取舍。
- 验收口径。
- 已知风险或待确认问题。

`/do` 主要负责执行拆解和实际执行。它可以补充局部实现细节，但不应重新定义 `/plan` 已确认的目标、范围、核心方案或验收口径。

## 目标

`/plan` 的目标是把一次用户意图收敛成可阅读、可调整、可执行前确认的计划文件。

它负责：

- 确认项目已经执行过 `/init`。
- 确认当前没有未归档任务。
- 检查当前可见的计划生成方式，并让用户选择本次生成方式。
- 基于用户目标、本地上下文和必要澄清形成 `plan.md`。
- 创建唯一的新任务目录。
- 将计划写入 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 告知用户下一步可以手动调整计划，或执行 `/do`。

它不负责：

- 修改业务代码。
- 创建 `task.json`。
- 拆出机器可执行的 `tasks[]`、`steps[]` 或 `checks[]`。
- 调用 executor、verifier 或执行型 companion helper。
- 维护审批状态、事件日志、changed files、命令日志或计划版本历史。

## 计划生成方式选择

`/plan` skill 开始时应先检查当前 Claude Code 上下文中是否存在可用于生成计划的 plan-like 能力，并让用户选择本次计划生成方式。

候选生成方式包括：

- my-cc-lite `/plan` 原生生成：由 `/plan` skill 基于本地上下文和用户目标直接生成 `plan.md`。
- Claude Code 原生 Plan 模式：先使用宿主协作模式收敛方案，再由 my-cc-lite 将最终方案写入 `plan.md`。
- 外部 planner skill：使用当前上下文可见的外部规划 skill 生成计划草案，再由 my-cc-lite 收敛并写入 `plan.md`。
- 外部 planner agent：委派当前上下文可见的外部规划 agent 生成计划草案，再由 my-cc-lite 收敛并写入 `plan.md`。

这些生成方式不是 my-cc-lite 的状态分支。用户选择任何一种方式，只要仍在 my-cc-lite `/plan` 流程内，最终都必须调用 `scripts/plan.mjs create-task` 创建任务目录和 `plan.md`。

示例提示：

```text
当前可以使用这些方式生成计划：

1. my-cc-lite /plan：直接生成并记录到 .my-cc-lite/tasks/<taskId>/plan.md。
2. Claude Code Plan：先用原生 Plan 模式讨论，再记录到 my-cc-lite plan.md。
3. 外部 planner agent：先委派 planner 生成草案，再记录到 my-cc-lite plan.md。

请选择这次计划的生成方式。
```

边界：

- `/plan` skill 只在提示层识别 plan-like 能力，不把识别结果写入 `project.json`。
- `scripts/plan.mjs` 不负责发现、选择或调用计划生成方式。
- 如果用户只想纯讨论方案、不想创建 my-cc-lite 任务，应停留在普通对话或 Claude Code 原生 Plan 模式，不调用 my-cc-lite `/plan`。
- 外部 plan-like skill 或 agent 的输出只是计划草案，最终仍由 my-cc-lite 写成统一 `plan.md`。

## 协作流程

`/plan` skill 负责模型侧协作，`scripts/plan.mjs` 只负责确定性落盘。

推荐流程：

1. 读取 `.my-cc-lite/project.json`。
2. 如果项目未初始化，提示先执行 `/init`。
3. 检查 `.my-cc-lite/tasks/` 下是否已有 active task。
4. 如果已有 active task，停止创建新任务，并提示先 `/status`、`/do`、`/verify` 或 `/archive`。
5. 检查当前上下文可见的 plan-like 生成方式，并让用户选择本次计划生成方式。
6. 判断用户目标、本地上下文和已知约束是否足以收敛方案。
7. 如果信息不足，进入需求澄清和方案收敛流程。
8. 按用户选择的方式生成或收敛计划草案。
9. 如果需要项目事实支撑计划方向，先读取本地文件或使用 `stageHelpers.planning` 中的 planning helper，再向用户确认偏好或取舍。
10. 生成最终 `plan.md` 正文。
11. 调用 `scripts/plan.mjs create-task` 写入任务目录和计划文件。
12. 返回 `taskId`、`plan.md` 路径和下一步建议。

`/plan` 不需要记录“访谈中”“等待审批”“已批准”等状态。只要没有调用 `scripts/plan.mjs` 创建任务目录，就还没有进入 my-cc-lite 任务生命周期。

## 需求澄清和方案收敛

`/plan` 可以做多轮需求澄清。澄清的目标不是收集所有细节，而是补足会影响方案方向、范围边界和验收口径的信息。

应优先自己获取本地事实：

- 读取相关文件、文档、配置和错误输出。
- 检查已有实现、相邻模块和项目约定。
- 必要时使用 `stageHelpers.planning` 中的 planning helper 收集上下文。

应向用户确认的内容包括：

- 业务目标或优先级。
- 范围取舍。
- 方案偏好。
- 兼容性、风险或成本取舍。
- 验收口径。

不建议：

- 要求用户解释可以从仓库中查到的事实。
- 一次性列出大量和当前决策无关的问题。
- 在目标、范围或验收口径明显缺失时创建空泛计划。
- 把执行拆解、文件级 TODO 或 review checklist 提前写成机器任务。

提问方式：

- 可以多轮提问。
- 每轮问题应聚焦当前最影响方案收敛的不确定性。
- 如果多个问题属于同一个决策面，可以一起问；如果会分散用户判断，应拆成多轮。

## planning helpers

`project.json.stageHelpers.planning` 只作为提示层参考，不由 `plan.mjs` 自动调用。

`planning helpers` 是 my-cc-lite `/plan` 生成或收敛计划时可以使用的辅助能力，不是计划生成方式本身。

`/plan` skill 可以根据 helper 描述决定是否建议或调用辅助能力，例如：

- 代码上下文分析。
- 架构判断。
- 风险识别。
- 计划方向确定前的背景调研。

边界：

- helper 输出只能作为计划证据或参考，不直接写入机器状态。
- helper 不能替代用户确认关键业务取舍。
- helper 不能进入执行阶段。
- 如果 helper 不可用，`/plan` 应退回普通本地上下文分析，而不是失败。
- plan-like skill 或 agent 如果用于直接生成计划草案，应作为“计划生成方式”向用户展示，而不是作为 `stageHelpers.planning` 里的 helper 处理。

## plan.md 内容

`plan.md` 是人类可读计划，不作为状态机依据。它保存 `/plan` 阶段已经收敛的目标、范围、方案和完成判断。

建议结构：

```text
# Task: <taskId>

## Objective

## Scope

## Plan

## Notes
```

字段说明：

- `Objective`：用户目标，用一两句话表达。
- `Scope`：这次做什么、不做什么，以及需要保留的边界。
- `Plan`：按人类可读方式列出主要阶段或关键决策面。每个工作项可包含 `Goal`、`Do` 和 `Check`，复杂任务下可以补充局部 `Scope`。
- `Notes`：关键取舍、风险、未关闭问题、用户偏好或计划生成方式，能少写就少写。

`Plan` 建议使用简洁编号结构：

```text
1. <work item title>
   - Goal: <这个工作项要达成什么>
   - Scope: <可选，说明这个工作项内做什么、不做什么>
   - Do: <主要动作方向>
   - Check: <阶段完成判断>

2. <work item title>
   - Goal: <这个工作项要达成什么>
   - Do: <主要动作方向>
   - Check: <阶段完成判断>
```

`/plan` 不追求最细执行拆解。它可以记录关键文件、命令和技术选择，但这些内容应解释方案，而不是替代 `/do` 的执行编排。如果外部 plan-like helper 产出较长的执行清单，`/plan` 应先收敛为适合 my-cc-lite 的主要阶段，再写入 `plan.md`。

主要编号项数量只作为粒度自检信号，不作为状态规则。`/plan` 不因编号项超过某个数量失败，`scripts/plan.mjs` 也不做数量校验。超过 8 项时，模型应优先判断这些项是否真的代表独立功能面、阶段边界、用户取舍或独立验收口径；否则应合并为更高层计划项。

与 `/do` 的关系：

- `Plan` 里的编号项可作为 `tasks[]` 的拆解依据。
- `Goal` 和局部 `Scope` 帮助 `/do` 判断每个 task 的边界。
- `Do` 可作为 `steps[]` 的生成依据。
- `Check` 可作为 `checks[]` 的生成依据。

`plan.md` 不写 `status`，不写 JSON，不要求 `/do` 一比一同步，也不把执行清单作为计划目标。后续 `/do` 会读取最新 `plan.md`，再根据计划内容生成执行阶段需要的 `tasks[]`、`steps[]` 和 `checks[]`。

## scripts/plan.mjs

`plan.mjs` 对应 `/plan` 的确定性写入入口。

建议命令：

```text
node scripts/plan.mjs create-task
```

输入：

```json
{
  "objective": "User objective",
  "planMarkdown": "# Task: ..."
}
```

行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 确认 `.my-cc-lite/tasks/` 下没有 active task。
- 根据 `objective` 生成 `taskId`。
- 创建 `.my-cc-lite/tasks/<taskId>/`。
- 写入 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 输出 `taskId`、`taskDir` 和 `planPath`。

成功输出：

```json
{
  "ok": true,
  "result": {
    "taskId": "20260607-153012-add-feature",
    "taskDir": "/path/to/project/.my-cc-lite/tasks/20260607-153012-add-feature",
    "planPath": "/path/to/project/.my-cc-lite/tasks/20260607-153012-add-feature/plan.md"
  }
}
```

失败输出沿用 `01-stage-scripts.md` 的统一错误格式。

## 状态管理边界

`/plan` 阶段涉及的状态判断和写入应集中在脚本公共层，不放进 skill 提示词，也不交给子 agent。

分层：

```text
skills/plan/SKILL.md
  负责计划生成方式选择、需求澄清、方案收敛和生成 planMarkdown

scripts/plan.mjs
  负责阶段入口、stdin/stdout JSON 协议和错误输出

scripts/lib/state.mjs
  负责 .my-cc-lite 路径、锁、读写、任务目录定位和目录创建

scripts/lib/schema.mjs
  负责输入校验、状态结构校验和稳定错误码

scripts/lib/format.mjs
  负责时间、taskId 和兜底模板渲染
```

如果实现时发现 `state.mjs` 过大，可以再拆一个小的任务生命周期模块：

```text
scripts/lib/task-lifecycle.mjs
```

它只封装确定性流程：

```js
requireInitializedProject(projectRoot);
getActiveTaskState(projectRoot);
assertCanCreateTask(projectRoot);
createPlanTask(projectRoot, input);
```

`createPlanTask(projectRoot, input)` 内部仍然只做本地状态操作：

1. 校验 `project.json` 存在且结构合法。
2. 检查 active task 数量。
3. 生成或接收 `taskId`。
4. 创建 `.my-cc-lite/tasks/<taskId>/`。
5. 写入 `plan.md`。
6. 返回 `taskId`、`taskDir` 和 `planPath`。

## 公共库补充

为了实现 `plan.mjs`，需要在公共库补齐最小接口。

`scripts/lib/state.mjs` 增加：

```js
taskRootPath(projectRoot);
listActiveTaskDirs(projectRoot);
getCurrentTaskDir(projectRoot);
createTaskDir(projectRoot, taskId);
writePlan(taskDir, markdown);
```

`scripts/lib/format.mjs` 增加：

```js
createTaskId(objective);
renderPlanMarkdown(input);
```

`scripts/lib/schema.mjs` 增加：

```js
normalizePlanInput(input);
```

`renderPlanMarkdown(input)` 可以在早期只作为兜底模板。正常情况下，`/plan` skill 生成完整 `planMarkdown` 后传给 `plan.mjs`。脚本不负责理解项目代码，也不替模型扩写计划。

## taskId 规则

`taskId` 应稳定、可读、适合目录名。

建议格式：

```text
YYYYMMDD-HHMMSS-<slug>
```

示例：

```text
20260607-153012-plan-stage-design
```

slug 由 `objective` 生成：

- 转小写。
- 空格和非字母数字字符转 `-`。
- 合并连续 `-`。
- 去掉首尾 `-`。
- 限制长度。
- 如果为空，使用 `task`。

如果目录已存在，可在末尾追加短序号，例如 `-2`。这只处理同一秒内重复创建的极端情况，不引入多 active task 语义。

## 错误处理

`plan.mjs` 至少使用这些错误码：

```text
PROJECT_NOT_INITIALIZED
ACTIVE_TASK_EXISTS
MULTIPLE_ACTIVE_TASKS
INVALID_INPUT
INVALID_PROJECT_STATE
LOCK_TIMEOUT
```

错误语义：

- `PROJECT_NOT_INITIALIZED`：找不到 `.my-cc-lite/project.json`。
- `ACTIVE_TASK_EXISTS`：已有一个 active task，不能创建新任务。
- `MULTIPLE_ACTIVE_TASKS`：存在多个 active task，状态异常，不能隐式选择。
- `INVALID_INPUT`：stdin JSON 缺少 `objective` 或 `planMarkdown`。
- `INVALID_PROJECT_STATE`：`project.json` 不合法。
- `LOCK_TIMEOUT`：无法获得 `.my-cc-lite/state.lock`。

`ACTIVE_TASK_EXISTS` 的用户提示应指向恢复路径：

```text
已有未归档任务。请先查看 /status，继续 /do 或 /verify，或者用 /archive 关闭当前任务后再创建新计划。
```

## 与 /do 的交接

`/plan` 和 `/do` 之间只通过 `plan.md` 交接。

`/plan` 完成后：

```text
.my-cc-lite/tasks/<taskId>/plan.md
```

此时不存在：

```text
.my-cc-lite/tasks/<taskId>/task.json
```

用户可以直接编辑 `plan.md`。`/do` 首次执行时读取最新 `plan.md`，再创建 `task.json`。`task.json` 创建后，后续 `/do` 不再根据 `plan.md` 自动重写执行拆解。

这意味着 `/plan` 不需要提供同步命令，也不需要在 `plan.md` 中嵌入隐藏 metadata。`taskId` 已经由目录名表达，`plan.md` 顶部标题只是便于阅读。

`/do` 以 `plan.md` 为方案来源。正常情况下，目标、范围、关键方案和验收口径应已在 `/plan` 阶段定义清楚。

首次 `/do` 可以在执行拆解时补充局部实现细节，例如：

- 任务顺序。
- 文件落点。
- 局部技术细节。
- 根据代码事实调整任务拆解。
- 把 `plan.md` 的验收口径转成 `checks[]`。

这些补充不得改变 `plan.md` 已确认的目标、范围、关键取舍或验收口径。

如果 `/do` 发现缺口会影响方案方向、用户决策或完成标准，应暂停执行，并提示用户回到 `/plan` 更新 `plan.md`。

## 与 Claude Code 原生 Plan 模式的关系

Claude Code 原生 Plan 模式可以作为 my-cc-lite `/plan` 的一种计划生成方式，但不是 my-cc-lite 状态的一部分。

如果用户在 my-cc-lite `/plan` 流程中选择 Claude Code 原生 Plan 模式，原生 Plan 只负责帮助收敛方案；方案收敛后仍由 my-cc-lite 调用 `scripts/plan.mjs create-task` 写入 `.my-cc-lite/tasks/<taskId>/plan.md`。

如果用户只是想先讨论方案、不想创建 my-cc-lite 任务，应停留在普通对话或 Claude Code 原生 Plan 模式，不进入 my-cc-lite `/plan`。

换言之，是否创建 `plan.md` 由“是否调用 my-cc-lite `/plan`”决定，不由用户选择的计划生成方式决定。

## 验证

`/plan` 阶段的验证以 smoke 为主，不建立完整测试框架。

最小 smoke 场景：

1. 未初始化项目执行 `plan.mjs create-task`，返回 `PROJECT_NOT_INITIALIZED`。
2. 已初始化项目执行 `plan.mjs create-task`，生成唯一任务目录和 `plan.md`。
3. 再次执行 `plan.mjs create-task`，返回 `ACTIVE_TASK_EXISTS`。
4. 人工创建多个 active task 后执行，返回 `MULTIPLE_ACTIVE_TASKS`。
5. 确认执行后没有生成 `task.json`，也没有修改 `project.json`。

如果这些场景通过，`/plan` 阶段的本地状态契约即可认为成立。

## 取舍

本方案刻意不引入：

- plan 审批状态。
- plan 版本历史。
- PRD/test-spec 双文件。
- 多 agent 共识规划。
- 多种计划生成方式对应的持久状态分支。
- plan 阶段事件日志。
- 计划到 `task.json` 的同步机制。
- 执行阶段对核心方案的隐式重写。

保留的核心能力是：

- 一次只允许一个 active task。
- `/plan` 负责需求分析、方案收敛和验收口径。
- 计划可读、可手动调整。
- 写入边界清晰。
- 后续 `/do` 可以从最新 `plan.md` 继续。
