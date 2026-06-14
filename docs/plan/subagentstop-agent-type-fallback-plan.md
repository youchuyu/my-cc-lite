# SubagentStop `agent_type` 空值处理方案

## 背景

当前 `my-cc-lite` 的 `/do` agent 链路提醒挂在 `SubagentStop` hook 上：

- 声明位置：[hooks/hooks.json](/Users/youchuyu/Desktop/ai/my-cc-lite/hooks/hooks.json)
- 处理脚本：[scripts/hooks/do-agent-chain.mjs](/Users/youchuyu/Desktop/ai/my-cc-lite/scripts/hooks/do-agent-chain.mjs)

原设计假设 `SubagentStop` 会稳定提供 `agent_type`，并且 hook matcher 也会按该字段精确过滤：

- `executor`
- `verifier`
- `debugger`

但当前真实日志已经证明，这个假设在现环境下不成立。`SubagentStop` 触发时，stdin payload 里可能出现：

```json
{
  "hook_event_name": "SubagentStop",
  "agent_type": ""
}
```

这意味着：

1. hook 事件会触发。
2. 但脚本无法从 payload 中恢复 agent 身份。
3. 继续依赖 `agent_type` 做链路判断时，行为会变得不可靠。

## 问题判断

当前问题不应理解为“`do-agent-chain.mjs` 把无关 agent 识别成了相关 agent”，而应理解为：

- `SubagentStop` 上游输入在当前环境下并不稳定。
- `agent_type` 为空时，hook 层已经失去“精确识别当前 subagent”的基础条件。
- 这时继续把 `SubagentStop` 当成可靠的 `/do` 链路控制入口，风险高于收益。

因此，当前修改目标不应是“继续强化 matcher”，而应是：

- 先止血，避免无效或误导性的 hook 注入。
- 再把 `/do` 的关键状态推进约束收回到更稳定的位置。

## 修改目标

本次方案只解决一个核心问题：

- 当 `SubagentStop.agent_type` 不可靠时，不再让 `do-agent-chain.mjs` 继续承担 `/do` 状态推进的关键提醒职责。

不在本次范围内的事情：

- 不重做整个 `/do` 流程。
- 不引入新的后台状态机。
- 不新增复杂 agent 注册层。
- 不尝试依赖解析完整 transcript 来恢复 agent 身份后再继续自动链路。

## 方案结论

采用两阶段方案：

### 阶段一：先止血，关闭不可靠注入

目标：保证 `SubagentStop` 即使继续触发，也不会再基于空 `agent_type` 注入误导性 `additionalContext`。

修改建议：

1. 保留 `SubagentStop` hook 声明，不立即删除。
2. 调整 `scripts/hooks/do-agent-chain.mjs`：
   - 如果 `eventName !== "SubagentStop"`，继续静默返回。
   - 如果 `agent_type` 为空，直接静默返回，只记录日志。
   - 只有 `agent_type` 明确属于 `executor | verifier | debugger` 时，才尝试生成链路提示。
3. 日志中补充空值原因，便于后续排查，例如：
   - `agent:`
   - `agentTypeMissing: true`
4. 如果 `agent_type` 存在但 `last_assistant_message` 不是约定格式，也只静默返回，不再尝试“猜测”状态。

这一阶段的目标不是恢复功能，而是避免错误信号。

### 阶段二：把关键约束移出 `SubagentStop`

目标：让 `/do` 的核心状态推进规则，不依赖一个当前已证明不稳定的 hook 输入字段。

建议把关键约束收回到 `/do` skill 主流程本身，至少保留这些硬规则：

1. `executor` 返回 `completed` 后，`/do` 不得直接写 `tasks[].status = completed`。
2. 必须显式进入 `verifier(task_review)`。
3. 只有 `verifier(task_review)` 返回 `passed`，`/do` 才允许调用 `scripts/run.mjs do update-task` 写入 `completed`。
4. `executor failed`、`verifier needs_fix`、`debugger fixed` 这些路由规则，应由 `/do` skill 文本流程直接约束，而不是主要依赖 `SubagentStop additionalContext`。

换句话说：

- hook 可以是提醒层。
- 但真正不能丢的执行约束，必须写在 `/do` 自己的流程契约里，并由调用者显式遵守。

当前仓库其实已经在 `skills/do/SKILL.md` 里表达了这类规则；后续需要做的是减少对 hook 补充提醒的依赖，而不是继续把 hook 当主链路。

