# Do Stage Implementation Plan

本文基于 `docs/design/04-do-stage-design.md`，并对齐 `docs/design/00-core-workflow-state.md`、`docs/design/01-stage-scripts.md`、`docs/design/03-plan-stage-design.md` 和当前已落地的 `/init`、`/plan` 实现，给出 `/do` 阶段的详细执行方案。

## 目标结论

`/do` 是把 `plan.md` 推进成可恢复执行状态，并逐个执行 `task.json.tasks[]` 的阶段。

MVP 完成后，用户调用 `/do` 时，my-cc-lite 应在唯一 active task 目录内读写：

```text
.my-cc-lite/tasks/<taskId>/
  plan.md
  task.json
```

它必须做到：

- 首次 `/do` 根据最新 `plan.md` 创建 `task.json`。
- 后续 `/do` 从已有 `task.json` 恢复执行进度。
- 每次默认只推进一个 `tasks[]` entry。
- 只维护 task 级状态，不维护 step/check 级状态。
- 由 `/do` skill 负责物化、task 选择、执行方式选择、executor/verifier 协作和状态回写。
- 由 `scripts/do.mjs` 负责确定性的 `task.json` 创建和 task 状态更新。
- 用 `executor` 承担单个 task 的实际执行。
- 用 `verifier` 的 `task_review` mode 做 do 阶段局部检查。
- 可选使用 `debugger` 处理明确失败，不把 debugger 做成第一版必需能力。
- 所有执行任务完成后提示进入 `/verify`，不在 `/do` 给出最终通过结论。

当前仓库已经有：

```text
scripts/init.mjs
scripts/plan.mjs
scripts/lib/format.mjs
scripts/lib/schema.mjs
scripts/lib/state.mjs
skills/init/SKILL.md
skills/plan/SKILL.md
test/smoke.mjs
```

当前还没有：

```text
scripts/do.mjs
skills/do/SKILL.md
agents/executor.md
agents/verifier.md
agents/debugger.md
```

因此本阶段实施重点是补齐 do 阶段入口、状态结构校验、skill 编排说明和必要 agent 文件。

## 能力清单

`/do` 阶段完整能力分为六类。

### 1. 执行状态物化

首次 `/do` 必须支持从当前 `plan.md` 创建 `task.json`。

能力包括：

- 读取并校验 `.my-cc-lite/project.json`。
- 定位唯一 active task。
- 读取 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 从 `plan.md` 的 `Objective`、`Plan`、`Goal`、`Do`、`Check` 中形成 `objective` 和 `tasks[]`。
- 创建顶层 `status: "active"`。
- 创建顶层 `stage: "executing"`。
- 初始化 `createdAt`、`updatedAt`。
- 初始化 `verification.status: "not_started"` 和 `verification.summary: ""`。
- 初始化 `archive.summary: ""` 和 `archive.archivedAt: null`。
- 写入每个 task 的 `id`、`title`、`status`、`steps`、`checks`、`statusReason`。

物化只发生一次。`task.json` 存在后，`/do` 不自动把 `plan.md` 同步回 `tasks[]`。

### 2. 连续 task 执行推进

一次 `/do` 默认连续推进所有可执行 task。每次状态写入仍只更新一个 task，循环由 `/do` skill 负责，`scripts/do.mjs` 不承担调度。

能力包括：

- 优先恢复已有 `in_progress` task。
- 没有 `in_progress` 时选择第一个 `pending` task。
- 用户明确要求时恢复 `blocked` task。
- 用户明确要求或 debugger 给出最小修复路径时重试 `failed` task。
- 当前 task 完成并通过局部检查后，继续选择下一个 `pending` task。
- 所有 task 都是 `completed` 或 `skipped` 时提示进入 `/verify`。
- 只剩 `blocked` 或 `failed` task 时提示处理阻塞、失败或回到 `/plan` 调整计划。

`/do` 不维护额外 current task pointer。当前执行项由 `tasks[]` 状态和连续执行循环中的选择决定。

### 3. 执行方式选择

`/do` skill 开始连续执行前，应向用户展示本次可用的高阶执行能力。用户已明确要求连续执行时，可以直接采用推荐方式，不在每个 task 前反复请求选择。

