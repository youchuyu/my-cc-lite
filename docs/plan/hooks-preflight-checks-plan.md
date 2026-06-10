# hooks 前置检查方案

## 背景

当前 my-cc-lite 的核心状态检查主要在 `scripts/` 中完成：

- `scripts/lib/state.mjs` 负责定位 `.my-cc-lite/`、读取 `project.json`、扫描当前 task 目录、读取 `plan.md` 和 `task.json`。
- `scripts/lib/schema.mjs` 负责校验 `project.json`、`task.json`、阶段输入和可验证/可归档条件。
- `/do`、`/verify`、`/archive` 的阶段脚本在真正写状态前再次执行硬校验。

hooks 适合补充轻量的、只读的、提前暴露状态问题的检查，避免模型在明显错误的阶段继续推理。但 hooks 不应该成为新的状态写入入口，也不应该替代阶段脚本的硬校验。

## 原则

- hooks 只做只读检查和提示，不写 `.my-cc-lite/` 状态。
- hooks 可以提前发现阶段入口条件不满足，但最终硬失败仍由阶段脚本返回稳定错误码。
- hooks 不重新解释 `plan.md`，不拆解任务，不判断实现是否完成。
- hooks 不调用 `materialize`、`update-task`、`verify complete` 或 `archive archive`。
- hooks 输出应是短提示或 `additionalContext`，帮助当前阶段少跑偏。
- hooks 的检查逻辑应复用或贴近 `scripts/lib/state.mjs` / `scripts/lib/schema.mjs` 的现有语义，避免形成第二套状态解释。

## 可以放到 hooks 的检查

| 检查项 | 适用阶段 | hook 行为 | 脚本仍需硬校验 |
| --- | --- | --- | --- |
| `.my-cc-lite/project.json` 是否存在 | `/plan` `/do` `/verify` `/archive` | 提示先执行 `/init` | 是 |
| `project.json` 是否为合法 JSON | `/plan` `/do` `/verify` `/archive` | 提示状态文件异常，需要手动检查 | 是 |
| `project.json` 是否符合当前 schema | `/plan` `/do` `/verify` `/archive` | 提示项目状态异常，不继续阶段推理 | 是 |
| `.my-cc-lite/tasks/` 下是否没有 active task | `/do` `/verify` `/archive` | 提示先执行 `/plan` | 是 |
| `.my-cc-lite/tasks/` 下是否有多个 active task | `/plan` `/do` `/verify` `/archive` | 提示当前状态异常，需要人工处理 | 是 |
| `/plan` 前是否已有 active task | `/plan` | 提示继续 `/do`、`/verify` 或 `/archive`，不要创建新计划 | 是 |
| 当前 task 是否缺少 `plan.md` | `/do` `/verify` `/archive` | 提示回到 `/plan` 或手动修复状态 | 是 |
| 当前 `plan.md` 是否为空 | `/do` `/verify` `/archive` | 提示 `plan.md` 无效，停止阶段推理 | 是 |
| `/do` 前是否已有 `task.json` | `/do` | 提示进入恢复检查，不要重新物化 | 是 |
| `/do` 前是否缺少 `task.json` | `/do` | 提示进入首次物化流程 | 是 |
| `task.json` 是否为合法 JSON | `/do` `/verify` `/archive` | 提示任务状态异常，需要人工检查 | 是 |
| `task.json` 是否符合当前 schema | `/do` `/verify` `/archive` | 提示任务状态异常，不继续阶段推理 | 是 |
| `/verify` 前是否缺少 `task.json` | `/verify` | 提示先执行 `/do` 物化任务 | 是 |
| `/verify` 前是否存在 `pending` / `in_progress` / `blocked` / `failed` task | `/verify` | 提示回到 `/do` 继续、修复或处理阻塞 | 是 |
| `/verify` 前是否所有 task 都是 `skipped` | `/verify` | 提示回到 `/plan` 重新确认任务是否成立 | 是 |
| `/archive` 前是否缺少 `task.json` | `/archive` | 提示先执行 `/do`，或确认是否要手动修复状态 | 是 |
| `/archive` 前 `task.json.taskId` 与目录名是否不一致 | `/archive` | 提示状态异常，不建议继续归档 | 是 |
| `/archive` 前 `archived_tasks/<taskId>/` 是否已存在 | `/archive` | 提示目标归档目录已存在，需要人工检查 | 是 |
| `/archive` 前 `verification.status` 是否不是 `passed` | `/archive` | 提示归档只表示关闭任务，不代表完成；必要时等待用户确认 | 否，属于对话语义 |

