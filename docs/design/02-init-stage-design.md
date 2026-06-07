# Init Stage Design

本设计定义 my-cc-lite `/init` 阶段的技术方案。当前项目准备完全重写，因此本方案不考虑兼容旧的 `.my-cc-lite/capabilities.json`、`current-task.json`、`workflow.json` 或 `init-capabilities` 命令。

## 目标

`/init` 是项目级初始化和项目摘要刷新入口。

它只负责写入目标项目中的：

```text
.my-cc-lite/project.json
```

`/init` 不创建任务，不创建计划，不切换任务，不归档任务，也不推进 `plan`、`do`、`verify` 或 `archive` 阶段。

`/init` 可以重复执行。重复执行时刷新项目摘要和外部 companion helper 清单，但不读取或修改当前任务状态。

## 职责边界

`/init` 负责：

- 确保 `.my-cc-lite/` 目录存在。
- 创建或更新 `.my-cc-lite/project.json`。
- 写入轻量项目摘要 `projectSummary`。
- 记录后续阶段可直接使用或委派的外部 companion helper。

`/init` 不负责：

- 创建 `.my-cc-lite/tasks/<taskId>/`。
- 创建或修改 `plan.md`。
- 创建或修改 `task.json`。
- 运行项目检查命令。
- 记录事件日志。
- 记录完整能力清单。
- 扫描或登记 Claude Code 宿主基础能力。
- 管理 Claude Code `Plan` / `Explore` 等协作模式。
- 注册 my-cc-lite 自身能力。

## 术语边界

### Claude Code 宿主基础能力

Claude Code 宿主基础能力，指 Claude Code 默认提供的通用对话、读写、编辑、搜索、工具调用、任务委派和规划协作能力。

这些能力是 my-cc-lite 默认可以依赖的运行环境，不写入 `project.json`，也不作为 `stageHelpers` 管理。

例如：

- `Bash`
- `Read`
- `Write`
- `Edit`
- `WebSearch`
- `WebFetch`
- `TodoWrite`
- `Task`
- `general-purpose`
- Claude Code 原生 `Plan` / `Explore` 模式

### 外部 companion helper

外部 companion helper，指通过 Claude Code 当前上下文可见、但不属于 Claude Code 宿主基础能力，也不属于 my-cc-lite 自身能力的专项 skill、agent 或 tool。

例如：

- 外部 MCP tool，例如 `mcp__codegraph.codegraph_context`。
- 外部 plugin skill，例如 `code-review`。
- 专项 agent，例如 `security-reviewer`。
- 其他框架提供的明确可调用入口，例如 `Workflow`。

判断一个能力能否写入 `stageHelpers`，不看它是否“通过 Claude Code 可用”，而看它是否是外部 companion helper。

## project.json

`project.json` 是 `/init` 维护的项目级初始化状态源。

推荐结构：

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

### initializedAt

首次 `/init` 时写入。

后续重复 `/init` 时保留旧值，不刷新。

### updatedAt

每次 `/init` 都刷新。

### projectRoot

写入当前目标项目根目录的绝对路径。

helper 必须以 Claude Code 当前工作目录作为目标项目根目录，不以插件安装目录作为项目根目录。

## 与任务状态的关系

`project.json` 不保存当前任务指针，也不保存任何任务生命周期信息。

当前任务由 `.my-cc-lite/tasks/` 下的未归档任务目录表示。MVP 只允许一个未归档任务目录，因此后续阶段可以通过扫描任务目录定位 current task。

`/init` 不扫描 `.my-cc-lite/tasks/`，不判断当前是否有 active task，也不修复任务目录异常。

任务生命周期由后续阶段独立维护：

- `/plan` 创建 `.my-cc-lite/tasks/<taskId>/plan.md`。
- `/do` 创建或更新 `.my-cc-lite/tasks/<taskId>/task.json`。
- `/verify` 更新 `.my-cc-lite/tasks/<taskId>/task.json` 中的验证结果。
- `/archive` 将 `.my-cc-lite/tasks/<taskId>/` 移动到 `.my-cc-lite/archived_tasks/<taskId>/`。

这些阶段都不更新 `project.json`。

## projectSummary

`projectSummary` 是模型基于当前项目上下文写入的一句简短摘要。

它给后续 `/plan`、`/do` 和 `/verify` 提供轻量方向感，但不作为机器决策契约。

