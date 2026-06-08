# Verify Stage Design

本设计定义 my-cc-lite `/verify` 阶段的职责、状态写入边界和脚本协议。它建立在 `00-core-workflow-state.md`、`01-stage-scripts.md`、`03-plan-stage-design.md` 和 `04-do-stage-design.md` 之上。

`/verify` 的核心作用是对当前任务做一轮任务级验收，并把最终结论写回当前任务目录下的 `task.json`。它不执行修复，不重新拆解任务，也不自动归档。

## 阶段定位

`/do` 的局部检查只判断单个 `tasks[]` entry 是否满足自己的 `checks[]`。`/verify` 判断整个当前任务是否满足 `plan.md` 中的目标、范围和验收口径。

`/verify` 处在 `/do` 和 `/archive` 之间：

```text
/do -> /verify -> /archive
       |
       v
      /do
```

常规回路是：

```text
/do -> completed tasks -> /verify -> needs_fix -> /do -> /verify -> passed -> /archive
```

`/verify` 必须保持这些边界：

- 只读写当前任务目录。
- 读取当前任务目录下的 `plan.md`。
- 读取并更新当前任务目录下的 `task.json`。
- 不更新 `.my-cc-lite/project.json`。
- 不修改 `plan.md`。
- 不修改已有 task、step 或 check。
- 不记录 changed files、命令日志、事件日志或证据文件。
- 不自动归档任务。

唯一允许改变 `tasks[]` 结构的情况是：验证结论为 `needs_fix` 时，append 一个或少量新的 repair tasks 到 `tasks[]` 末尾。

## 判断依据

`/verify` 同时参考以下信息：

- `plan.md` 中的 `Objective`、`Scope`、`Plan` 和各工作项 `Check`。
- `task.json.objective` 中的执行目标快照。
- `task.json.tasks[]` 中每个 task 的状态和 `checks[]`。
- 当前项目文件、必要命令输出、review helper 输出或用户补充说明。

`plan.md` 是最终人类语义来源。`task.json.tasks[]` 和 `checks[]` 是 `/do` 阶段固化下来的执行检查结构。

当 `plan.md` 和 `task.json` 存在轻微表述差异时，`/verify` 以 `plan.md` 的目标和验收口径判断任务是否达成，以 `task.json.tasks[]` 和 `checks[]` 判断执行结果是否支撑通过。若差异会影响通过判断，`/verify` 不应自行改写状态让它通过，而应返回需要回到 `/plan` 或 `/do` 的结论。

`/verify` 可以读取项目文件、运行必要检查命令或委派 review helper 来形成判断。这些上下文只服务于本轮判断，不落成新的长期状态模型。

## 进入条件

`/verify` 进入正式验证前必须满足：

