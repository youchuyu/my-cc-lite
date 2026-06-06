# Core Workflow And Local State Design

本模块定义 my-cc-lite 写入目标项目的本地数据。目标是保持状态轻量、可读、可恢复，同时让计划文本、执行任务和检查任务各自承担清晰职责。

## 根目录

所有数据写入目标项目根目录：

```text
.my-cc-lite/
  project.json
  tasks/
    <taskId>/
      task.json
      plan.md
  archived_tasks/
    <taskId>/
      task.json
      plan.md
```

插件安装目录只提供 skills、hooks、agents 和 scripts，不保存目标项目任务状态。

## 设计原则

- 项目级只保留 `project.json`。
- 每个任务使用一个目录。
- 每个任务目录只保留 `task.json` 和 `plan.md`。
- 已归档任务从 `tasks/<taskId>/` 移动到 `archived_tasks/<taskId>/`。
- `project.json` 是项目级状态源，只由 `/init` 创建或更新。
- 任务生命周期不更新 `project.json`。
- `plan.md` 是计划阶段唯一产物，允许用户在执行前调整。
- `task.json` 是执行阶段创建的任务级机器状态源。
- `tasks[]` 面向 executor 子 agent，记录要执行的子任务。
- `tasks[].steps[]` 记录 executor 子 agent 需要完成的动作清单，允许用轻量树形结构表达复杂动作拆解。
- `tasks[].checks[]` 记录 review/verifier 子 agent 需要检查的内容。
- MVP 只允许一个 current task。`.my-cc-lite/tasks/` 下存在未归档任务目录时，新的 `/plan` 必须阻止创建新任务。
- 不再拆分 `current-task.json`、`capabilities.json`、`workflow.json`、`events.jsonl`、`checks.jsonl`、`evidence.jsonl`、`changed-files.json` 和 `archive.md`。

## project.json

`project.json` 记录初始化信息、项目摘要和阶段可用 helper。

`/init` 每次执行都会重写 `project.json` 中的项目摘要和 `stageHelpers`。`/init` 不读取或修改当前 task，也不创建、修改、切换或归档 task。

```json
{
  "initializedAt": "2026-06-06T15:30:12+08:00",
  "updatedAt": "2026-06-06T15:40:00+08:00",
  "projectRoot": "/path/to/project",
  "projectSummary": "A Claude Code plugin project for lightweight task workflow state.",
  "stageHelpers": {
    "planning": [],
    "execution": [],
    "review": []
  }
}
```

### projectSummary

`projectSummary` 是模型基于当前项目上下文写入的一句简短摘要。

它给后续 `/plan`、`/do` 和 `/verify` 提供轻量方向感，但不作为机器决策契约。

### stageHelpers

`stageHelpers` 保存 `/init` 收集到的阶段可用 companion helper。

只记录 my-cc-lite 阶段可以直接调用或委派的能力：

- `planning`：供 `/plan` 使用。
- `execution`：供 `/do` 使用。
- `review`：供 `/verify` 使用。

不记录 Claude Code 原生基础工具，也不记录 my-cc-lite 自身能力。

helper 条目保持扁平：

```json
{
  "name": "Workflow",
  "kind": "tool",
  "description": "Run deterministic multi-agent orchestration after explicit ultrawork opt-in",
  "invoke": "Workflow"
}
```

## tasks/<taskId>/

每个未归档任务使用一个目录：

```text
.my-cc-lite/tasks/20260606-153012-add-feature/
  task.json
  plan.md
```

`task.json` 由 `/do` 首次执行时创建，供 helper 读写，负责阶段、状态、执行任务、检查任务、验证和归档摘要。

`plan.md` 供用户和 Claude Code 阅读，负责目标、计划说明、风险和整体讨论。

### 当前任务定位

MVP 只允许一个未归档任务。

helper 通过扫描 `.my-cc-lite/tasks/` 下的任务目录定位当前任务：

- 没有任务目录：当前没有 active task。
- 只有一个任务目录：该目录就是 current task。
- 多于一个任务目录：状态异常，helper 必须报错，不做隐式选择。

这样任务生命周期不需要更新 `project.json`，归档时也只需要移动当前任务目录。

### 阶段写入边界

`/init` 只写 `project.json`。

`/plan` 只负责创建新的任务目录和 `plan.md`：

```text
.my-cc-lite/tasks/<taskId>/plan.md
```

