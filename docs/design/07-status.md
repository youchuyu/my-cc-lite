# status module design

`/status` 是只读恢复入口，用于查看当前任务进度、blocker、验证状态和下一步。

## 目标

- 显示 my-cc-lite 是否已初始化。
- 显示当前 task。
- 显示 work item 进度。
- 显示 blocker、failed item 和验证状态。
- 推荐下一条命令。

## 输入

- `.my-cc-lite/project.json`。
- 当前任务的 `plan.md`。
- 当前任务的 `task.json`，如果尚未执行则可以不存在。

## 输出示例

```text
Project: initialized
Task: 20260606-153012-add-feature
Stage: executing
Progress: 2/4 completed
Active: T3
Failed: none
Blocked: none
Verification: not_started
Next: /do
```

没有初始化：

```text
Project: not initialized
Next: /init
```

没有当前任务：

```text
Project: initialized
Task: none
Next: /plan "<task>"
```

有失败项：

```text
Task: 20260606-153012-add-feature
Stage: executing
Failed:
- T2 npm run check failed
Next: /do --retry T2
```

## 规则

- `/status` 不修改任何任务状态。
- 如果 JSON 损坏，输出具体文件和错误位置。
- 如果 current task 指向不存在的目录，提示恢复选项。
- 如果验证已通过但未归档，推荐 `/archive`。

## helper 操作

建议 helper 提供：

```text
status
status-json
doctor-state
```

`status` 给人读。  
`status-json` 给 skill 或 hook 使用。  
`doctor-state` 可选，用于诊断损坏状态，但不自动修复。

## 待确认

- `/status` 是否需要展示最近 events。
- 是否需要支持 `/status --json`。
- 状态损坏时是否允许 helper 自动生成修复建议文件。