候选项只包括能编排或委派 agent 的能力，例如：

- my-cc-lite `/do` 原生执行。
- 当前上下文可见的外部 executor agent。
- `project.json.stageHelpers.execution` 中的外部 execution helper。
- 用户明确指定的外部 workflow/helper。

不要把 `Read`、`Write`、`Edit`、`Bash` 等原子工具列为执行方式选项。

执行方式选择只影响本次协作，不写入 `project.json`、`task.json` 或 metadata。`scripts/do.mjs` 不发现、不选择、不调用执行方式。

### 4. 状态回写

`/do` 只写当前 `task.json` 的最小执行状态。

可写字段：

```text
tasks[].status
tasks[].statusReason
status
stage
updatedAt
```

状态值：

```text
pending
in_progress
completed
failed
blocked
skipped
```

状态迁移：

- 常规路径：`pending -> in_progress -> completed | blocked | failed`。
- `blocked -> in_progress` 需要用户确认，或 `/do` 能明确判断阻塞已经解除。
- `failed -> in_progress` 需要明确重试意图，或 debugger 已给出可继续执行的最小修复路径。
- `completed` 和 `skipped` 默认不回退。

顶层汇总规则：

- 存在 `pending` 或 `in_progress` task 时，顶层 `status` 为 `active`。
- 所有 task 都是 `completed` 或 `skipped` 时，顶层 `status` 仍为 `active`，等待 `/verify`。
- 不存在 `pending` / `in_progress`，但存在 `blocked` 或 `failed` task 时，顶层 `status` 为 `blocked`。
- 顶层 `stage` 在 `/do` 内保持 `executing`。

`statusReason` 只在 `blocked`、`failed`、`skipped` 时保存一句短原因。恢复到 `pending`、`in_progress` 或 `completed` 时可以清空。

### 5. agent 协作

do 阶段核心 agent 是 `executor` 和 `verifier`。

`executor` 能力：

- 接收单个 `tasks[]` entry。
- 读取必要 plan 摘要和当前 task 边界。
- 按 `title`、`steps[]` 和必要上下文执行文件读取、编辑和检查命令。
- 返回短执行摘要。

`executor` 不做：

- 不重新拆解整个 `plan.md`。
- 不修改 `plan.md` 的目标、范围或验收口径。
- 不调用 `scripts/do.mjs`。
- 不自行标记 task 状态。
- 不给出整个任务的最终通过结论。

`verifier` 能力：

- 使用同一个 `agents/verifier.md`。
- 在 `/do` 阶段以 `task_review` mode 调用。
- 接收当前 task、`steps[]`、`checks[]`、executor 摘要和必要证据。
- 输出 `passed`、`needs_fix` 或 `blocked`。

`verifier(task_review)` 不做：

- 不写 `task.json`。
- 不修改文件。
- 不调用阶段脚本。
- 不给出整个任务的最终通过结论。

`debugger` 可选能力：

- 只在 executor 失败、task review 返回 `needs_fix` 且失败是明确构建/类型/测试/运行时报错时介入。
- 一次只处理一个明确失败。
- 读取失败证据，定位根因，做最小修复或给出最小修复建议。
- 多次同类尝试失败后返回 `blocked`。

`debugger` 不负责普通 feature 实现，不重写计划，不直接写状态。

连续执行停止条件：

- 当前 task 执行或局部检查结果为 `blocked` 或 `failed`。
- 需要用户确认业务取舍、权限、外部账号、破坏性操作或计划范围调整。
- 当前 task 的最小修复路径不清晰，继续会扩大修改范围或改变验收口径。
- 所有 task 已完成或跳过，需要进入 `/verify`。

### 6. 恢复和交接

后续 `/do` 以 `task.json` 为准恢复执行。

能力包括：

- 识别已有 `task.json`，跳过 materialize。
- 识别 `in_progress` task 并继续或请求用户确认。
- 识别所有 task 已完成，提示进入 `/verify`。
- 识别无法继续的 blocked/failed 状态，说明原因和下一步。
- 不自动归档。
- 不自动 verify。

