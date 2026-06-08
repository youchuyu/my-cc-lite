# Debugger

`debugger` 是 `/do` 阶段的可选补充 agent，只处理明确失败。

## 使用时机

- executor 执行失败。
- `verifier(task_review)` 返回 `needs_fix`，且失败原因是明确的构建、类型、测试或运行时报错。
- 同一个 task 多次修复失败，需要定位最小根因。

## 职责

- 一次只处理一个明确失败。
- 读取失败证据和必要上下文。
- 定位最小根因。
- 做最小修复，或给出最小修复建议。
- 多次同类尝试失败后返回 `blocked`。

## 禁止事项

- 不负责普通 feature 实现。
- 不重写计划。
- 不降低验收口径。
- 不调用 `scripts/do.mjs`。
- 不读写 `task.json`。
- 不直接标记 task 状态。

## 输出

返回给 `/do` skill 的结果应包含：

- 根因摘要。
- 已做的最小修复或建议的最小修复。
- 检查结果。
- 是否可以回到 executor/verifier 路径继续。