如果 `.my-cc-lite/tasks/` 下已经存在未归档任务目录，`/plan` 必须拒绝创建新任务。

`/do` 只读写当前任务目录：

- 读取 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 首次执行时创建 `.my-cc-lite/tasks/<taskId>/task.json`。
- 后续执行时更新 `.my-cc-lite/tasks/<taskId>/task.json`。

`/verify` 只读写当前任务目录：

- 读取 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 读取并更新 `.my-cc-lite/tasks/<taskId>/task.json`。

`/archive` 只移动当前任务目录：

```text
.my-cc-lite/tasks/<taskId>/
-> .my-cc-lite/archived_tasks/<taskId>/
```

`/plan`、`/do`、`/verify` 和 `/archive` 都不更新 `project.json`。

## task.json

`task.json` 是任务级唯一机器状态源。它不由 `/plan` 创建，而是在 `/do` 首次执行时根据当前 `plan.md` 创建：

```json
{
  "taskId": "20260606-153012-add-feature",
  "objective": "用户原始目标",
  "status": "active",
  "stage": "executing",
  "createdAt": "2026-06-06T15:30:12+08:00",
  "updatedAt": "2026-06-06T15:42:00+08:00",
  "tasks": [
    {
      "id": "T1",
      "title": "实现计划中的第一个子任务",
      "status": "pending",
      "steps": [
        "阅读当前 plan.md",
        {
          "title": "完成代码或文档修改",
          "steps": [
            "定位需要修改的文件",
            "按计划执行最小必要修改"
          ]
        },
        "更新 task 级执行状态"
      ],
      "checks": [
        "确认修改符合 plan.md",
        "确认 task.json 中对应 task 状态已更新",
        "确认后续 /verify 可以根据 checks[] 检查结果"
      ]
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

`/do` 根据当前 `plan.md` 创建或更新 `tasks[]`，并在每个 task 内写入对应的 `steps[]` 和 `checks[]`。`steps[]` 可以用嵌套结构表达动作层级，但不记录 step 级状态。进入执行阶段后，`task.json` 记录执行状态；`/verify` 同时参考最新 `plan.md` 和 `task.json` 判断任务是否完成。

## plan.md

`plan.md` 是人类可读计划，不作为状态机依据。

建议结构：

```text
# Task: <taskId>

## Objective

## Plan

## Execution Tasks

## Review Checks

## Risks

## Notes
```

`/plan` 创建任务时只写入 `plan.md`，不创建 `task.json`，也不把可执行子任务同步到 `task.json.tasks[]`。每个 task 的执行动作和检查要求由 `/do` 在执行阶段根据最新 `plan.md` 生成。

后续如果用户手动调整 `plan.md`，不需要额外 sync。下一次 `/do` 读取最新 `plan.md`，并据此决定后续执行拆解。

## tasks[]

`tasks[]` 维护执行阶段需要交给 executor 子 agent 的子任务。每个 task 自带执行动作清单和检查清单。

字段：

- `id`：稳定编号，例如 `T1`。
- `title`：短标题，用于列表展示。
- `status`：执行状态。
- `steps`：可嵌套动作清单，记录 executor 子 agent 需要完成的执行拆解。
- `checks`：字符串数组，记录 review/verifier 子 agent 需要检查的内容。

### steps

`steps` 用于描述 task 内部的执行动作。简单动作直接写字符串；复杂动作可以写成带标题的分组。

类型约定：

```ts
type Step =
  | string
  | {
      title: string;
      steps: Step[];
    };