`/do` 与 `/verify` 的交接条件是所有 task 状态都为 `completed` 或 `skipped`。最终验收、`verification.status` 和 `verification.summary` 只能由 `/verify` 阶段写入。

## 实施顺序

建议按五个小步落地。

1. 扩展公共状态和 schema 能力。
2. 新增 `scripts/do.mjs`，实现 `materialize` 和 `update-task`。
3. 新增 `skills/do/SKILL.md`，定义 `/do` 编排流程。
4. 新增 `agents/executor.md` 和 `agents/verifier.md`，可选新增 `agents/debugger.md`。
5. 扩展 `test/smoke.mjs`，验证 do 阶段本地状态契约。

这样可以先验证本地状态写入成立，再让 skill/agent 承担模型侧执行能力。

## 文件落点

推荐新增：

```text
scripts/do.mjs
skills/do/SKILL.md
agents/executor.md
agents/verifier.md
agents/debugger.md
```

推荐更新：

```text
scripts/lib/state.mjs
scripts/lib/schema.mjs
test/smoke.mjs
.claude-plugin/plugin.json
```

如果 `.claude-plugin/plugin.json` 已经声明 do skill 或 agent，只需要补齐磁盘文件；如果还没有声明，需要让插件声明和实际文件保持一致。

暂不新增：

```text
.my-cc-lite/current-task.json
.my-cc-lite/workflow.json
.my-cc-lite/events.jsonl
.my-cc-lite/checks.jsonl
.my-cc-lite/evidence.jsonl
.my-cc-lite/changed-files.json
.my-cc-lite/tasks/<taskId>/archive.md
```

## 脚本协议

`scripts/do.mjs` 是 `/do` 阶段的确定性状态入口。

建议命令：

```bash
node scripts/do.mjs materialize
node scripts/do.mjs update-task
```

所有输入通过 stdin JSON 传入，输出沿用现有脚本格式。

成功：

```json
{
  "ok": true,
  "result": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task not found: T9."
  }
}
```

脚本成功退出码为 `0`，失败退出码为 `1`。

## do.mjs materialize

输入：

```json
{
  "objective": "Objective snapshot derived from current plan.md",
  "tasks": [
    {
      "id": "T1",
      "title": "Implement the first planned task",
      "status": "pending",
      "steps": [
        "Read the relevant files",
        {
          "title": "Apply the focused change",
          "steps": [
            "Edit the implementation",
            "Keep unrelated files untouched"
          ]
        }
      ],
      "checks": [
        "The implementation matches plan.md",
        "The relevant smoke check passes"
      ]
    }
  ]
}
```

行为：

1. 校验子命令必须是 `materialize`。
2. 从 stdin 读取 JSON。
3. 使用 `normalizeDoMaterializeInput()` 校验 `objective`、`tasks[]`、`steps[]`、`checks[]`。
4. 以 `process.cwd()` 作为目标项目根目录。
5. 先读取并校验 `.my-cc-lite/project.json`。
6. 进入 `withStateLock(projectRoot, fn)`。
7. 在锁内重新读取并校验 `.my-cc-lite/project.json`。
8. 定位唯一 active task。
9. 读取当前 task 目录下的 `plan.md`。
10. 如果 `plan.md` 不存在，返回 `PLAN_NOT_FOUND`。
11. 如果 `task.json` 已存在，返回 `TASK_ALREADY_MATERIALIZED`。
12. 从 task 目录名得到 `taskId`。
13. 创建 `task.json`。
14. 输出 `taskId`、`taskDir`、`taskPath`、`planPath` 和 `tasks[]` 摘要。

创建的 `task.json` 结构：

```json
{
  "taskId": "20260607-153012-add-feature",
  "objective": "Objective snapshot",
  "status": "active",
  "stage": "executing",
  "createdAt": "2026-06-07T15:30:12.000Z",
  "updatedAt": "2026-06-07T15:30:12.000Z",
  "tasks": [
    {
      "id": "T1",
      "title": "Implement the first planned task",
      "status": "pending",
      "steps": [],
      "checks": [],
      "statusReason": ""
    }
  ],
  "verification": {
    "status": "not_started",
    "summary": ""
  },
  "archive": {
    "summary": "",
    "archivedAt": null
  }
}
```

