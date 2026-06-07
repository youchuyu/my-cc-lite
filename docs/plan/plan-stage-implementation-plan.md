# Plan Stage Implementation Plan

本文基于 `docs/design/03-plan-stage-design.md`，并对齐 `docs/design/00-core-workflow-state.md`、`docs/design/01-stage-scripts.md` 和当前已落地的 `/init` 实现，给出 `/plan` 阶段的落地执行方案。

## 目标结论

`/plan` 是任务生命周期的第一个阶段，但它只创建计划，不创建执行状态。

MVP 完成后，用户调用 `/plan` 并确认进入 my-cc-lite 任务生命周期时，my-cc-lite 应在目标项目根目录写入：

```text
.my-cc-lite/tasks/<taskId>/plan.md
```

它必须做到：

- 先确认目标项目已经存在 `.my-cc-lite/project.json`。
- 先确认 `.my-cc-lite/tasks/` 下没有未归档任务。
- 根据用户目标、本地上下文和必要澄清生成可读的 `plan.md`。
- 创建唯一的新任务目录。
- 只写入 `plan.md`，不创建 `task.json`。
- 不更新 `project.json`。
- 不维护计划审批状态、计划版本、事件日志、命令日志或 changed files。
- 告知用户可以手动调整 `plan.md`，或继续调用 `/do`。

当前 `.claude-plugin/plugin.json` 已声明 `./skills/plan/`，但磁盘上还没有 `skills/plan/SKILL.md`。因此本阶段实施必须补齐 plan skill，否则插件声明和实际能力会继续不一致。

## 实施顺序

建议按三个小步落地：

1. 扩展确定性脚本能力：补齐 `scripts/lib/*` 的任务目录、计划写入、输入校验和 `taskId` 生成，再新增 `scripts/plan.mjs`。
2. 新增 `skills/plan/SKILL.md`，让 skill 负责计划生成方式选择、需求澄清、方案收敛，并把最终 `planMarkdown` 交给脚本落盘。
3. 扩展 `test/smoke.mjs`，验证未初始化、首次创建、重复创建、多 active task 和不生成 `task.json`。

这样可以保持 `/plan` 的模型协作逻辑和本地状态写入逻辑分离：skill 负责“想清楚计划”，脚本负责“确定性写文件”。

## 文件落点

推荐新增：

```text
scripts/plan.mjs
skills/plan/SKILL.md
```

推荐更新：

```text
scripts/lib/state.mjs
scripts/lib/schema.mjs
scripts/lib/format.mjs
test/smoke.mjs
```

暂不新增：

```text
.my-cc-lite/current-task.json
.my-cc-lite/workflow.json
.my-cc-lite/events.jsonl
.my-cc-lite/capabilities.json
.my-cc-lite/tasks/<taskId>/task.json
```

`task.json` 留给 `/do` 首次执行时创建。

## 脚本协议

`scripts/plan.mjs` 是 `/plan` 阶段入口。

建议命令：

```bash
node scripts/plan.mjs create-task
```

stdin 输入：

```json
{
  "objective": "User objective",
  "planMarkdown": "# Task: ..."
}
```

stdout 成功输出：

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

stdout 失败输出沿用 `/init` 的 JSON 格式：

```json
{
  "ok": false,
  "error": {
    "code": "ACTIVE_TASK_EXISTS",
    "message": "An active task already exists."
  }
}
```

脚本失败时退出码使用 `1`，成功时使用 `0`。所有错误都保持 JSON 输出，方便 skill 汇总给用户。

## plan.mjs 落地

`scripts/plan.mjs` 只做确定性本地状态操作，不生成计划内容。

行为：

1. 校验子命令必须是 `create-task`。
2. 从 stdin 读取 JSON。
3. 使用 `normalizePlanInput()` 校验并规整 `objective` 和 `planMarkdown`。
4. 以 `process.cwd()` 作为目标项目根目录。
5. 进入 `withStateLock(projectRoot, fn)`。
6. 读取 `.my-cc-lite/project.json`。
7. 如果项目未初始化，返回 `PROJECT_NOT_INITIALIZED`。
8. 校验 `project.json` 最小结构。
9. 扫描 `.my-cc-lite/tasks/` 下的 active task 目录。
10. 如果已有一个 active task，返回 `ACTIVE_TASK_EXISTS`。
11. 如果存在多个 active task，返回 `MULTIPLE_ACTIVE_TASKS`。
12. 根据 `objective` 生成 `taskId`。
13. 创建 `.my-cc-lite/tasks/<taskId>/`。
14. 写入 `.my-cc-lite/tasks/<taskId>/plan.md`。
15. 输出 `taskId`、`taskDir` 和 `planPath`。

