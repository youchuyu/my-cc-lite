# Verify Stage Implementation Plan

本文基于 `docs/design/05-verify-stage-design.md`，并对齐 `docs/design/00-core-workflow-state.md`、`docs/design/01-stage-scripts.md`、`docs/design/04-do-stage-design.md` 和当前已落地的 `/do` 实现，给出 `/verify` 阶段的详细执行方案。

## 目标结论

`/verify` 是当前任务的任务级验收阶段。它读取唯一 active task 目录中的 `plan.md` 和 `task.json`，判断整个任务是否满足原计划目标、范围和验收口径，然后只把最终结论写回当前任务的 `task.json`。

MVP 完成后，用户调用 `/verify` 时，my-cc-lite 应做到：

- 所有 `tasks[]` 都是 `completed` 或 `skipped` 后才进入正式验证。
- 以 `plan.md` 作为最终人类语义来源。
- 以 `task.json.tasks[]` 和 `checks[]` 判断 `/do` 的执行结果是否支撑通过。
- 验证通过时写入 `verified` / `passed`。
- 验证不通过但可以收敛修复入口时，append 一个或少量 `R<number>` repair tasks，并把任务退回 `executing`。
- 验证不通过且无法形成明确 repair task 时，写入 `blocked`。
- 不修改 `project.json`，不修改 `plan.md`，不改写已有 task、step 或 check。
- 不保存完整 review 报告、命令日志、changed files、事件日志或证据文件。
- 不自动归档任务。

当前仓库已经有：

```text
scripts/do.mjs
skills/do/SKILL.md
agents/verifier.md
scripts/lib/state.mjs
scripts/lib/schema.mjs
scripts/lib/format.mjs
test/smoke.mjs
```

当前还没有：

```text
scripts/verify.mjs
skills/verify/SKILL.md
```

因此本阶段实施重点是补齐 verify 阶段脚本、扩展最小 schema 能力、补充 `/verify` skill 编排说明、把 `verifier` 扩展为同时支持 `task_review` 和 `final_verify`，并用 smoke 覆盖状态写入契约。

## 能力清单

`/verify` 阶段完整能力分为五类。

### 1. 进入条件检查

`/verify` 正式判断前必须确认：

