---
name: init
description: 初始化或刷新 my-cc-lite 项目级状态
disable-model-invocation: true
---

# Init

`/init` 是 my-cc-lite 的项目级初始化入口。它只负责刷新目标项目中的 `.my-cc-lite/project.json`，不创建任务、不写计划、不推进执行或验证阶段。

## 使用条件

当用户手动调用 `/init`，或明确要求初始化、刷新 my-cc-lite 项目状态时使用。

## 执行步骤

1. 确认当前工作目录就是目标项目根目录。
2. 读取少量项目线索，例如 `README`、package manifest、顶层目录或已有设计文档。
3. 写出一到两句 `projectSummary`，只描述项目基本形态和后续阶段需要知道的轻量背景。
4. 审查当前上下文可见的外部 companion helper。
5. 排除 Claude Code 宿主基础能力、Claude Code 原生协作模式和 my-cc-lite 自身能力。
6. 构造 `stageHelpers.planning`、`stageHelpers.execution` 和 `stageHelpers.review`。
7. 调用 my-cc-lite runtime entry 的 `init init-project`，通过 stdin 传入 JSON。
8. 汇总 `.my-cc-lite/project.json` 路径、项目摘要和各阶段 helper 数量。
9. 提示下一步可以进入 `/plan`。

## 输入格式

脚本调用统一使用 my-cc-lite runtime entry：

- 如果当前工作目录存在 `scripts/run.mjs`，使用：

```bash
node scripts/run.mjs init init-project
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs init init-project
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

调用脚本时传入：

```json
{
  "projectSummary": "A short project summary.",
  "stageHelpers": {
    "planning": [],
    "execution": [],
    "review": []
  }
}
```

没有明确外部 companion helper 时，三个数组可以全部为空。

## helper 纳入规则

只纳入同时满足以下条件的 helper：

- 当前上下文明确定义或可见。
- 以 skill、agent 或 tool 形式存在。
- 属于外部 companion helper，不是 Claude Code 宿主基础能力。
- 不属于 my-cc-lite 自身能力。
- 对目标阶段有直接帮助。

阶段路由：

- `planning`：供 `/plan` 使用，例如代码上下文分析、架构判断、风险识别。
- `execution`：供 `/do` 使用，例如领域专项执行 helper 或可委派实现 agent。
- `review`：供 `/verify` 使用，例如 code review、security review、bug finding 或验证诊断。

每个 helper 使用扁平结构：

```json
{
  "name": "codegraph_context",
  "type": "tool",
  "invoke": "mcp__codegraph.codegraph_context",
  "description": "Collect code context before /plan drafts implementation tasks"
}
```

`description` 描述 helper 在对应阶段怎样帮助 my-cc-lite，不描述泛化能力。

## 必须排除

不要写入：

- Claude Code 宿主基础能力，例如 `Bash`、`Read`、`Write`、`Edit`、`WebSearch`、`WebFetch`、`TodoWrite`、`Task`。
- Claude Code 原生协作模式，例如 `Plan`、`Explore`。
- Claude Code 原生通用 agent，例如 `general-purpose`。
- my-cc-lite 自身能力，例如 `init`、`plan`、`do`、`verify`、`status`、`archive`、`planner`、`executor`、`verifier`。
- 配置、后台循环、权限管理、HUD、status-line、transcript 清理和 setup 类能力。

## 禁止事项

`/init` 不做以下事情：

- 不创建 `.my-cc-lite/tasks/`。
- 不创建或修改 `plan.md`。
- 不创建或修改 `task.json`。
- 不运行项目检查命令。
- 不记录事件日志。
- 不记录完整能力清单。
- 不扫描 Claude Code transcript。
- 不管理 Claude Code `Plan` / `Explore` 等协作模式。

## 调用示例

```bash
node scripts/run.mjs init init-project <<'JSON'
{
  "projectSummary": "A Claude Code plugin project for lightweight local task workflow state.",
  "stageHelpers": {
    "planning": [],
    "execution": [],
    "review": []
  }
}
JSON
```
