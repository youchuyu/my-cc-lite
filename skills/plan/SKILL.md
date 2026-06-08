---
name: plan
description: 收敛任务方案并创建 my-cc-lite plan.md
---

# Plan

`/plan` 是 my-cc-lite 的任务计划入口。它负责把用户目标收敛成可读、可调整的 `.my-cc-lite/tasks/<taskId>/plan.md`。

`/plan` 只创建任务目录和 `plan.md`，不创建 `task.json`，不更新 `project.json`，不进入执行或验证阶段。

## 使用条件

当用户手动调用 `/plan`，或明确要求用 my-cc-lite 创建新任务计划时使用。

如果用户只是想普通讨论方案、不想创建 my-cc-lite 任务，不要调用 `scripts/run.mjs plan create-task`。

## 执行步骤

1. 确认当前工作目录就是目标项目根目录。
2. 读取 `.my-cc-lite/project.json` 中的 `projectSummary` 和 `stageHelpers.planning`，只作为计划参考。
3. 确认当前 Claude Code 可用的计划生成方式，并提供给用户选择。
4. 根据用户选择的方式收敛计划草案。
5. 根据用户目标读取必要的本地文件、文档、配置或错误输出。
6. 只在影响目标、范围、方案方向或验收口径时向用户澄清。
7. 生成最终 `planMarkdown`。
8. 在目标项目根目录中调用 plan 阶段脚本，通过 stdin 传入 JSON。
9. 根据脚本返回汇总 `taskId`、`plan.md` 路径或失败原因。

## 计划生成方式

`/plan` 开始时，应先确认当前 Claude Code 可用的计划相关能力，并整理成选项提供给用户选择。

能力确认与选择：

- 以当前 Claude Code 返回的计划相关能力为准，不维护固定清单，也不伪造不可用能力。
- 将可用能力整理成简短选项，说明名称、适合场景和结果边界，例如：

```text
当前可以用这些方式生成计划：

1. <方式名称>：<适合场景或结果边界>。
2. <方式名称>：<适合场景或结果边界>。

请选择这次使用哪种方式。
```

- 如果用户已经明确指定方式，可以直接继续，不必重复询问。
- 计划生成方式只影响本次对话协作，不写入 my-cc-lite 状态。
- 无论用户选择哪种方式，只要仍在 my-cc-lite `/plan` 流程内，最终都必须调用 plan 阶段脚本。

脚本调用统一使用 my-cc-lite runtime entry：

- 如果当前工作目录存在 `scripts/run.mjs`，使用：

```bash
node scripts/run.mjs plan create-task
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs plan create-task
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

## 状态边界

`/plan` skill 不维护状态判断逻辑。能否创建新计划、项目是否已初始化、是否已有未归档任务，以 plan 阶段脚本的返回为准。

如果脚本返回错误，按错误码给出简短处理建议：

- `PROJECT_NOT_INITIALIZED`：提示先执行 `/init`。
- `ACTIVE_TASK_EXISTS`：提示当前已有未归档任务，先处理当前任务后再创建新计划。
- 其他错误：引用脚本返回的 `error.message`，不要自行推断或修复状态文件。

## planning helpers

`project.json.stageHelpers.planning` 只作为提示层参考。

可以根据 helper 描述建议或调用辅助能力，例如代码上下文分析、架构判断或风险识别。helper 输出只能作为计划证据或参考，不能替代用户确认关键业务取舍，也不能进入执行阶段。

如果 helper 不可用，退回普通本地上下文分析，不让 `/plan` 因 helper 缺失而失败。

## 需求澄清

优先自己获取本地事实：

- 读取相关文件、文档、配置和错误输出。
- 检查已有实现、相邻模块和项目约定。
- 必要时使用 `stageHelpers.planning` 中的 planning helper 收集上下文。

只向用户确认会影响以下内容的问题：

- 用户目标或优先级。
- 范围取舍。
- 方案偏好。
- 兼容性、风险或成本取舍。
- 验收口径。

不要要求用户解释可以从仓库中查到的事实，不要一次性列出大量和当前决策无关的问题。

## plan.md 内容

`plan.md` 是人类可读计划，不作为状态机依据。建议结构：

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
   - Do: <主要动作方向>
   - Check: <阶段完成判断>
```

写作要求：

- 目标、范围、核心方案和验收口径必须清楚。
- 计划应可读、可调整、可供后续阶段参考。
- `Plan` 的编号项优先表达主要执行阶段或关键决策面，不默认按文件、组件、命令或局部检查项拆分。
- 文件、命令和技术细节可以写入 `plan.md`，但应服务于解释方案边界、风险或验收口径；执行时自然会完成的局部动作留到 `/do` 阶段处理。
- `Plan` 的主要编号项不建议过多。通常小到中等任务超过 8 项时，应先自检是否把文件、组件、命令、检查项或连续实现细节提前拆成了独立工作项。
- 超过 8 项不是错误；如果这些编号项分别对应明确的功能面、阶段边界、用户取舍或独立验收口径，可以保留。否则应合并为更高层的主要阶段，并把细节放进对应阶段说明或 `Notes`。
- 当计划开始呈现为长 TODO 列表时，应优先合并为更高层的阶段，并把必要细节压缩到说明或 `Notes` 中。
- 不写执行状态。
- 不写 `task.json` 形状。
- 不写 JSON 或 hidden metadata。
- 不把未确认的业务取舍写成确定结论。

## 脚本输入

调用脚本时传入：

```json
{
  "objective": "User objective",
  "planMarkdown": "# Task: ..."
}
```

`planMarkdown` 必须至少包含：

```text
## Objective
## Plan
```

## 禁止事项

`/plan` 不做以下事情：

- 不修改业务代码。
- 不创建或修改 `task.json`。
- 不修改 `project.json`。
- 不把计划同步成机器任务。
- 不调用 executor、verifier 或执行型 companion helper。
- 不维护审批状态、事件日志、changed files、命令日志或计划版本历史。
- 不手工创建、移动、修复或归档 `.my-cc-lite/tasks/` 下的状态文件。

## 完成反馈

成功后向用户说明：

- 新建的 `taskId`。
- `plan.md` 路径。
- 用户可以手动调整 `plan.md`。
- 下一步可以基于 `plan.md` 继续后续阶段。