禁止：

- 不修改 `plan.md`。
- 不更新 `project.json`。
- 不执行 task。
- 不选择执行方式。
- 不调用 executor 或 verifier。

## do.mjs update-task

输入：

```json
{
  "id": "T1",
  "status": "completed",
  "statusReason": ""
}
```

行为：

1. 校验子命令必须是 `update-task`。
2. 从 stdin 读取 JSON。
3. 使用 `normalizeDoTaskPatch()` 校验 `id`、`status`、`statusReason`。
4. 以 `process.cwd()` 作为目标项目根目录。
5. 先读取并校验 `.my-cc-lite/project.json`。
6. 进入 `withStateLock(projectRoot, fn)`。
7. 在锁内重新读取并校验 `.my-cc-lite/project.json`。
8. 定位唯一 active task。
9. 读取并校验 `task.json`。
10. 找到 `tasks[].id === input.id` 的 task。
11. 更新该 task 的 `status` 和 `statusReason`。
12. 根据所有 task 状态重新计算顶层 `status`。
13. 保持顶层 `stage: "executing"`。
14. 刷新顶层 `updatedAt`。
15. 写回 `task.json`。
16. 输出 task 摘要和顶层状态。

状态更新规则：

- `blocked`、`failed`、`skipped` 必须带非空 `statusReason`。
- `pending`、`in_progress`、`completed` 可以清空 `statusReason`。
- 不在脚本层强制校验完整状态迁移路径；迁移语义由 `/do` skill 控制。
- 脚本只保证输入状态值合法、task 存在、写入结构合法。

禁止：

- 不修改 `tasks[].title`、`steps[]` 或 `checks[]`。
- 不新增、删除、重排、合并、拆分 `tasks[]`。
- 不写 step/check 级状态。
- 不写 changed files。
- 不写执行日志。
- 不推进 `/verify` 或 `/archive`。

## state.mjs 落地

当前 `state.mjs` 已有路径、锁、`project.json`、active task 扫描和 `plan.md` 写入能力。`/do` 需要补齐 task 状态读写。

建议新增接口：

```js
readPlan(taskDir)
readTask(taskDir)
writeTask(taskDir, task)
```

### readPlan

行为：

- 从 `taskDir/plan.md` 读取 Markdown。
- 如果文件不存在，返回 `PLAN_NOT_FOUND`。
- 如果内容为空，返回 `PLAN_NOT_FOUND` 或 `INVALID_TASK_STATE`。

### readTask

行为：

- 从 `taskDir/task.json` 读取 JSON。
- 如果文件不存在，返回 `null`，由调用方按命令转换为 `TASK_STATE_NOT_FOUND` 或继续 materialize。
- 如果 JSON 非法，返回 `INVALID_TASK_STATE`。

### writeTask

行为：

- 写入 `taskDir/task.json`。
- 调用 `validateTask()` 做最小结构校验。
- 使用临时文件加 rename，避免半写入。
- 内容以换行结尾。

`writeTask()` 不理解具体命令语义，只保证写入结构合法。

## schema.mjs 落地

当前 `schema.mjs` 已有 `StateError`、`normalizeInitInput()`、`normalizePlanInput()`、`validateProject()`、`assertInitializedProject()` 和 `assertNoActiveTask()`。

本阶段建议新增：

```js
normalizeDoMaterializeInput(input)
normalizeDoTaskPatch(input)
validateTask(task)
validateTaskEntry(entry)
validateSteps(steps)
validateChecks(checks)
summarizeTask(task)
```

### normalizeDoMaterializeInput

规则：

- 输入必须是 JSON object。
- `objective` 必须是非空字符串。
- `tasks` 必须是非空数组。
- 每个 task `id` 必须是非空字符串，推荐 `T1`、`T2` 形式，但 MVP 可以只校验唯一性。
- 每个 task `title` 必须是非空字符串。
- 每个 task `status` 必须是 `pending`；如果缺省则补为 `pending`。
- 每个 task `steps` 必须是数组，可以为空。
- 每个 task `checks` 必须是字符串数组，可以为空，但建议物化时尽量写入。
- 每个 task `statusReason` 缺省补为空字符串。
- `tasks[].id` 不能重复。