## 不建议放到 hooks 的检查

| 检查项 | 原因 | 应放位置 |
| --- | --- | --- |
| 从 `plan.md` 重新拆解 `tasks[]` | 会绕过 `/do` 的首次物化边界 | `task-materializer` |
| `plan.md` 和已有 `task.json.tasks[]` 是否需要同步 | 当前设计不自动同步已有 `task.json` | `/plan` 或用户决策 |
| 当前 task 是否已经真正实现完成 | 需要读业务代码或运行检查，不是入口静态状态 | executor / verifier |
| `plan.md` 和 `task.json.objective` 是否语义一致 | 属于最终验收判断，不是 hook 静态检查 | `/verify` |
| 是否应该选择外部高阶接管 | 这是首次物化后的流程选择 | `/do` skill |
| 是否应该自动继续执行下一个 task | 涉及用户意图和执行链路 | `/do` skill |
| 是否应该 append repair task | 属于最终验证结论 | `/verify` |
| 是否应该强制阻断归档未通过任务 | 当前 `/archive` 允许用户明确关闭未完成任务 | `/archive` 对话层 |
| 运行测试、lint、构建或项目命令 | hooks 不应引入慢操作或业务副作用 | executor / verifier |
| 写入 `task.json`、移动归档目录、创建 task 目录 | hooks 不做状态写入 | 阶段脚本 |

## 建议 hook 类型

### 1. stage-preflight hook

用途：在用户输入包含 `/plan`、`/do`、`/verify`、`/archive` 或明确阶段意图时，读取当前 my-cc-lite 状态并追加短上下文。

建议挂载在用户输入阶段，例如当前已有的 `UserPromptExpansion` 类入口。它只返回提示，不写状态。

建议输出示例：

```text
my-cc-lite preflight: current task already has task.json; /do should enter recovery check and must not rematerialize.
```

```text
my-cc-lite preflight: /verify is not ready because task T2 is pending; return to /do before final verification.
```

```text
my-cc-lite preflight: verification.status is not passed; /archive would close the task but would not mean the task is complete.
```

### 2. agent-chain hook

用途：保留当前 `SubagentStop` 上的 executor / verifier / debugger 链路提醒。

当前 `scripts/hooks/do-agent-chain.mjs` 的定位是合理的：它根据 agent 输出提醒 `/do` 下一步应该进入 verifier、debugger 或 `update-task`，但不直接写 `task.json`。

这类 hook 不应该承担 `project.json`、`plan.md`、`task.json` 的通用入口检查。

### 3. state-write guard hook

暂不建议实现。

如果后续 Claude Code hook 能稳定识别具体工具命令，可以考虑只做提醒：当模型准备直接编辑 `.my-cc-lite/tasks/*/task.json` 或绕过 `scripts/run.mjs` 调用阶段脚本时，提示应使用受限脚本接口。

当前阶段先不做强阻断，避免引入 hook 与脚本之间的双重控制。

## 最小实现方案

### 1. 新增只读 preflight 脚本

新增：

```text
scripts/hooks/stage-preflight.mjs
```

职责：

- 从 hook stdin 读取用户输入文本。
- 粗略识别目标阶段：`init`、`plan`、`do`、`verify`、`archive`。
- 读取当前工作目录下的 `.my-cc-lite/` 状态。
- 生成阶段相关的短提示。
- 始终返回 `continue: true`。

不做：

- 不写任何状态文件。
- 不调用阶段脚本。
- 不读取业务代码。
- 不运行项目命令。

### 2. 抽出轻量状态读取 helper