- `.my-cc-lite/project.json` 存在且结构合法。
- `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 当前任务目录未归档。
- 当前任务目录下存在非空 `plan.md`。
- 当前任务目录下存在结构合法的 `task.json`。
- `task.json.tasks[]` 非空。
- 所有 `tasks[].status` 都是 `completed` 或 `skipped`。
- 至少存在一个 `completed` task。

如果没有当前任务目录，说明没有可验证任务；如果存在多个当前任务目录，说明当前任务状态不唯一。两种情况都应停止 `/verify`，不写入状态。

如果仍存在 `pending`、`in_progress`、`blocked` 或 `failed` task，`/verify` 应停止，不写入 `task.json`，并提示回到 `/do` 继续执行、修复或处理阻塞。

如果所有 task 都是 `skipped`，`/verify` 应停止，不写入 `task.json`，并提示回到 `/plan` 重新确认任务是否仍然成立。`skipped` 只表示单个 task 被明确跳过且不影响整体验收，不能作为整个任务通过验证的唯一依据。

## 验证结论

`task.json.verification.status` 使用以下状态：

```text
not_started
passed
needs_fix
blocked
```

状态语义：

- `not_started`：`/do materialize` 初始化后的默认状态。
- `passed`：整个任务已经满足 `plan.md` 的目标、范围和验收口径。
- `needs_fix`：本轮验证未通过，且 `/verify` 已经 append 一个或少量后续 `/do` 可执行的 repair tasks。
- `blocked`：本轮验证未通过，但无法形成明确 repair task，或缺少用户决策、权限、外部环境、计划调整、可靠判断条件。

写入规则：

| 结论 | 顶层 `status` | 顶层 `stage` | `verification.status` | `tasks[]` |
| --- | --- | --- | --- | --- |
| `passed` | `verified` | `verified` | `passed` | 不修改 |
| `needs_fix` | `active` | `executing` | `needs_fix` | append repair tasks |
| `blocked` | `blocked` | `verifying` | `blocked` | 不修改 |

每次写入都必须刷新顶层 `updatedAt`，并写入 `verification.summary`。

`/verify` 不写入验证过程中的持久中间态。模型侧读取文件、运行检查、委派 helper 和形成判断时不落盘；只有形成最终结论后，才通过 `scripts/verify.mjs complete` 一次性写入 `passed`、`needs_fix` 或 `blocked`。如果验证过程被中断，`task.json` 保持原状，下一次 `/verify` 重新执行本轮验证即可。

`verification.summary` 只保存一句到几句短摘要，说明最终结论和下一步。它不保存完整 review 报告、命令输出、文件列表或 agent 响应。

当结论是 `needs_fix` 时，`verification.summary` 必须说明新增 repair task id 列表和本轮验证缺口。后续 `/do` 不需要判断 `verification.status`，只按普通 `pending` task 执行 repair tasks。

## Repair Task

repair task 是 `/verify` 发现验收缺口后，为 `/do` 创建的最小修复入口。

repair task 必须满足：

- 来源必须是原 `plan.md` 的目标、范围、验收口径，或已有 `tasks[].checks[]`。
- 不能引入新需求。
- 不能扩大任务范围。
- 默认优先 append 一个 repair task。
- 只有多个修复入口都明确、互相独立、仍属于原 `plan.md` 验收口径，并且后续 `/do` 可以直接执行时，才 append 多个 repair tasks。
- 只能 append，不能删除、重排、合并、拆分已有 task。
- 不能修改已有 task 的 `id`、`title`、`steps`、`checks`、`status` 或 `statusReason`。
- `steps[]` 和 `checks[]` 保持短，不保存完整 review 报告、命令输出、文件列表或 evidence。
- 如果已有未完成 repair task 可以承接本轮问题，不再 append 新 task，应提示先执行现有 repair task，或在无法继续时写入 `blocked`。
- 如果问题很多、互相耦合、需要重新拆解，或无法控制范围，应写入 `blocked` 或提示回到 `/plan`。

repair task 对 `/do` 来说就是普通 task，沿用：

```text
pending -> in_progress -> completed | blocked | failed
```

repair task id 使用 `R<number>`：

```text
R1
R2
R3
```

生成规则：

- 扫描现有 `tasks[].id` 中的 `R<number>`。
- 使用下一个编号。
- 不和已有 task id 冲突。

写入 `needs_fix` 的最小示例：

```json
{
  "status": "active",
  "stage": "executing",
  "verification": {
    "status": "needs_fix",
    "summary": "Added R1 to run the smoke check required by plan.md before retrying /verify."
  },
  "tasks": [
    {
      "id": "R1",
      "title": "Fix verification issue: missing smoke check",
      "status": "pending",
      "steps": [
        "Run the smoke check required by plan.md",
        "Fix any issue found by the smoke check"
      ],
      "checks": [
        "The smoke check has been run",
        "The result satisfies the original plan.md acceptance criteria"
      ],
      "statusReason": ""
    }
  ]
}
```

该示例只展示相关字段。真实 `task.json` 中原有 task 必须保持不变，repair task 只能追加到末尾。

## 协作流程

`/verify` skill 负责模型侧判断和 helper 协作，`scripts/verify.mjs` 只负责确定性状态读写。

推荐流程：

1. 读取 `.my-cc-lite/project.json`。
2. 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
3. 读取当前 `plan.md`。
4. 读取并校验当前 `task.json`。
5. 检查进入条件。
6. 如果任一进入条件不满足，停止，不写入状态，并返回下一步建议。
7. 根据 `plan.md`、`task.json.tasks[]` 和 `checks[]` 形成本轮验证问题清单。
8. 必要时委派 `verifier` 的 `final_verify` mode，或调用 `stageHelpers.review` 中合适的 review helper。
9. 必要时读取相关项目文件或运行轻量检查命令。
10. 根据验证判断调用 `scripts/verify.mjs complete` 写入 `passed`、`needs_fix` 或 `blocked`；写入 `needs_fix` 时必须同时提供 repair tasks。
11. 返回验证结论、简短原因和下一步建议。

如果验证通过，下一步建议是 `/archive`。如果需要修复，下一步建议是回到 `/do`。如果阻塞来自计划口径不清或目标变化，下一步建议是回到 `/plan` 调整计划。

## verifier final_verify

`verifier` 继续作为单个检查 agent，不拆成新的 reviewer agent。`/do` 阶段使用 `task_review` mode，`/verify` 阶段使用 `final_verify` mode。

`final_verify` 只提供判断建议，不拥有状态写入权。即使它建议 `needs_fix`，真正 append repair tasks 的动作也必须由 `/verify` skill 调用 `scripts/verify.mjs complete` 完成。

### 输入

- 当前 `plan.md`。
- 完整 `task.json`。
- 所有 `tasks[]` entry 的 `id`、`title`、`status` 和 `checks[]`。
- 必要项目上下文、文件片段、命令输出摘要或用户补充信息。
- `/verify` skill 已经识别出的关键验收问题。

### 职责

- 判断整个任务是否满足 `plan.md` 的目标、范围和验收口径。
- 检查 `tasks[]` 的完成状态是否支撑最终通过。
- 根据各 task 的 `checks[]` 判断是否仍有遗漏。
- 建议 `passed`、`needs_fix` 或 `blocked`。
- 给出一句到几句短原因。

### 禁止事项

- 不写 `task.json`。
- 不修改文件。
- 不调用阶段脚本。
- 不新增、删除或改写 `tasks[]`、`steps[]` 或 `checks[]`。
- 不自动归档任务。
- 不把完整检查报告写入本地状态。

### 输出

建议输出结构：

```text
result: passed | needs_fix | blocked
reason: <short reason>
next: <archive | do | plan | user_decision>
```

`needs_fix` 表示当前问题可以被收敛成一个或少量 repair tasks。`blocked` 表示缺少用户决策、权限、外部条件、计划调整或无法由当前上下文可靠判断。

## review helpers

`project.json.stageHelpers.review` 只作为提示层参考，不由 `verify.mjs` 自动调用。

`/verify` skill 可以根据 helper 描述决定是否调用或委派 review helper，例如：

- 代码审查 skill。
- 安全审查 agent。
- 架构一致性检查 helper。
- 项目特定验证工具。
- 代码上下文分析工具。

边界：

- helper 输出只能作为最终验证判断的依据。
- helper 不拥有 `task.json` 写入权。
- helper 不替代 `/verify` skill 做阶段推进。
- helper 不改变 `tasks[]`、`steps[]` 或 `checks[]`。
- 如果 helper 不可用，`/verify` 应退回 Claude Code 原生读写、搜索和命令执行能力。

`/verify` 不应把所有可见工具列为候选。候选只包括能帮助最终 review 判断的高阶能力，不包括 `Read`、`Edit`、`Bash` 等原子工具。

## scripts/verify.mjs

`verify.mjs` 对应 `/verify` 的确定性状态入口。建议命令：

```text
node scripts/verify.mjs complete
```

`complete` 写入本轮验证结论。

输入示例：

```json
{
  "status": "passed",
  "summary": "All planned checks passed."
}
```

写入 `needs_fix` 时的输入示例：

```json
{
  "status": "needs_fix",
  "summary": "Added R1 to run the missing smoke check before retrying /verify.",
  "repairTasks": [
    {
      "title": "Fix verification issue: missing smoke check",
      "steps": [
        "Run the smoke check required by plan.md",
        "Fix any issue found by the smoke check"
      ],
      "checks": [
        "The smoke check has been run",
        "The result satisfies the original plan.md acceptance criteria"
      ]
    }
  ]
}
```

允许的 `status`：

```text
passed
needs_fix
blocked
```

行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 读取当前 `plan.md`。
- 读取并校验当前 `task.json`。
- 校验输入 `summary` 非空且保持简短。
- 当 `status` 是 `passed` 时，要求 `tasks[]` 非空，所有 `tasks[].status` 都是 `completed` 或 `skipped`，且至少存在一个 `completed` task。
- 当仍存在 `pending`、`in_progress`、`failed` 或 `blocked` task 时，不允许写入 `passed`。
- 当 `status` 是 `needs_fix` 时，要求输入包含 `repairTasks`，并 append 一个或少量 `pending` repair tasks 到 `tasks[]` 末尾。
- 当 `status` 是 `blocked` 或 `passed` 时，不允许输入 `repairTasks`。
- 根据结论更新顶层 `status`、`stage`、`updatedAt`、`verification.status` 和 `verification.summary`。
- 输出 `taskId`、`taskPath`、`planPath`、顶层状态、verification 摘要和新增 repair tasks 摘要。

成功输出示例：

```json
{
  "ok": true,
  "result": {
    "taskId": "20260607-153012-add-feature",
    "taskPath": "/path/to/project/.my-cc-lite/tasks/20260607-153012-add-feature/task.json",
    "planPath": "/path/to/project/.my-cc-lite/tasks/20260607-153012-add-feature/plan.md",
    "status": "verified",
    "stage": "verified",
    "verification": {
      "status": "passed",
      "summary": "All planned checks passed."
    }
  }
}
```

失败输出沿用 `01-stage-scripts.md` 的统一错误格式。

### 错误码

`verify.mjs` 至少使用这些错误码：

```text
PROJECT_NOT_INITIALIZED
NO_ACTIVE_TASK
MULTIPLE_ACTIVE_TASKS
PLAN_NOT_FOUND
TASK_STATE_NOT_FOUND
TASK_NOT_VERIFIABLE
REPAIR_TASK_EXISTS
INVALID_INPUT
INVALID_PROJECT_STATE
INVALID_TASK_STATE
LOCK_TIMEOUT
```

错误语义：

- `PROJECT_NOT_INITIALIZED`：找不到 `.my-cc-lite/project.json`。
- `NO_ACTIVE_TASK`：`.my-cc-lite/tasks/` 下没有当前任务目录。
- `MULTIPLE_ACTIVE_TASKS`：`.my-cc-lite/tasks/` 下存在多个任务目录，状态异常，不能隐式选择。
- `PLAN_NOT_FOUND`：当前任务目录下缺少 `plan.md`。
- `TASK_STATE_NOT_FOUND`：当前任务目录下缺少 `task.json`，需要先执行 `/do`。
- `TASK_NOT_VERIFIABLE`：任务状态不允许写入通过结论，例如仍有 `pending`、`in_progress`、`blocked` 或 `failed` task。
- `REPAIR_TASK_EXISTS`：已有未完成 repair task 可以承接本轮问题，不能继续 append 新 repair task。
- `INVALID_INPUT`：stdin JSON 缺少必要字段或字段结构非法。
- `INVALID_PROJECT_STATE`：`project.json` 不合法。
- `INVALID_TASK_STATE`：`task.json` 不合法。
- `LOCK_TIMEOUT`：无法获得 `.my-cc-lite/state.lock`。

## 公共库补充

为了实现 `verify.mjs`，需要在公共库补齐最小接口。

`scripts/lib/schema.mjs` 增加：

```js
normalizeVerifyCompleteInput(input);
assertVerifiableTask(task);
nextRepairTaskId(task);
summarizeVerification(task);
```

`assertVerifiableTask(task)` 只用于进入正式验证或写入 `passed` 前的确定性校验：

- `task.tasks` 非空。
- 所有 task 状态都是 `completed` 或 `skipped`。
- 至少存在一个 `completed` task。
- `task.stage` 不是 `archived`。

它不读取、不解析 `plan.md`，也不支持所有 task 都是 `skipped` 时通过。

`normalizeVerifyCompleteInput(input)` 接受：

```ts
type VerifyCompleteInput = {
  status: "passed" | "needs_fix" | "blocked";
  summary: string;
  repairTasks?: Array<{
    title: string;
    steps: Step[];
    checks: string[];
  }>;
};
```

输入规则：

- `status: "needs_fix"` 时必须包含 `repairTasks`。
- `repairTasks.length >= 1`。
- `status: "passed"` 和 `status: "blocked"` 时不允许包含 `repairTasks`。
- 每个 repair task 的 `title`、`steps` 和 `checks` 必须非空。
- `repairTasks` 应保持少量，不能把完整 review findings 拆成大量 task。

`nextRepairTaskId(task)` 通过扫描现有 `tasks[].id` 中的 `R<number>` 生成下一个 repair task id，并确保不和已有 task id 冲突。写入多个 repair tasks 时，从下一个编号开始连续生成。

`scripts/lib/state.mjs` 不需要理解验证语义。它继续只提供当前任务目录定位、`plan.md` 读取、`task.json` 读写和锁。

## skills/verify/SKILL.md

`skills/verify/SKILL.md` 是 `/verify` 的模型侧入口。

它负责：

- 读取当前项目状态。
- 判断是否可以进入正式验证。
- 根据 `plan.md`、`task.json` 和项目上下文形成本轮检查判断。
- 必要时委派 `verifier final_verify` 或 review helper。
- 调用 `scripts/verify.mjs complete` 写入结论。
- 在对话中返回短结论和下一步建议。

它不负责：

- 修改业务代码。
- 修改 `plan.md`。
- 修改已有 `tasks[]`、`steps[]` 或 `checks[]`。
- 在 `needs_fix` 之外 append repair task。
- 替 `/do` 执行修复。
- 自动调用 `/archive`。

## 与其他阶段的交接

`/verify` 发现问题后，不直接修复。它只能把明确、有限、仍属于原验收口径的问题转换成 repair tasks，然后交回 `/do`。

当 `verification.status` 是 `needs_fix` 时，顶层状态必须已经写回：

```json
{
  "status": "active",
  "stage": "executing",
  "verification": {
    "status": "needs_fix"
  }
}
```

后续 `/do` 不需要读取 `verification.status` 或解析 `verification.summary`，只按既有规则选择 `pending` task 执行。

如果 `/verify` 发现验收口径本身不合理，应提示回到 `/plan` 修改 `plan.md`。不要在 `/verify` 中降低 `checks[]` 或改写计划。

`/verify` 通过后不自动归档。当写入：

```json
{
  "status": "verified",
  "stage": "verified",
  "verification": {
    "status": "passed"
  }
}
```

后，`/verify` 在对话中提示下一步可以执行 `/archive`。

`/archive` 后续只负责移动当前任务目录到 `.my-cc-lite/archived_tasks/<taskId>/`，并写入归档摘要和时间。归档设计不属于本文件范围。

## 验证

`/verify` 阶段的验证以 smoke 为主，不建立完整测试框架。

最小 smoke 场景：

1. 未初始化项目执行 `verify.mjs complete`，返回 `PROJECT_NOT_INITIALIZED`。
2. 已初始化但没有当前任务目录，返回 `NO_ACTIVE_TASK`。
3. 当前任务目录缺少 `plan.md`，返回 `PLAN_NOT_FOUND`。
4. 当前任务目录缺少 `task.json`，返回 `TASK_STATE_NOT_FOUND`。
5. 存在 `pending` 或 `failed` task 时，`complete` 写入 `passed` 返回 `TASK_NOT_VERIFIABLE`。
6. `tasks[]` 非空、所有 task 都是 `completed` 或 `skipped`，且至少存在一个 `completed` task 时，`complete` 写入 `passed`，顶层变为 `status: "verified"` 和 `stage: "verified"`。
7. `complete` 写入 `needs_fix` 时，append 一个或少量 `pending` repair tasks，顶层变为 `status: "active"` 和 `stage: "executing"`。
8. `complete` 写入 `blocked` 时，顶层变为 `status: "blocked"` 和 `stage: "verifying"`。
9. 确认 `/verify needs_fix` 只 append repair tasks，没有修改已有 task。
10. 确认 `/verify` 没有修改 `project.json`、`plan.md`，也没有写入 changed files / 执行日志。

如果这些场景通过，`/verify` 阶段的本地状态契约即可认为成立。

## 取舍

本方案刻意不引入：

- check 级验证状态。
- 独立 review findings 文件。
- changed files、命令日志、证据日志或完整报告。
- 自动修复。
- 自动归档。
- 自动回退 task 状态。
- 修改已有 task。
- 多 verifier agent 拆分。
- 对 `plan.md` 和 `task.json` 的自动同步。

保留的核心能力是：

- 对已执行完成的当前任务做一轮任务级验收。
- 用 `verification.status` 和 `verification.summary` 保存最小结论。
- 用顶层 `status/stage` 表示任务已经验证通过或仍需处理。
- 在 `needs_fix` 时 append 一个或少量后续 `/do` 可执行的 repair tasks。
- 允许 `verifier final_verify` 和 review helper 参与判断，但不拥有状态写入权。
- 让 `/do -> /verify -> /do` 的修复回路成立，同时避免把 `/verify` 做成新的执行系统。