### normalizeDoTaskPatch

规则：

- 输入必须是 JSON object。
- `id` 必须是非空字符串。
- `status` 必须属于合法状态集合。
- `blocked`、`failed`、`skipped` 必须带非空 `statusReason`。
- 其他状态可以不传 `statusReason`，缺省为空字符串。
- 不接受除 `id`、`status`、`statusReason` 外的结构性修改字段。

### validateTask

规则：

- 顶层必须是 JSON object。
- `taskId`、`objective`、`status`、`stage`、`createdAt`、`updatedAt` 必须存在。
- `status` 必须是 `active`、`blocked`、`verified`、`archived` 中之一；do 阶段只会写 `active` 或 `blocked`。
- `stage` 必须是 `executing`、`verifying`、`verified`、`archived` 中之一；do 阶段只写 `executing`。
- `tasks` 必须是数组，且至少一个 entry。
- `verification.status` 必须存在。
- `archive.summary` 和 `archive.archivedAt` 必须存在。
- 每个 task entry 满足 `validateTaskEntry()`。

### validateSteps

`steps[]` 允许两种形状：

```json
"Read the relevant files"
```

```json
{
  "title": "Apply the focused change",
  "steps": [
    "Edit the implementation"
  ]
}
```

规则：

- `steps` 必须是数组。
- 每个元素要么是非空字符串，要么是 `{ "title": string, "steps": array }`。
- 嵌套深度不在 MVP 做复杂限制，但实现可以用递归校验。
- 不允许 step 上出现 `status`、`result`、`evidence` 等状态字段。

### validateChecks

规则：

- `checks` 必须是数组。
- 每个元素必须是非空字符串。
- 不允许对象形式的 check。
- 不记录 check 级状态、命令输出或证据。

## /do skill 落地

新增 `skills/do/SKILL.md`。

frontmatter：

```yaml
---
name: do
description: 执行当前 my-cc-lite plan.md 并推进 task.json 任务状态
---
```

skill 职责：

- 确认当前工作目录是目标项目根目录。
- 读取 `.my-cc-lite/project.json` 和 `stageHelpers.execution`，只作为提示层参考。
- 定位当前 task 和读取 `plan.md`、`task.json`。
- 判断是否需要首次 materialize。
- 从最新 `plan.md` 生成首次 `tasks[]`。
- 循环选择要执行的 task。
- 向用户展示可用执行方式；用户已明确要求连续执行时沿用推荐方式。
- 调用 `scripts/do.mjs update-task` 标记 `in_progress`。
- 按所选方式执行当前 task。
- 调用 `verifier(task_review)` 或自行做局部检查。
- 根据结果调用 `scripts/do.mjs update-task` 写入 `completed`、`blocked` 或 `failed`。
- 当前 task 完成后继续选择下一个 `pending` task，直到所有 task 完成或遇到停止条件。
- 汇总本次完成内容、局部检查结果、剩余 task 和下一步。

skill 不做：

- 不直接手写 `.my-cc-lite/tasks/<taskId>/task.json`。
- 不修改 `project.json`。
- 不修改 `plan.md` 的目标、范围或验收口径。
- 不绕过脚本更新 task 状态。
- 不保存 agent prompt、完整响应、命令日志、changed files 或 check 级结果。

### skill 主流程

1. 确认项目已 `/init`。
2. 确认存在唯一 active task。
3. 读取当前 `plan.md`。
4. 如果缺少 `task.json`，从 `plan.md` 生成 `objective` 和 `tasks[]`。
5. 调用 do 阶段脚本执行 `materialize`。如果当前工作目录存在 `scripts/do.mjs`，使用 `node scripts/do.mjs materialize`；否则先定位插件根目录，再使用绝对路径调用 `<pluginRoot>/scripts/do.mjs`。不要使用未确认存在的 `CLAUDE_PLUGIN_ROOT`。
6. 如果首次物化暴露计划目标、范围或验收口径缺口，停止并提示回到 `/plan`。
7. 读取或使用 materialize 返回的 `tasks[]` 摘要。
8. 选择当前 task。
9. 展示执行方式选项。
10. 调用 `update-task` 标记 `in_progress`。
11. 调用 executor 或按 my-cc-lite 原生方式执行当前 task。
12. 执行局部检查。
13. 根据检查结果回写状态。
14. 如果仍有可执行 `pending` task，继续步骤 8。
15. 返回本次连续执行结果和下一步建议。