```ts
type ProjectSummary = string;
```

建议保持一到两句话，描述项目的主要形态和 my-cc-lite 后续阶段需要知道的最基本背景。

示例：

```json
{
  "projectSummary": "A Claude Code plugin project for lightweight task workflow state."
}
```

`projectSummary` 不应包含：

- 完整技术栈清单。
- 推断出来但没有必要长期缓存的细节。
- 检查命令。
- 任务目标。
- 当前任务进度。

不同语言、框架和构建系统的具体判断由后续阶段按任务需要实时读取项目文件并推断，不在 `/init` 阶段固化。

## stageHelpers

`stageHelpers` 记录 my-cc-lite 后续阶段可直接使用或委派的外部 companion helper。

它不是完整能力清单，不是 Claude Code 宿主能力清单，不是插件清单，也不记录协作模式。

```ts
type StageHelpers = {
  planning: StageHelper[];
  execution: StageHelper[];
  review: StageHelper[];
};

type StageHelper = {
  name: string;
  type: "skill" | "agent" | "tool";
  invoke: string;
  description: string;
};
```

字段含义：

- `name`：helper 的展示名或稳定名称。
- `type`：helper 类型，只允许 `skill`、`agent` 或 `tool`。
- `invoke`：对应阶段提示词中可以直接引用的调用标识。
- `description`：一句话说明该 helper 在对应阶段能帮 my-cc-lite 做什么。

### invoke

`invoke` 不是 shell 命令，也不是执行参数。

它只描述实际调用入口。

示例：

```json
{
  "name": "codegraph_context",
  "type": "tool",
  "invoke": "mcp__codegraph.codegraph_context",
  "description": "Collect code context before /plan drafts implementation tasks"
}
```

当展示名和调用入口一致时，`name` 和 `invoke` 可以相同。

### description

`description` 描述阶段用途，不描述 helper 的泛化能力。

推荐：

```json
{
  "name": "code-review",
  "type": "skill",
  "invoke": "code-review",
  "description": "Review completed code changes before /verify marks the task passed"
}
```

不推荐：

```json
{
  "name": "code-review",
  "type": "skill",
  "invoke": "code-review",
  "description": "A powerful code review skill that can inspect repositories and provide high quality feedback"
}
```

### 纳入规则

写入 `stageHelpers` 的 helper 必须同时满足：

- 当前上下文明确可见。
- 以 skill、agent 或 tool 形式存在。
- 目标阶段可以直接调用或委派。
- 对目标阶段有明确帮助。
- 属于外部 companion helper。

不满足条件时省略。空数组是有效结果。

必须排除：

- Claude Code 宿主基础能力，例如 `Bash`、`Read`、`Write`、`Edit`、`WebSearch`、`WebFetch`、`TodoWrite`、`Task`。
- Claude Code 原生 agent 或通用委派能力，例如 `general-purpose`。
- Claude Code 原生协作模式，例如 `Plan`、`Explore`。
- my-cc-lite 自身能力，例如 `init`、`plan`、`do`、`verify`、`status`、`planner`、`executor`、`verifier`。
- 配置、后台循环、权限管理、HUD、status-line、transcript 清理和 setup 类能力。
- 仅提供泛化研究、资讯检索或背景阅读的能力，除非它以目标阶段可直接调用的 skill、agent 或 tool 形式出现，并能产出 `/plan` 可使用的规划证据。

可以纳入：

- 通过 Claude Code 暴露的外部 MCP tool。
- 当前上下文可见的外部 plugin skill。
- 当前上下文可见的专项 agent。
- 其他框架提供的、可被目标阶段直接调用或委派的明确入口。

### 阶段路由

`planning` 面向 `/plan`：

- 规划辅助。
- 架构判断。
- 风险识别。
- 可执行任务拆解前的上下文分析。

`execution` 面向 `/do`：

- 领域特定执行 helper。
- 外部自动化 helper。
- 可委派的实现型 agent。

`review` 面向 `/verify`：

- code review。
- security review。
- bug finding。
- verification evidence。
- 变更后诊断。

同一个 helper 只有在它对多个阶段都有直接用途时，才可以出现在多个阶段中。

## 与协作模式的关系

`/init` 不检查、推荐或切换 Claude Code 原生 `Plan` / `Explore` 等协作模式。

