---
name: status
description: 显示 my-cc-lite 任务状态、进度、blocker 和下一步操作
---

# my-cc-lite /status

使用此 skill 检查或恢复当前工作流。

在保持目标项目为当前工作目录的同时，从已安装插件根目录使用 helper：

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

## 步骤

1. 运行：

```bash
node "$MY_CC_LITE_HELPER" status
```

2. 如果状态缺失，推荐 `/plan "<task>"`。
3. 如果 workflow 状态格式错误，报告准确文件和 JSON 错误。
4. 如果存在 blockers，在推荐继续执行之前先指出它们。
5. 如果存在已变更文件且验证尚未通过，推荐 `/verify`。

## 输出

```text
Task: ...
Stage: do
Progress: 2/4 items complete
Active: T3 Add stop hook
Verification: not started
Next: finish T3, then /verify
```
