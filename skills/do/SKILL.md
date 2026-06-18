---
name: do
description: 执行当前 my-cc-lite plan.md 并推进 task.json 任务状态
disable-model-invocation: true
---

# Do

`/do` 是 my-cc-lite 的执行状态编排阶段。它把当前 active task 的 `plan.md` 物化为 `task.json`，然后推进其中可执行的 `subtasks[]` entry 的状态。

`/do` 只维护 task 级执行状态和执行交接，不维护 step/check 级状态，不做业务代码读取、业务实现、最终验收或归档。

## 使用条件

当用户手动调用 `/do`，或明确要求继续执行当前 my-cc-lite 任务时使用。

当前工作目录应是目标项目根目录。显式 `/do` 的基础入口硬门禁由 preflight hook 提前阻断。

## 流程总览

`/do` 每次从 `inspect` 开始，读取当前 active task 的状态快照。`/do` 先根据当前任务是否已经存在 `task.json` 分流：

- 如果 `task.json` 不存在，进入**首次物化流程**。首次物化成功后，`/do` 基于完整 `task.json.subtasks[]` 选择后续完整执行流程的**接管方式**。
- 如果 `task.json` 已存在，`/do` 不重新选择接管方式，先进入**恢复状态检查**；只有本轮用户明确要求继续执行时，才进入 **my-cc-lite 原生状态接管**。

**接管方式**面向完整 `task.json`，决定后续整个 `subtasks[]` 如何被编排和交接：

- **my-cc-lite 原生状态接管**：`/do` skill 使用内置 task loop 选择当前 task、确认执行意图、准备执行交接、接收执行结果，并调用 `update-task` 写入执行状态。
- **外部高阶接管**：外部流程接管完整 `subtasks[]` 的执行编排，并通过受限的 `update-task` 接口返回状态写入请求。

无论采用哪种接管方式，都只能推进执行状态，不能修改任务结构。

## 入口检查

1. 调用 `scripts/run.mjs do inspect`，读取当前 `/do` 状态快照。
2. 如果 `inspect` 返回错误，按脚本错误码简短提示下一步，不自行扫描或修复状态。
3. 如果 `inspect` 成功，只基于当前状态快照做静态路由：

- `inspect.result.task.exists === false`：进入**首次物化流程**。
- `inspect.result.task.exists === true`：根据 `inspect.result.task.subtasks[]` 继续路由：
  - 所有 task 都是 `completed` 或 `skipped`：停止并提示进入 `/verify`。
  - 只剩 `blocked` 或 `failed`：停止并请求用户确认恢复、重试、跳过或回到 `/plan`。
  - 存在 `in_progress` 或 `pending`：进入**恢复状态检查**，选择当前 task 并判断本轮是否继续执行。

**入口检查**只基于 `inspect` 结果做静态状态路由，不物化 `task.json`，不选择接管方式，不调度 agent。

已有 `task.json` 的恢复流程只根据 `inspect.result.task.subtasks[]` 选择当前 task；不重新解释完整 `plan.md`，不重新物化，不选择外部接管方式，不读取业务代码。

## 恢复状态检查

进入条件：

```text
inspect.result.task.exists === true
```

流程：

1. 基于 `inspect.result.task.subtasks[]` 选择当前 task：优先选择 `in_progress`，否则选择第一个 `pending`。
2. 向用户说明当前 task 的 `id`、`title`、`status`、必要 `statusReason` 和建议动作。
3. 判断本轮用户意图：

- 如果用户只是要求“恢复任务”、“查看进度”、“看当前状态”或类似状态检查，只输出恢复结果并停止，不写入状态，不调度 executor。
- 如果用户明确要求“继续执行”、“继续推进”、“执行当前 task”或手动调用 `/do` 且没有查看状态/只恢复的限定，进入 **my-cc-lite 原生状态接管**。


## 首次物化流程

进入条件：

```text
inspect.result.task.exists === false
```

流程：

1. 调用 agent `task-materializer`，提供完整 `plan.md`、当前 task 目录路径和首次物化约束。
2. 根据 agent `task-materializer` 返回的 `result` 字段判断物化结果：

- 如果 `result` 是 `ready`，提取 `objective` 和 `subtasks[]` 调用 `scripts/run.mjs do materialize`，成功后重新 `inspect`。
- 如果 `result` 是 `coarse_ready`，先展示 `reason` 和候选拆解并请求用户确认；确认后才允许物化。
- 如果 `result` 是 `needs_plan_update` 或 `blocked`，不创建 `task.json`，说明原因并停止。

3. 物化成功后，根据 `shouldStopAfterMaterialize` 判断本轮是否停止；否则进入**物化后选择接管方式**。

职责边界：

- `/do` 只负责把 `plan` 相关内容交给 agent `task-materializer`。
- `/do` 只负责把 agent `task-materializer` 产出的 `objective` 和 `subtasks[]` 写入项目状态。
- `/do` 不重新解释 `plan.md`，不调整任务拆解，也不持久化流程判断字段。