协作模式判断属于 `/plan` skill 的提示流程。它只影响本次对话协作方式，不写入 `project.json`，也不由状态 helper 自动发现或管理。

如果用户选择先使用 Claude Code 原生 `Plan` 模式，my-cc-lite 暂不创建任务目录和 `plan.md`。等方案收敛并获得用户确认进入 my-cc-lite 任务生命周期后，再由 `/plan` 创建 `.my-cc-lite/tasks/<taskId>/plan.md`。

## helper 命令

重写后的 helper 提供：

```bash
node "$MY_CC_LITE_HELPER" init-project
```

stdin 输入：

```json
{
  "projectSummary": "A Claude Code plugin project for lightweight task workflow state.",
  "stageHelpers": {
    "planning": [],
    "execution": [],
    "review": []
  }
}
```

输出写入后的 `project.json`。

### helper 写入规则

helper 必须：

- 从当前工作目录解析目标项目根目录。
- 使用 `.my-cc-lite/state.lock` 保护短时间 JSON 写入。
- 使用临时文件和 rename 原子写入 `project.json`。
- 在校验失败时不修改已有 `project.json`。
- 重复初始化时保留已有 `initializedAt`。
- 每次初始化时刷新 `updatedAt`。
- 每次初始化时刷新 `projectSummary` 和 `stageHelpers`。

helper 不应：

- 读取 Claude Code transcript。
- 读取历史 trace 或日志。
- 创建 task 目录。
- 执行项目检查命令。
- 推断或修复当前任务状态。

## skill 执行流程

`skills/init/SKILL.md` 应指导 Claude Code 执行：

1. 确认目标项目是当前工作目录。
2. 读取少量能帮助理解项目形态的文件，例如 README、package manifest 或当前目录结构。
3. 写出一句简短 `projectSummary`。
4. 审查当前可见的外部 companion skills、agents 和 callable tools，不审查 Claude Code 宿主基础能力或协作模式。
5. 按纳入规则构建 `stageHelpers`。
6. 调用 `node "$MY_CC_LITE_HELPER" init-project`，通过 stdin 传入 JSON。
7. 汇总初始化结果。
8. 提示下一步可以执行 `/plan`。

## 校验规则

helper 应校验：

- stdin 必须是 JSON object。
- `projectSummary` 必须是非空字符串。
- `stageHelpers.planning`、`execution`、`review` 必须是数组。
- 每个 helper 必须包含 `name`、`type`、`invoke`、`description`。
- `type` 只允许 `skill`、`agent`、`tool`。
- `description` 必须是非空字符串。
- 过滤 my-cc-lite 自身能力。
- 过滤已知 Claude Code 宿主基础能力 denylist。

helper 只做结构校验和已知 denylist 过滤；是否属于当前可见的外部 companion helper，主要由 `/init` skill 在对话上下文中判断。

过滤后的阶段 helper 可以为空。

## 测试要求

重写后的 `/init` 至少覆盖：

- 首次运行会创建 `.my-cc-lite/project.json`。
- 重复运行会保留 `initializedAt`。
- 重复运行会刷新 `updatedAt`。
- 重复运行会刷新 `projectSummary`。
- 重复运行会刷新 `stageHelpers`。
- malformed stdin 不会破坏已有 `project.json`。
- 已知 Claude Code 宿主基础能力 denylist 会被过滤。
- Claude Code 原生 `Plan` / `Explore` 等协作模式不会写入 `stageHelpers`。
- 通过 Claude Code 暴露的外部 helper 在符合规则时可以保留。
- my-cc-lite 自身能力会被过滤。
- `/init` 不会创建 `.my-cc-lite/tasks/<taskId>/`。

## 后续扩展

MVP 不加入以下字段：

- `source`
- `confidence`
- `provider`
- `tags`
- `conditions`
- `lastUsedAt`
- `usageCount`
- helper 参数 schema

只有当 `/plan`、`/do` 或 `/verify` 真正需要基于来源、置信度或条件做路由时，再扩展 `StageHelper`。

## 核心取舍

本方案刻意把 `/init` 做窄：

- 它是项目级摘要刷新，不是任务生命周期阶段。
- 它记录外部 companion helper，不记录宿主基础能力或协作模式。
- 它不运行命令，只生成可读、可恢复的本地状态。

这样 `/plan` 才是进入任务生命周期的第一个阶段，`/init` 可以安全重复执行。
