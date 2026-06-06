# hooks agents scripts design

本模块定义 my-cc-lite 内部 skills 之外的支撑组件边界。

## skills

skills 是用户可见的阶段入口。

建议保留：

```text
init
plan
do
verify
archive
status
```

skills 的职责：

- 说明阶段目标。
- 指导 Claude Code 读取哪些状态文件。
- 调用 helper 更新状态。
- 输出下一步建议。

skills 不应承担复杂 JSON 修复、状态校验和并发保护。

## scripts

scripts 是状态契约的实际执行层。

建议结构：

```text
scripts/
  state.mjs
  lock.mjs
  schema.mjs
  stages/
    init.mjs
    plan.mjs
    do.mjs
    verify.mjs
    archive.mjs
    status.mjs
```

核心职责：

- 读写 `.my-cc-lite/`。
- 校验 workflow 状态。
- 执行状态转换。
- 追加 events、checks、evidence。
- 使用锁避免并发写损坏。
- 给 skills 和 hooks 提供统一 CLI。

强约束必须在 scripts 中实现，例如：

- `/plan` 才能创建 task。
- verification 不能在 pending item 存在时 passed。
- archive 默认要求 verification passed。

## hooks

hooks 只做轻量记录和提醒。

建议保留：

```text
UserPromptSubmit
PostToolUse
PreCompact
Stop
```

### UserPromptSubmit

用于提醒当前处于哪个阶段，必要时提示下一步。  
不创建任务，不修改 workflow 核心状态。

### PostToolUse

用于记录变更文件或检查命令结果。  
只追加轻量事件，不做复杂判断。

### PreCompact

用于生成当前任务的简短恢复提示。  
不改变任务状态。

### Stop

用于提醒未完成 item、未验证任务或未归档任务。  
默认 soft reminder，不阻断用户。

## agents

agents 是可委派角色，不是后台 worker。

建议保留：

```text
explorer
planner
executor
verifier
archiver
```

### explorer

只读探索项目，输出相关文件、模式、检查命令和风险。

### planner

把用户目标和探索事实转成计划、验收标准和 work items。

### executor

执行单个 work item，并记录 item 级检查证据。

### verifier

做任务级验证，检查 evidence 和 acceptance criteria。

### archiver

生成归档摘要，确保任务关闭信息清晰。

## commands

commands 是否保留是包装层选择，不影响核心契约。

如果 Claude Code 当前版本能稳定直接调用 plugin skills，可以去掉 commands。  
如果 namespaced command 体验更稳定，则保留 commands 作为 thin dispatcher。

## 待确认

- commands 是否继续保留。
- Stop hook 是纯提醒，还是允许特定场景 soft block。
- PostToolUse 是否只记录编辑类工具，还是也记录检查命令。