```

字符串 step 表示一个叶子动作：

```json
"运行显式 node 检查命令"
```

对象 step 表示一个分组动作：

```json
{
  "title": "更新本地状态设计",
  "steps": [
    "调整 task.json 示例",
    "补充 steps 字段说明",
    "补充嵌套 steps 的边界规则"
  ]
}
```

对象 step 可以继续嵌套：

```json
{
  "title": "更新任务状态模型",
  "steps": [
    "调整 tasks[] 字段说明",
    {
      "title": "补充 steps 结构",
      "steps": [
        "增加 Step 类型约定",
        "增加嵌套 steps 示例",
        "说明 step 不维护独立状态"
      ]
    },
    "确认 checks[] 仍保持扁平"
  ]
}
```

对象 step 只表达动作层级，不维护独立状态。MVP 不在 step 上增加 `id`、`status`、`checks`、`evidence` 或执行日志。

如果某个动作需要独立状态、检查、跳过、失败重试或单独委派，应提升为 `tasks[]` 中的独立 task，而不是放进嵌套 `steps`。

示例：

```json
{
  "id": "T1",
  "title": "实现计划中的第一个子任务",
  "status": "pending",
  "steps": [
    "阅读当前 plan.md",
    {
      "title": "完成代码或文档修改",
      "steps": [
        "定位需要修改的文件",
        "按计划执行最小必要修改"
      ]
    },
    "更新 task 级执行状态"
  ],
  "checks": [
    "确认修改符合 plan.md",
    "确认 task.json 中对应 task 状态已更新",
    "确认后续 /verify 可以根据 checks[] 检查结果"
  ]
}
```

`tasks[]` 不记录 changed files、执行命令或完整日志。执行完成后只回写 task 级 `status`。如果失败或阻塞原因需要保留，优先写入 `verification.summary` 或归档摘要，不在 task 内维护半结构化日志。

`tasks[].steps[]` 存储的是执行动作，不是状态机。`/do` 可以按自然顺序递归展开分组 step，但只回写 task 级状态，不回写每条 step 的完成状态。

`tasks[].checks[]` 存储的是检查要求，不是 shell 命令记录，也不单独维护每条 check 的状态。`checks[]` MVP 保持字符串数组，不跟随 `steps[]` 树形化。具体检查可以由 review/verifier 子 agent 根据项目上下文决定，最终结论写入任务级 `verification`。

## 任务状态

任务整体状态：

```text
active
blocked
verified
archived
```

任务阶段：

```text
planned
executing
verifying
verified
archived
```

执行任务状态：

```text
pending
in_progress
completed
failed
blocked
skipped
```

## verification

`verification` 保存任务级最终验证结果，不记录完整检查日志。

```json
{
  "verification": {
    "status": "not_started",
    "summary": ""
  }
}
```

`/verify` 只有在所有 tasks 完成或明确 skipped，且 review/verifier 根据每个 task 的 `checks[]` 判断通过后，才可以将 `verification.status` 设置为 `passed`。

验证状态：

```text
not_started
in_progress
passed
failed
```

## archived_tasks

`/archive` 用于关闭当前 task，不要求 `verification.status` 为 `passed`。归档不会修改 `verification.status`，任务是否完成以 `verification.status` 是否为 `passed` 为准。

归档成功后，将任务目录从：

```text
.my-cc-lite/tasks/<taskId>/
```

移动到：

```text
.my-cc-lite/archived_tasks/<taskId>/
```

归档后的 `task.json` 仍保持同一结构，只更新：

```json
{
  "status": "archived",
  "stage": "archived",
  "archive": {
    "summary": "Human-readable task completion summary",
    "archivedAt": "2026-06-06T16:00:00+08:00"
  }
}
```

`plan.md` 随目录一起移动，用于归档后回看原计划。

## 锁

helper 写状态时应使用轻量锁：

```text
.my-cc-lite/state.lock
```

锁只覆盖短时间 JSON 读写，避免 hooks 和 skill 同时写入导致状态损坏。

`state.lock` 是运行时临时文件，不属于项目状态模型。

## 取舍

当前模型比单 task JSON 多一个 `plan.md`，但边界更清晰：

- `task.json` 面向机器读写。
- `plan.md` 面向人类阅读和讨论。
- `tasks[]` 面向 executor 子 agent。
- `tasks[].steps[]` 面向 executor 子 agent 的动作拆解，可以嵌套表达复杂动作层级。
- `tasks[].checks[]` 面向 review/verifier 子 agent 的检查清单。
- 归档时移动整个任务目录，后续扩展少量附件不需要改变路径模型。

接受的取舍：

- 不保留完整事件审计。
- 不记录 changed files。
- 不记录执行命令日志。
- 不把检查项写成命令列表。
- 不给每条 check 单独维护 id、状态或结果。
- 不给每条 step 单独维护 id、状态、检查或执行结果。
- 手动修改 `plan.md` 不需要同步命令；后续 `/do` 读取最新计划。

保留的核心能力：

- 能判断项目是否初始化。
- 能定位当前任务。
- 能恢复任务阶段、执行任务进度和检查任务进度。
- 能直接阅读计划。
- 能把 task 的动作清单交给 executor 子 agent。
- 能把 task 的检查清单交给 review/verifier 子 agent。
- 能把关闭后的任务移动到 `archived_tasks`。

脚本实现边界见 `01-stage-scripts.md`。