禁止：

- 不创建或写入 `task.json`。
- 不写 `project.json`。
- 不修改 `initializedAt`、`updatedAt` 或 `stageHelpers`。
- 不把 `plan.md` 解析成 `tasks[]`、`steps[]` 或 `checks[]`。
- 不调用 executor、verifier 或外部 helper。

## state.mjs 落地

当前 `scripts/lib/state.mjs` 已实现 `/init` 需要的路径、锁和 `project.json` 读写。`/plan` 阶段在同一个模块中补齐任务目录接口，避免阶段脚本各自扫描路径。

建议扩展 `statePaths(projectRoot)`，返回：

```js
{
  projectRoot,
  stateRoot,
  projectPath,
  tasksRoot,
  archivedTasksRoot,
  lockPath
}
```

新增接口：

```js
listActiveTaskDirs(projectRoot)
getCurrentTaskDir(projectRoot)
createTaskDir(projectRoot, taskId)
writePlan(taskDir, markdown)
```

### listActiveTaskDirs

行为：

- 如果 `.my-cc-lite/tasks/` 不存在，返回空数组。
- 只返回直接子目录。
- 忽略普通文件。
- 返回结果按目录名排序，保证错误输出和 smoke 稳定。

不要为了扫描 active task 自动创建 `tasks/` 目录。只有真正创建任务时才创建它。

### getCurrentTaskDir

规则固定为：

- 没有 active task：返回 `null`。
- 只有一个 active task：返回该目录路径。
- 多于一个 active task：抛出 `MULTIPLE_ACTIVE_TASKS`。

虽然 `/plan` 创建新任务前主要需要 `assertNoActiveTask()`，但这个接口后续 `/do`、`/verify`、`/archive` 都会复用。

### createTaskDir

行为：

- 确保 `.my-cc-lite/tasks/` 存在。
- 创建 `.my-cc-lite/tasks/<taskId>/`。
- 如果目标目录已存在，返回 `TASK_ID_COLLISION` 或由上层重新生成带序号的 `taskId`。

本阶段建议在 `createTaskId()` 里处理同一秒重复创建的序号兜底，让 `createTaskDir()` 保持简单确定。

### writePlan

行为：

- 写入 `plan.md`。
- 使用临时文件加 rename，避免半写入。
- 内容以换行结尾。

`writePlan()` 不校验 Markdown 结构，只校验输入是非空字符串。结构质量由 `/plan` skill 保证。

## schema.mjs 落地

当前 `scripts/lib/schema.mjs` 已有 `StateError`、`normalizeInitInput()` 和 `validateProject()`。本阶段新增：

```js
normalizePlanInput(input)
assertInitializedProject(project)
assertNoActiveTask(activeTaskDirs)
```

### normalizePlanInput

输入必须是 JSON object，并包含：

- `objective`：非空字符串，trim 后保存。
- `planMarkdown`：非空字符串，trim 右侧空白后保存。

建议校验：

- `planMarkdown` 必须包含 `## Objective`。
- `planMarkdown` 必须包含 `## Plan`。

不要在脚本里强制完整格式，例如 `Scope`、`Notes` 或每个工作项的 `Goal/Do/Check`。这些属于 plan 质量要求，由 skill 提示控制；脚本只做防空泛输入。

### assertInitializedProject

行为：

- `readProject(projectRoot)` 返回 `null` 时抛出 `PROJECT_NOT_INITIALIZED`。
- 存在时调用 `validateProject(project)`。

### assertNoActiveTask

行为：

- active task 数量为 `0` 时通过。
- active task 数量为 `1` 时抛出 `ACTIVE_TASK_EXISTS`。
- active task 数量大于 `1` 时抛出 `MULTIPLE_ACTIVE_TASKS`。

`ACTIVE_TASK_EXISTS` 的错误消息应指向恢复路径：

```text
已有未归档任务。请先查看 /status，继续 /do 或 /verify，或者用 /archive 关闭当前任务后再创建新计划。
```

## format.mjs 落地

当前 `scripts/lib/format.mjs` 只有 `nowIso()`。本阶段新增：

```js
createTaskId(objective, options)
slugifyObjective(objective)
renderPlanMarkdown(input)
```