### 物化后选择接管方式

进入条件：

```text
task.json 首次物化成功，并且 /do 已重新 inspect 拿到完整 task.json.subtasks[]
```

**接管方式选择**只在首次物化成功后出现。此时 `/do` 将当前 `plan.md` 和完整 `task.json` 交给模型判断，确认当前任务是否有适合的外部高阶能力接管执行。

判断时只考虑能编排完整执行流程的能力，例如 Workflow、TeamCreate 等。

如果存在合适的外部接管方式，`/do` 应向用户说明候选项、适用性和风险，并让用户选择。否则默认进入 **my-cc-lite 原生状态接管**。

`Read`、`Write`、`Edit`、`Bash` 等原子工具不作为接管方式；my-cc-lite 内置的 agent `executor`、agent `verifier`、agent `debugger` 也不作为外部接管方式。

接管方式只影响本轮 `/do` 的执行编排选择，不写入状态文件；已有 `task.json` 的后续执行只在用户明确继续时回到 **my-cc-lite 原生状态接管**。

## my-cc-lite 原生状态接管

用于首次物化后选择原生状态接管，或已有 `task.json` 且用户明确继续执行时。按 `reference/native-control.md` 执行，并遵守 `reference/state-boundary.md`。

原生状态接管中，agent `executor` 返回 `completed` 后必须经过 agent `verifier`；只有 agent `verifier` 返回 `passed`，`/do` 才允许写入 `subtasks[].status: "completed"`。

## 外部高阶流程接管

只用于首次物化成功后的**接管方式选择**。按 `reference/external-control.md` 执行，并遵守 `reference/state-boundary.md`。

## 脚本输入

脚本调用统一使用 my-cc-lite runtime entry。`scripts/run.mjs` 必须来自 my-cc-lite 插件根目录，不能因为目标项目根目录下存在同名 `scripts/run.mjs` 就直接调用。

- 如果当前工作目录就是 my-cc-lite 插件源码根目录，且确认该 `scripts/run.mjs` 属于 my-cc-lite，可以使用：

```bash
node scripts/run.mjs do materialize
node scripts/run.mjs do update-task
node scripts/run.mjs do inspect
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs do materialize
node <pluginRoot>/scripts/run.mjs do update-task
node <pluginRoot>/scripts/run.mjs do inspect
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

首次物化：

```json
{
  "objective": "Objective snapshot derived from plan.md",
  "subtasks": [
    {
      "id": "Tn",
      "title": "...",
      "steps": ["..."],
      "checks": ["..."]
    }
  ]
}
```

如果 agent `task-materializer` 返回的是带流程控制字段的完整结果，调用 `materialize` 前只传入 `objective` 和 `subtasks`。`result`、`shouldStopAfterMaterialize` 和 `reason` 只由 `/do` skill 用于流程判断，不传给脚本。

状态更新：

```json
{
  "id": "Tn",
  "status": "completed",
  "statusReason": ""
}
```

`blocked`、`failed` 和 `skipped` 必须写一句简短 `statusReason`。`pending`、`in_progress` 和 `completed` 可以清空 `statusReason`。

## 能力约束

`/do` 只负责以下能力边界内的事情：

- 读取当前 `/do` 状态快照，并基于 `inspect` 结果做静态路由、恢复判断和执行交接。
- 在首次物化时，只把 `plan.md` 交给 agent `task-materializer`，并把返回的 `objective` 和 `subtasks[]` 通过受限脚本接口写入状态。
- 在执行阶段，只推进当前 task 的 task 级执行状态；不调整 `subtasks[]` 结构，不改写 `plan.md`，也不推进 `/verify`、归档或其他后续阶段状态。
- 所有状态写入都只能通过 `scripts/run.mjs do materialize` 和 `scripts/run.mjs do update-task` 完成；agent `executor`、agent `verifier`、agent `debugger` 和外部流程都不能直接读写 `task.json`。
- 询问用户问题时优先使用 AskUserQuestion

业务代码的读取、修改和检查只发生在 `/do` 交接出去的执行方内部，不属于 `/do` 自身能力。

## 错误处理

入口状态异常在 skill 执行前已被拦截。以下为运行期可能出现的错误：

- `TASK_ALREADY_MATERIALIZED`：读取现有 `task.json` 并进入恢复状态检查。
- `TASK_STATE_NOT_FOUND`：只能在 `update-task` 时出现，先执行 materialize。
- `TASK_NOT_FOUND`：不要隐式新增 task，提示回到 `/plan` 调整。

## 完成反馈

本次 `/do` 结束时说明：

- 使用的接管方式。
- 已推进的 task id 和标题。
- 本次状态推进或执行交接结果。
- 执行方返回的结果摘要或外部检查摘要。
- 剩余 `pending` / `blocked` / `failed` task。
- 如果所有 task 都已完成或跳过，说明执行阶段 task 已完成，下一步进入 `/verify`；如果中途停止，说明停止原因和下一步处理方式。
