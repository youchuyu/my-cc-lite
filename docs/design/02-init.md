# init module design

`/init` 是项目级初始化阶段。它只负责建立项目能力上下文，不创建任务，不推进工作流。

## 目标

- 识别当前项目的基本能力。
- 记录当前阶段可直接使用的 companion 能力。
- 重写 `.my-cc-lite/project.json` 中的项目画像和 capabilities。
- 保留已有 `currentTaskId`。

## 输入

- 当前目标项目根目录。
- 当前可见的 skills、agents、tools。
- 项目本地文件，例如 `package.json`、`AGENTS.md`、README。

## 输出

```text
.my-cc-lite/project.json
```

## 能力收集范围

只保留能被 my-cc-lite 阶段直接使用的能力：

- `planning`：能帮助 `/plan` 规划、拆解、评估风险。
- `execution`：能帮助 `/do` 执行具体工作或调用项目工作流。
- `review`：能帮助 `/verify` 检查、审查、诊断。

每个阶段下只保留：

```text
skills
agents
tools
```

## 排除项

默认排除：

- Claude Code 原生文件读写、shell、web、任务列表等基础工具。
- my-cc-lite 自身 skills 和 agents。
- hooks、commands、plugin container、配置项。
- 后台任务、HUD、status line、权限管理。
- 纯研究能力，除非它直接为 planning 提供证据。

## 运行规则

- `/init` 每次执行都会覆盖 `project.json` 中的项目级字段和 capabilities。
- 如果已有 `currentTaskId`，保留当前指针；如果没有已有项目状态，则写为 `null`。
- `/init` 不得创建 `.my-cc-lite/tasks/` 下的新任务。
- `/init` 不得创建、修改、切换或归档 task。

## helper 操作

建议 helper 提供：

```text
init-project
init-capabilities
```

`init-project` 负责项目基础信息。  
`init-capabilities` 负责规范化能力清单，并写入 `project.json.capabilities`。

## 输出给用户

输出应简洁：

```text
Initialized my-cc-lite project context.
Planning capabilities: 1
Execution capabilities: 2
Review capabilities: 1
Next: /plan "<task>"
```

## 待确认

- 初始化是否需要记录 package scripts 的完整列表，还是只记录推荐检查命令。
- 初始化失败时是否允许保留部分文件。