### createTaskId

建议格式：

```text
YYYYMMDD-HHMMSS-<slug>
```

示例：

```text
20260607-153012-add-feature
```

实现规则：

- 时间使用本地可读的紧凑格式，避免路径中出现 `:`。
- slug 从 `objective` 生成。
- 英文字母转小写。
- 连续空白和非字母数字字符转 `-`。
- 合并连续 `-`。
- 去掉首尾 `-`。
- 限制长度，例如 48 个字符。
- slug 为空时使用 `task`。

中文目标在 ASCII slug 规则下可能变成空字符串，MVP 可以接受兜底为 `task`。如果后续希望目录名表达中文语义，再单独设计 transliteration，不在本阶段引入。

### renderPlanMarkdown

这是兜底模板函数，不是默认计划生成器。

正常路径下，`/plan` skill 应生成完整 `planMarkdown` 后传给 `plan.mjs`。只有当后续需要脚本辅助补模板时，才使用 `renderPlanMarkdown()`。

建议模板：

```text
# Task: <taskId>

## Objective

<objective>

## Scope

<scope>

## Plan

1. <work item title>
   - Goal: <goal>
   - Do: <action>
   - Check: <completion check>

## Notes

<notes>
```

不要在模板里写 JSON、状态字段或 hidden metadata。

## skills/plan/SKILL.md 落地

`skills/plan/SKILL.md` 是模型侧协作入口。它负责把用户目标收敛成 `planMarkdown`，但不自己操作 `.my-cc-lite/` 目录。

建议 frontmatter：

```yaml
---
name: plan
description: 收敛任务方案并创建 my-cc-lite plan.md
---
```

执行步骤：

1. 确认当前工作目录就是目标项目根目录。
2. 先读取 `.my-cc-lite/project.json`；如果不存在，提示先执行 `/init`。
3. 检查 `.my-cc-lite/tasks/` 是否已有 active task；如果有，停止新建计划并提示恢复路径。
4. 读取 `projectSummary` 和 `stageHelpers.planning`，只作为计划参考。
5. 检查当前上下文可见的 plan-like 生成方式。
6. 让用户选择本次计划生成方式。
7. 根据用户目标读取必要的本地文件、文档、配置或错误输出。
8. 只在影响目标、范围、方案方向或验收口径时向用户澄清。
9. 生成最终 `planMarkdown`。
10. 调用 `node scripts/plan.mjs create-task`，通过 stdin 传入 JSON。
11. 汇总 `taskId`、`plan.md` 路径和下一步建议。

### 计划生成方式提示

skill 应把生成方式作为提示层选择，不写入状态。

候选方式：

- my-cc-lite `/plan` 原生生成。
- Claude Code 原生 Plan 模式先讨论，再由 my-cc-lite 落盘。
- 外部 planner skill 先生成草案，再由 my-cc-lite 收敛落盘。
- 外部 planner agent 先生成草案，再由 my-cc-lite 收敛落盘。

如果当前上下文没有外部 planner skill 或 agent，只展示实际可用项，不伪造能力。

### 计划内容要求

`plan.md` 建议结构：

```text
# Task: <taskId>

## Objective

## Scope

## Plan

## Notes
```

`Plan` 内的每个工作项建议使用：

```text
1. <work item title>
   - Goal: <这个工作项要达成什么>
   - Scope: <可选，说明这个工作项内做什么、不做什么>
   - Do: <主要动作>
   - Check: <完成判断>
```

写作要求：

- 目标、范围、核心方案和验收口径必须清楚。
- 计划应可读、可调整、可供 `/do` 拆解。
- 不写执行状态。
- 不写 `task.json` 形状。
- 不写文件级 TODO，除非文件落点本身就是计划阶段已确认的范围边界。
- 不把未确认的业务取舍写成确定结论。

## 与 planning helpers 的关系

`project.json.stageHelpers.planning` 只作为提示层参考。

skill 可以根据 helper 描述建议或调用辅助能力，例如代码上下文分析、架构判断或风险识别。但 helper 输出只是计划证据，最终仍由 my-cc-lite 生成统一 `plan.md` 并调用 `scripts/plan.mjs create-task` 落盘。

边界：

- `scripts/plan.mjs` 不发现、不选择、不调用 planning helper。
- helper 不能替代用户确认关键业务取舍。
- helper 不能进入执行阶段。
- 如果 helper 不可用，退回普通本地上下文分析，不让 `/plan` 失败。