## 具体修改建议

### 1. `scripts/hooks/do-agent-chain.mjs`

建议改动：

- 增加 `hasRecognizedAgentType(agentType)` 判定。
- `agentType === ""` 时直接返回 `silentContinue()`。
- 日志增加布尔字段，例如 `agentTypeMissing`。
- `buildAgentSignal()` 保持白名单分支，不增加任何基于 message 内容的反推逻辑。

不建议做的事情：

- 不从 `last_assistant_message` 里猜当前 agent 是谁。
- 不把“自然语言里提到了 verify / debugger”当成 agent 识别依据。
- 不依赖 `agent_transcript_path` 做正式主链路解析。

原因很直接：这些都比现在更脆弱，也更复杂。

### 2. `hooks/hooks.json`

短期建议：

- 暂时不改 matcher。
- 保留现有三条精确 matcher，哪怕上游当前不稳定，也不要把 matcher 放宽成 `.*`。

原因：

- 放宽 matcher 只会扩大无关触发面。
- 当前真实问题不是“没匹配到”，而是“上游给进来的 `agent_type` 本身可能为空”。

如果后续确认当前 Claude Code 版本下 `SubagentStop` matcher 本身对空 `agent_type` 也会放行，再考虑是否直接移除这一组 hook 声明。但这是第二步，不是当前最小改动。

### 3. `/do` 主流程文档

建议补一条明确设计说明，位置可选：

- `skills/do/SKILL.md`
- 或 `docs/plan/do-flow-control-rewrite-plan.md`

建议增加的结论：

- `SubagentStop` 只作为 best-effort 的补充提醒。
- `/do` 的状态推进不能依赖它。
- 如果 hook 没返回任何链路提醒，`/do` 仍必须按既定 executor -> verifier(task_review) -> update-task 规则执行。

## 推荐实施顺序

1. 先改 `scripts/hooks/do-agent-chain.mjs`，让空 `agent_type` 只记日志不注入上下文。
2. 跑最小 smoke，覆盖：
   - `agent_type: ""`
   - `agent_type: "executor"`
   - `agent_type: "verifier"`
   - `agent_type: "debugger"`
3. 再补 `/do` 文档说明，明确 hook 是补充层，不是主控制层。
4. 最后再决定是否保留当前 `SubagentStop` hook 声明。

## 验证建议

按项目当前约定，使用最小验证即可。

建议验证项：

1. 向 `scripts/hooks/do-agent-chain.mjs` 传入：
   - `hook_event_name: "SubagentStop"`
   - `agent_type: ""`
   - 确认输出为 `continue: true` + `suppressOutput: true`
   - 确认不产生 `additionalContext`
2. 传入合法 `executor` payload：
   - `result: completed`
   - 确认会产生 verifier 提示
3. 传入合法 `verifier` payload：
   - `mode: task_review`
   - `result: passed`
   - 确认会产生允许 update-task 的提示
4. 真实运行一轮 `/do` 时，确认无关 subagent 不再产生误导性 hook 提示。

## 预期结果

改完后，系统行为应变成：

- 无法识别 agent 时：hook 静默，不注入错误上下文。
- 能识别 `executor` / `verifier` / `debugger` 时：继续提供轻量提醒。
- `/do` 的关键执行约束仍由 skill 主流程承担，不因 hook 缺失而失真。

## 不建议的替代方案

### 方案 A：把 matcher 放宽后再在脚本里硬猜

不建议。

原因：

- 会扩大触发范围。
- 会把“无关 subagent”更多地送进来。
- 最后仍然只能靠脆弱文本猜测做判断。

### 方案 B：从 `agent_transcript_path` 解析 transcript 恢复 agent 身份

当前不建议作为主方案。

原因：

- 复杂度明显升高。
- transcript 结构未在当前 repo 中形成稳定契约。
- 会把一个轻量 hook 变成重解析逻辑。

只有在后续确认 `SubagentStop` 必须保留且上游长期不给 `agent_type` 时，才值得单独评估。

### 方案 C：删除整个 `SubagentStop` 链路

短期也不建议直接做。

原因：

- 当前还能保留一部分“识别到时的补充提醒”价值。
- 直接删除会让已有 `/do` 提示体验立刻退化。
- 先止血再决定是否移除，更符合最小改动原则。