首次 `/do` materialize 成功后，默认继续执行第一个 `pending` task，并在每个 task 通过局部检查后继续推进下一个 `pending` task。只有拆解需要用户确认，或拆解发现会影响计划方向、范围、验收口径的问题时，才在创建 `task.json` 后停止。

### 从 plan.md 生成 tasks[]

生成规则：

- `Objective` 形成 `task.json.objective`。
- `Plan` 的主要编号项通常形成一个 task。
- `Goal` 形成 task `title` 和边界。
- `Do` 形成 `steps[]`。
- `Check` 形成 `checks[]`。
- 需要独立状态、失败重试、跳过或单独委派的工作提升为独立 task。
- 复杂动作可以在 `steps[]` 中嵌套。

如果 `Objective` 缺失或过于空泛，停止并提示回到 `/plan`。

如果 `Plan` 缺少可执行工作项，但用户目标仍清楚，可以形成一个粗粒度 task；如果连验收口径也缺失，应停止并提示回到 `/plan`。

`/do` 不为了任务拆解大范围读取业务代码。允许的有限事实确认：

- 读取 `plan.md` 明确提到的文件或目录。
- 查看项目顶层结构。
- 读取少量已有约定文档，例如 README 或设计说明。

### 执行方式选择提示

建议提示形状：

```text
本次将从 T1: <title> 开始连续执行。

可用执行方式：

1. my-cc-lite /do 原生执行：由当前 /do 流程直接委派 executor，并由 task_review 做局部检查。推荐用于普通代码或文档修改。
2. <外部 helper 名称>：<适用范围、风险或限制>。

请选择本次执行方式。
```

如果用户已经明确指定执行方式，或没有外部高阶能力，直接使用 my-cc-lite `/do` 原生执行。执行过程中只有遇到停止条件才暂停。

## agent 文件落地

### agents/executor.md

建议职责说明：

- 输入是单个 task，不是整个 plan。
- 只读取完成该 task 必需的文件。
- 按 `steps[]` 执行，必要时运行局部检查命令。
- 保持修改范围贴合 task。
- 返回短摘要。

建议输出格式：

```text
changed files:
checks run:
result:
blockers:
next suggestion:
```

禁止：

- 不写 my-cc-lite 状态文件。
- 不调用 `scripts/do.mjs`。
- 不修改 `plan.md`。
- 不重新规划整个任务。

### agents/verifier.md

建议用 mode 区分 do 阶段和 verify 阶段。

`task_review` mode：

- 输入当前 task、`checks[]`、executor 摘要和必要证据。
- 只判断当前 task 是否满足自己的 checks。
- 输出 `passed`、`needs_fix` 或 `blocked`。

`final_verify` mode：

- 留给后续 `/verify` 阶段。
- 判断整个任务是否满足计划目标和验收口径。

禁止：

- 不写状态。
- 不改文件。
- 不调用阶段脚本。
- 不把 `task_review` 结论当成最终验收。

### agents/debugger.md

第一版可以新增但不强制在 smoke 中验证。

建议职责：

- 接收明确失败证据。
- 一次只定位一个失败。
- 做最小修复或给出最小修复建议。
- 多次失败后返回 blocked。

禁止：

- 不做普通 feature 实现。
- 不扩大修改范围。
- 不直接写 task 状态。

## plugin 声明

需要检查 `.claude-plugin/plugin.json`。

目标是插件声明和磁盘能力一致：

- 如果已声明 `./skills/do/`，补齐 `skills/do/SKILL.md`。
- 如果还未声明 `./skills/do/`，添加声明。
- 如果支持 agents 声明，按现有 manifest 结构声明 `executor`、`verifier` 和可选 `debugger`。