- `.my-cc-lite/project.json` 存在且结构合法。
- `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 当前任务目录下存在非空 `plan.md`。
- 当前任务目录下存在结构合法的 `task.json`。
- `task.json.tasks[]` 非空。
- 所有 `tasks[].status` 都是 `completed` 或 `skipped`。
- 至少存在一个 `completed` task。

如果没有 active task，提示先执行 `/plan`。如果存在多个 active task，停止并提示手动处理状态异常。

如果缺少 `task.json`，提示先执行 `/do`。如果仍有 `pending`、`in_progress`、`blocked` 或 `failed` task，停止且不写状态，提示回到 `/do` 继续执行、修复或处理阻塞。

如果所有 task 都是 `skipped`，停止且不写状态，提示回到 `/plan` 重新确认当前任务是否仍然成立。

### 2. 最终验证判断

`/verify` skill 负责模型侧判断。判断依据包括：

- `plan.md` 中的 `Objective`、`Scope`、`Plan` 和各工作项 `Check`。
- `task.json.objective` 中的执行目标快照。
- `task.json.tasks[]` 中每个 task 的状态和 `checks[]`。
- 必要项目文件、轻量命令输出摘要、review helper 输出或用户补充说明。

判断规则：

- `plan.md` 是最终验收语义来源。
- `task.json.tasks[]` 和 `checks[]` 是 `/do` 阶段固化的执行检查结构。
- 如果 `plan.md` 和 `task.json` 轻微表述不同，以 `plan.md` 判断目标和验收口径，以 `task.json` 判断执行结果是否能支撑通过。
- 如果差异会影响通过判断，不通过改写状态强行通过，而是返回 `blocked` 或提示回到 `/plan` / `/do`。
- 必要时委派 `verifier` 的 `final_verify` mode，或调用 `project.json.stageHelpers.review` 中明确匹配的 review helper。

读取项目文件、运行检查命令或委派 helper 只服务于本轮判断，不落成新的长期状态模型。

### 3. 验证结论写入

`scripts/verify.mjs` 只负责确定性状态写入。建议提供一个子命令：

```text
node scripts/verify.mjs complete
```

输入：

```json
{
  "status": "passed",
  "summary": "The task satisfies plan.md and all task checks support final verification."
}
```

`needs_fix` 输入：

```json
{
  "status": "needs_fix",
  "summary": "Added R1 to cover the missing final smoke check before retrying /verify.",
  "repairTasks": [
    {
      "title": "Fix verification issue: missing final smoke check",
      "steps": [
        "Run the final smoke check required by plan.md",
        "Fix any issue found by the smoke check"
      ],
      "checks": [
        "The final smoke check has been run",
        "The result satisfies the original plan.md acceptance criteria"
      ]
    }
  ]
}
```

脚本行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 定位唯一 active task。
- 读取非空 `plan.md`。
- 读取并校验 `task.json`。
- 校验 verify 进入条件。
- 根据输入一次性写入最终结论。
- 每次写入刷新顶层 `updatedAt`。

写入映射：

| 输入状态 | 顶层 `status` | 顶层 `stage` | `verification.status` | `tasks[]` |
| --- | --- | --- | --- | --- |
| `passed` | `verified` | `verified` | `passed` | 不修改 |
| `needs_fix` | `active` | `executing` | `needs_fix` | append repair tasks |
| `blocked` | `blocked` | `verifying` | `blocked` | 不修改 |

`verification.summary` 必须是简短摘要。它只说明最终结论和下一步，不保存完整 review 报告、命令输出、文件列表或 agent 响应。

### 4. Repair Task 追加

`needs_fix` 只在验证缺口可以被收敛成一个或少量后续 `/do` 可执行入口时使用。

repair task 规则：

- 来源必须是原 `plan.md` 目标、范围、验收口径，或已有 `tasks[].checks[]`。
- 不能引入新需求。
- 不能扩大任务范围。
- 默认优先 append 一个 repair task。
- 多个 repair tasks 只用于多个修复入口明确、互相独立、仍属于原计划验收口径的情况。
- 只能 append 到 `tasks[]` 末尾。
- 不能删除、重排、合并、拆分或改写已有 task。
- `steps[]` 和 `checks[]` 保持短，不保存完整 review 报告、命令输出、文件列表或 evidence。

repair task id 由脚本生成，而不是由 skill 输入：

- 扫描现有 `tasks[].id` 中的 `R<number>`。
- 从下一个编号开始生成。
- 确保不和已有 task id 冲突。

脚本写入后的 repair task 形态：

```json
{
  "id": "R1",
  "title": "Fix verification issue: missing final smoke check",
  "status": "pending",
  "steps": [
    "Run the final smoke check required by plan.md",
    "Fix any issue found by the smoke check"
  ],
  "checks": [
    "The final smoke check has been run",
    "The result satisfies the original plan.md acceptance criteria"
  ],
  "statusReason": ""
}
```

`/verify` 的脚本前序校验不区分普通 task 和 repair task；只要存在未完成 task，就停止且不写状态，提示回到 `/do` 继续执行。只有所有 task 都是 `completed` 或 `skipped` 后，`/verify` 才进入正式验证，并在发现新的、可收敛的验收缺口时 append 下一个 `R<number>` repair task。

### 5. 协作和恢复

`/verify` skill 是阶段 orchestrator，负责：

- 读取状态和计划。
- 检查进入条件。
- 形成最终验证问题清单。
- 必要时委派 `verifier(final_verify)` 或 review helper。
- 决定 `passed`、`needs_fix` 或 `blocked`。
- 调用 `scripts/verify.mjs complete` 一次性写入状态。
- 向用户返回结论、简短原因和下一步建议。

`scripts/verify.mjs` 不负责：

- 理解业务代码。
- 运行检查命令。
- 调用 helper 或 agent。
- 判断是否满足 `plan.md`。
- 自动归档。

如果验证过程被中断，不写入任何持久中间态。下一次 `/verify` 重新执行本轮判断即可。

## 实施顺序

建议按五个小步落地。

### 1. 扩展 schema 能力

在 `scripts/lib/schema.mjs` 中新增 verify 相关能力：

- `normalizeVerifyCompleteInput(input)`。
- `assertVerifiableTask(task)`。
- `normalizeRepairTaskInput(entry)` 或复用受限版 task entry normalize。
- `summarizeVerification(task)` 可选，用于脚本输出。

校验重点：

- `status` 只能是 `passed`、`needs_fix` 或 `blocked`。
- `summary` 必须是非空字符串。
- `passed` 和 `blocked` 不允许输入 `repairTasks`。
- `needs_fix` 必须输入非空 `repairTasks[]`。
- `repairTasks[]` 中每个 entry 只允许 `title`、`steps`、`checks`。
- repair task 输入不能带 `id`、`status`、`statusReason`。
- `assertVerifiableTask(task)` 要拒绝空 `tasks[]`、未完成 task 和全 skipped。

同时需要把 `validateTask(task)` 中 `verification.status` 的合法值收紧为：

```text
not_started
passed
needs_fix
blocked
```

### 2. 新增 `scripts/verify.mjs`

新增文件：

```text
scripts/verify.mjs
```

命令：

```text
node scripts/verify.mjs complete
```

实现要点：

- 使用与 `init.mjs`、`plan.mjs`、`do.mjs` 一致的 stdin/stdout JSON 协议。
- 支持 `--help` / `-h`。
- 写操作通过 `withStateLock(projectRoot, fn)`。
- 锁内重新读取 `project.json`、当前 task 目录、`plan.md` 和 `task.json`。
- 调用 `assertVerifiableTask(task)`，确保只有完成后的任务能进入写入。
- 前序校验只基于 `tasks[].status`，不按 `T<number>` / `R<number>` 或其他 id 形态区分 task 类型。
- 根据输入状态更新顶层 `status`、`stage`、`verification` 和 `updatedAt`。
- `needs_fix` 时调用本脚本内部 helper 生成 `R<number>` id，并 append repair tasks。
- 输出 `taskId`、`taskDir`、`taskPath`、`status`、`stage`、`verification` 和 `tasks[]` 摘要。

不建议在第一版拆出复杂 repair-task builder 模块。`scripts/verify.mjs` 内部一个小 helper 足够，等 `/archive` 或 `/status` 复用需求明确后再整理公共能力。

### 3. 新增 `skills/verify/SKILL.md`

新增目录和文件：

```text
skills/verify/SKILL.md
```

skill 内容应覆盖：

- 使用条件：用户调用 `/verify` 或要求验收当前 my-cc-lite 任务。
- 读取顺序：`project.json` -> 当前 task dir -> `plan.md` -> `task.json`。
- 进入条件和失败提示。
- 最终判断依据。
- 什么时候使用 `verifier(final_verify)` 或 review helper。
- 三种结论的处理方式。
- repair task 生成规则。
- 脚本路径解析规则，沿用 `/do` skill 的插件根目录说明。
- 完成反馈格式。

完成反馈建议包含：

- 结论：`passed` / `needs_fix` / `blocked`。
- 简短原因。
- 写入的 `verification.summary`。
- 如果是 `needs_fix`，列出新增 repair task id 和标题。
- 下一步：`/archive`、`/do`、`/plan` 或用户决策。

### 4. 扩展 `agents/verifier.md`

更新现有 `agents/verifier.md`，让同一个 verifier 支持两个 mode：

```text
task_review
final_verify
```

保留现有 `task_review` 语义，新增 `final_verify`：

- 输入：当前 `plan.md`、完整 `task.json`、所有 task 的 `id`、`title`、`status`、`checks[]`，以及必要文件上下文或命令输出摘要。
- 职责：判断整个任务是否满足 `plan.md` 的目标、范围和验收口径；检查 `tasks[]` 完成状态和 `checks[]` 是否支撑通过。
- 输出：`result: passed | needs_fix | blocked`、`reason`、`next`。
- 禁止：不写状态、不修改文件、不调用阶段脚本、不新增或改写 tasks。

不要新增独立 reviewer agent。当前设计已经明确继续使用一个 `verifier`，通过 mode 区分 do 阶段局部检查和 verify 阶段最终验收。

### 5. 扩展 smoke

更新：

```text
test/smoke.mjs
```

新增最小覆盖：

- 未初始化时 `verify complete` 返回 `PROJECT_NOT_INITIALIZED`。
- 已初始化但没有 active task 时返回 `NO_ACTIVE_TASK`。
- 有 `plan.md` 但没有 `task.json` 时返回 `TASK_STATE_NOT_FOUND`。
- 存在 `pending` task 时返回 `TASK_NOT_VERIFIABLE`，且不写入状态。
- 所有 task 都是 `completed` 后，`passed` 写入 `status: "verified"`、`stage: "verified"`、`verification.status: "passed"`。
- `needs_fix` 会 append `R1`，顶层退回 `active` / `executing`，新增 repair task 为 `pending`。
- 已有已完成的 `R1` 后，再次 `/verify` 发现新的独立修复缺口时，`needs_fix` 生成 `R2`。
- `blocked` 写入 `status: "blocked"`、`stage: "verifying"`、`verification.status: "blocked"`。
- `passed` / `blocked` 不修改 `tasks[]` 长度。
- 非法 `verification.status` 会返回 `INVALID_TASK_STATE`。

测试仍保持一个 `test/smoke.mjs`，不新增测试框架。需要临时目录时继续使用系统临时目录；如果后续需要落盘 fixture，再放入 `./test/` 下。

## 文件落点

推荐新增：

```text
scripts/verify.mjs
skills/verify/SKILL.md
```

推荐更新：

```text
scripts/lib/schema.mjs
agents/verifier.md
test/smoke.mjs
```

暂不新增：

```text
scripts/lib/verify.mjs
agents/reviewer.md
docs/verify-report.md
events.jsonl
checks.jsonl
evidence.jsonl
changed-files.json
```

这些文件会把 verify 阶段推向长期审计或复杂 review 系统，不符合当前 MVP 的轻量状态边界。

## 错误码建议

沿用已有错误码，必要时补充最少新增项。

应使用：

```text
PROJECT_NOT_INITIALIZED
NO_ACTIVE_TASK
MULTIPLE_ACTIVE_TASKS
PLAN_NOT_FOUND
TASK_STATE_NOT_FOUND
TASK_NOT_VERIFIABLE
INVALID_INPUT
INVALID_PROJECT_STATE
INVALID_TASK_STATE
LOCK_TIMEOUT
```

建议新增：

```text
INVALID_REPAIR_TASK
```

如果希望更少错误码，也可以把 repair task 输入问题归入 `INVALID_INPUT`。第一版优先使用 `INVALID_INPUT` 即可，除非 skill 需要区分展示。

## 验收标准

实现完成后应满足：

- `node scripts/verify.mjs --help` 能输出用法。
- `node scripts/verify.mjs complete` 使用 stdin JSON，成功和失败都输出稳定 JSON。
- `/verify` 写入只发生在当前任务的 `task.json`。
- `/verify` 不更新 `.my-cc-lite/project.json`。
- `/verify` 不修改 `plan.md`。
- `passed`、`needs_fix`、`blocked` 三种状态写入符合 `05-verify-stage-design.md` 的映射。
- `needs_fix` 只 append repair tasks，不改写已有 task。
- `verifier.md` 同时描述 `task_review` 和 `final_verify`，且明确 verifier 无状态写入权。
- `test/smoke.mjs` 覆盖核心状态契约，并通过：

```bash
node test/smoke.mjs
```

## 取舍

本方案接受：

- `/verify` skill 做判断，脚本只做确定性状态写入。
- repair task 只做最小 append，不引入独立 issue/evidence/report 模型。
- 验证摘要只保存一句到几句短文本。
- smoke 只覆盖核心状态读写，不建立完整测试框架。

本方案不采用：

- `/verify` 自动修复代码。
- `/verify` 自动重新拆解已有 task。
- `/verify` 自动归档。
- 让 verifier 或 review helper 直接写 `task.json`。
- 为每条 check 保存独立状态或命令日志。
- 用 `project.json` 记录当前 verify 进度。