## 与 /do 的交接

`/plan` 完成后只存在：

```text
.my-cc-lite/tasks/<taskId>/plan.md
```

此时不应存在：

```text
.my-cc-lite/tasks/<taskId>/task.json
```

用户可以手动编辑 `plan.md`。`/do` 执行时读取最新 `plan.md`，再创建或更新 `task.json`，并把计划中的工作项转成执行阶段需要的 `tasks[]`、`steps[]` 和 `checks[]`。

如果 `/do` 发现计划缺口影响方案方向、用户决策或完成标准，应暂停执行，并提示用户回到 `/plan` 更新 `plan.md`，而不是在执行阶段隐式重写核心方案。

## smoke 验证

继续使用 `test/smoke.mjs`，不引入完整测试框架。

建议把 smoke 分为 init 和 plan 两段，仍然使用临时目录：

1. 未初始化项目执行 `node scripts/plan.mjs create-task`，返回 `PROJECT_NOT_INITIALIZED`。
2. 执行 `node scripts/init.mjs init-project` 初始化临时项目。
3. 执行 `node scripts/plan.mjs create-task`，生成 `.my-cc-lite/tasks/<taskId>/plan.md`。
4. 校验 `plan.md` 内容等于输入的 `planMarkdown`。
5. 校验 `.my-cc-lite/tasks/<taskId>/task.json` 不存在。
6. 记录 `project.json` 内容，再次执行 `plan.mjs create-task`，返回 `ACTIVE_TASK_EXISTS`。
7. 校验 `project.json` 未被 `/plan` 修改。
8. 人工再创建一个 active task 目录，执行 `plan.mjs create-task`，返回 `MULTIPLE_ACTIVE_TASKS`。
9. 校验 `plan.mjs` 的失败输出仍是 `{ ok: false, error: { code, message } }`。

这些验证足以覆盖 `/plan` 阶段最关键的状态契约。

## 错误码

`plan.mjs` 至少支持：

```text
PROJECT_NOT_INITIALIZED
ACTIVE_TASK_EXISTS
MULTIPLE_ACTIVE_TASKS
INVALID_INPUT
INVALID_PROJECT_STATE
LOCK_TIMEOUT
TASK_ID_COLLISION
```

错误语义：

- `PROJECT_NOT_INITIALIZED`：找不到 `.my-cc-lite/project.json`。
- `ACTIVE_TASK_EXISTS`：已有一个 active task，不能创建新任务。
- `MULTIPLE_ACTIVE_TASKS`：存在多个 active task，状态异常，不能隐式选择。
- `INVALID_INPUT`：stdin JSON 缺少 `objective` 或 `planMarkdown`，或 Markdown 太空泛。
- `INVALID_PROJECT_STATE`：`project.json` 不合法。
- `LOCK_TIMEOUT`：无法获得 `.my-cc-lite/state.lock`。
- `TASK_ID_COLLISION`：生成的 taskId 目录已存在且无法兜底。

## 取舍

本阶段刻意不做：

- plan 审批状态。
- plan 版本历史。
- plan draft 与 final 双文件。
- PRD、test spec 或 checklist 多文件拆分。
- 多 planner 输出投票或共识机制。
- 将计划同步到 `task.json`。
- 记录计划生成方式到 `project.json`。
- 记录完整事件日志。
- 在脚本中解析或评价代码方案。

保留的核心能力是：

- 只要进入 my-cc-lite `/plan`，最终必须创建 `plan.md`。
- 一次只允许一个 active task。
- 计划文本可读、可手动调整。
- 本地写入边界清楚。
- `/do` 可以从最新 `plan.md` 继续。

## 完成标准

本阶段实施完成时应满足：

- `skills/plan/SKILL.md` 存在，并与 `.claude-plugin/plugin.json` 声明一致。
- `scripts/plan.mjs create-task` 可以从 stdin 接收 `objective` 和 `planMarkdown`。
- 未初始化时返回 `PROJECT_NOT_INITIALIZED`。
- 已有 active task 时返回 `ACTIVE_TASK_EXISTS`。
- 多 active task 时返回 `MULTIPLE_ACTIVE_TASKS`。
- 首次创建时只生成任务目录和 `plan.md`。
- `/plan` 不创建 `task.json`。
- `/plan` 不修改 `project.json`。
- `test/smoke.mjs` 覆盖 init 与 plan 的核心状态契约并通过。