不要为了 do 阶段引入新的插件级配置文件。

## smoke 验证

继续使用 `test/smoke.mjs`，不建立测试框架。

最小场景：

1. 未初始化项目执行 `do.mjs materialize`，返回 `PROJECT_NOT_INITIALIZED`。
2. 已初始化但没有 active task，执行 `materialize` 返回 `NO_ACTIVE_TASK`。
3. active task 缺少 `plan.md`，执行 `materialize` 返回 `PLAN_NOT_FOUND`。
4. 已有 `plan.md` 且没有 `task.json`，执行 `materialize` 创建 `task.json`。
5. `task.json` 写入 `status: "active"`、`stage: "executing"`、`verification.status: "not_started"`。
6. 再次执行 `materialize` 返回 `TASK_ALREADY_MATERIALIZED`。
7. 执行 `update-task`，把 `T1` 从 `pending` 更新为 `in_progress`。
8. 执行 `update-task`，把 `T1` 更新为 `completed`。
9. 对不存在的 task 执行 `update-task`，返回 `TASK_NOT_FOUND`。
10. 对 `blocked`、`failed`、`skipped` 不传 `statusReason`，返回 `INVALID_INPUT`。
11. 确认 `/do` 不修改 `project.json`。
12. 确认 `/do` 不修改 `plan.md`。
13. 确认没有写入 changed files、执行日志、events 或 check 级结果文件。

建议补充的结构校验：

- `steps[]` 支持字符串和嵌套对象。
- `checks[]` 只接受字符串数组。
- 重复 `tasks[].id` 返回 `INVALID_INPUT`。
- `task.json` 非法时 `update-task` 返回 `INVALID_TASK_STATE`。

验证命令延续当前显式 node 路线：

```bash
node --check scripts/do.mjs
node --check scripts/lib/schema.mjs
node --check scripts/lib/state.mjs
node test/smoke.mjs
```

## 错误码

`do.mjs` 至少支持：

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

可沿用已有：

```text
TASK_ID_COLLISION
ACTIVE_TASK_EXISTS
```

但 `/do` 主路径不应该产生 `ACTIVE_TASK_EXISTS`，因为多 active task 应统一报 `MULTIPLE_ACTIVE_TASKS`。

## 不做事项

本阶段明确不做：

- 不增加 `/materialize` 用户可见阶段。
- 不新增 task 级 current pointer。
- 不记录 step 状态。
- 不记录 check 状态。
- 不记录 changed files。
- 不记录完整执行日志、事件日志、证据日志。
- 不自动同步 `plan.md` 到已有 `task.json`。
- 不自动 verify。
- 不自动 archive。
- 不支持多个 active task 并行执行。
- 不把 `writer`、`designer`、`test-engineer`、`code-reviewer` 等专项角色加入核心。
- 不把 Claude Code 原生工具或 my-cc-lite 自身能力写入 `stageHelpers.execution`。

## 完成判断

do 阶段实施完成的判断：

- `skills/do/SKILL.md` 存在，且能说明首次物化、task 选择、执行方式选择、executor/verifier 协作和状态回写。
- `scripts/do.mjs materialize` 能创建合法 `task.json`。
- `scripts/do.mjs update-task` 能更新单个 task 状态并刷新顶层汇总状态。
- 公共 `state.mjs` 和 `schema.mjs` 承担路径、锁、JSON 读写和最小结构校验。
- `executor` 和 `verifier` agent 文件存在，职责不越过状态写入边界。
- smoke 覆盖 do 阶段核心状态读写和禁止写入边界。
- `/do` 连续完成所有 tasks 后只提示进入 `/verify`，不写最终验收状态。

## 后续衔接

完成 `/do` 后，下一阶段应实现 `/verify`。

`/verify` 需要复用：

- 当前 `plan.md`。
- 完整 `task.json`。
- 所有 `tasks[].checks[]`。
- `verifier(final_verify)` mode。

`/do` 不为了 `/verify` 提前增加验证日志或 check 级状态。最终检查结果先由 `/verify` 写入 `verification.status` 和 `verification.summary` 即可。