优先复用 `scripts/lib/state.mjs` 和 `scripts/lib/schema.mjs`。

如果 hook 输入环境无法直接使用阶段脚本当前封装，可以新增一个只读 helper，例如：

```text
scripts/lib/preflight.mjs
```

它只返回状态摘要：

```json
{
  "project": {
    "exists": true,
    "valid": true
  },
  "activeTasks": {
    "count": 1,
    "taskId": "..."
  },
  "plan": {
    "exists": true,
    "empty": false
  },
  "task": {
    "exists": true,
    "valid": true,
    "status": "active",
    "stage": "executing",
    "verificationStatus": "not_started",
    "unfinishedTasks": ["T2"]
  }
}
```

这个 helper 只能被 hook 和只读命令使用，不参与写状态。

### 3. 配置 hooks

在 `hooks/hooks.json` 中将当前测试性质的 `UserPromptExpansion` 命令替换为正式 preflight：

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/stage-preflight.mjs\"",
  "timeout": 5
}
```

保留现有 `SubagentStop` 的 `do-agent-chain.mjs`。

### 4. 增加最小 smoke

只在 `test/smoke.mjs` 中补少量 hook 输入样例：

- 未初始化时调用 `/do`，返回提示先 `/init`。
- 已有 `plan.md` 但无 `task.json` 时调用 `/do`，返回首次物化提示。
- 有未完成 task 时调用 `/verify`，返回回 `/do` 提示。
- `verification.status !== "passed"` 时调用 `/archive`，返回归档语义提示。

不新增完整测试框架。

## 阶段提示建议

### `/plan`

优先检查：

- `project.json` 是否存在且合法。
- active task 是否已经存在。
- 是否存在多个 active task。

提示口径：

- 未初始化：先 `/init`。
- 已有 active task：先 `/status`、`/do`、`/verify` 或 `/archive`，不要直接创建新计划。
- 多 active task：状态异常，人工处理。

### `/do`

优先检查：

- `project.json` 是否存在且合法。
- 是否刚好一个 active task。
- `plan.md` 是否存在且非空。
- `task.json` 是否存在且合法。

提示口径：

- 无 `task.json`：进入首次物化。
- 有 `task.json`：进入恢复检查，不重新物化，不重新选择外部接管方式。
- 所有 task 已完成或跳过：提示进入 `/verify`。

### `/verify`

优先检查：

- `project.json` 是否存在且合法。
- 是否刚好一个 active task。
- `plan.md` 是否存在且非空。
- `task.json` 是否存在且合法。
- `tasks[]` 是否全部 `completed` 或 `skipped`。
- 是否至少一个 task 为 `completed`。

提示口径：

- 缺少 `task.json`：先 `/do`。
- 仍有未完成 task：回 `/do`。
- 全部 skipped：回 `/plan` 重新确认任务是否成立。

### `/archive`

优先检查：

- `project.json` 是否存在且合法。
- 是否刚好一个 active task。
- `plan.md` 是否存在且非空。
- `task.json` 是否存在且合法。
- `task.json.taskId` 是否等于当前目录名。
- 目标 `archived_tasks/<taskId>/` 是否不存在。
- `verification.status` 当前值。

提示口径：

- 缺少 `task.json`：先 `/do`。
- 归档目标已存在：人工检查。
- 未验证通过：说明归档只代表关闭任务，不代表完成。

## 推荐结论

可以把 `project.json`、active task、`plan.md`、`task.json` 的静态入口检查放到 hooks 中提前提示，但只能作为软前置。

真正的硬校验继续保留在阶段脚本中：

- `/plan` 继续由 `assertInitializedProject` 和 `assertNoActiveTask` 兜底。
- `/do` 继续从 `inspect` 开始。
- `/verify` 继续由 `assertVerifiableTask` 兜底。
- `/archive` 继续由 `assertArchivableTask`、`taskId` 目录一致性和归档目标存在性检查兜底。

这样 hooks 可以减少模型误入错误阶段，但不会改变当前“scripts 负责确定性状态读写和校验”的主边界。
