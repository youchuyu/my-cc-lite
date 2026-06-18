# CLAUDE.md

没有明确说明，在实现过程中不要参考 @docs下的内容，文档很可能会过期。

## 基础理解

- my-cc-lite 是 Claude Code 插件，为目标项目提供本地任务状态管理和五阶段工作流编排（init → plan → do → verify → archive）。
- 状态存储在目标项目的 `.my-cc-lite/` 目录，文件格式为人类可读的 JSON 和 Markdown。

## 脚本命令

插件脚本统一入口：

```bash
node scripts/run.mjs <stage> <action> [< input.json]
```

## 架构概览

五个阶段技能（`skills/*/SKILL.md`）是入口，状态通过 Node.js 脚本（`scripts/`）读写：

- `/init` — 分析项目、写 `.my-cc-lite/project.json`
- `/plan` — 生成 `.my-cc-lite/tasks/<taskId>/plan.md`
- `/do` — 调用 `task-materializer` agent 生成 `task.json`，再走 executor → verifier 链
- `/verify` — 对比 plan.md 目标与执行结果，返回 passed / needs_fix / blocked
- `/archive` — 将任务目录移至 `.my-cc-lite/archived_tasks/`

四个内部 agent（`agents/*.md`）：`task-materializer`、`executor`、`verifier`、`debugger`，均不自行写状态，由对应阶段脚本持久化。

`scripts/lib/` 中的公共库：`schema.mjs`（数据结构）、`state.mjs`（文件读写）、`preflight.mjs`（前置检查）。

## 设计思路

- 最小路径优先：只保留跑通核心流程所需的能力，不引入并行分支或可选模式，复杂能力后续作为扩展补充。
- 按需固化，状态本地可读：每个阶段只沉淀当前已确定的信息，状态文件保持人类可读、可手动接管。
- 以提示和记录为主：避免过早引入强制阻断、后台常驻或复杂自动化；小问题优先小修正，不轻易增加新层级。

## Hooks

三个 hook 脚本在 `scripts/hooks/`，注册在 `scripts/hooks/hooks.json`：

- `stage-preflight.mjs`（`UserPromptExpansion`）：对阶段 slash command 做只读结构性检查，不通过则 `decision: "block"` 硬阻断，是三个 hook 里唯一会阻断的。
- `stage-context.mjs`（`UserPromptExpansion`）：preflight 放行后追加阶段上下文（task 快照、execution skills 等）到 prompt。
- `do-agent-chain.mjs`（`SubagentStop`）：解析 executor / verifier / debugger / task-materializer 最后消息的 key:value 字段，注入下一步提示。

核心约束：hooks 只读，不写 `.my-cc-lite/` 状态；各阶段前置检查优先在 `stage-preflight.mjs` 中实现，阶段脚本的硬校验只作兜底。

## 验证约定

- 默认不新增验证代码或测试文件；仅在涉及核心流程、关键状态读写、插件加载入口或明确回归风险时补充验证。
- 验证以手工检查、一次性 smoke 或最小临时脚本为主，不建立完整测试框架，也不追求覆盖率。
- 需要落盘的测试文件、smoke 样例、fixture 和临时产物统一放在 `./test/` 下，不混入正式目录；`./test/` 暂不视为正式实现的一部分。


# 语言

回答使用中文
