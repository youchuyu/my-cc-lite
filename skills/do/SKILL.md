---
name: do
description: 执行下一个待处理的 my-cc-lite 计划项
argument-hint: "[item id]"
---

# my-cc-lite /do

使用此 skill 通过有范围的工作项执行当前计划。

在保持目标项目为当前工作目录的同时，从已安装插件根目录使用 helper：

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

## 步骤

1. 读取 `.my-cc-lite/current-task.json`，然后读取该任务的 `workflow.json` 和 `plan.md`。
2. 如果不存在当前任务，推荐 `/plan "<task>"`。`/do` 不得创建任务目录。
3. 选择用户请求的 item id，或第一个 `pending` 条目。
4. 将其标记为进行中：

```bash
node "$MY_CC_LITE_HELPER" set-work-item T1 in_progress
```

5. 只实现该条目，并使用本地代码库已有模式。
6. 记录已变更文件。hooks 通常会执行此操作；如果没有，运行：

```bash
node "$MY_CC_LITE_HELPER" add-changed-file path/to/file
```

7. 运行相关检查。
8. 使用证据将条目标记为 `completed`，或用明确 blocker 标记为 `blocked`：

```bash
node "$MY_CC_LITE_HELPER" set-work-item T1 completed "check command or file evidence"
```

9. 如果所有必需条目都进入终态，推荐 `/verify`。

## 输出

- 已完成条目摘要
- 已变更文件
- 已运行检查
- blocker，如有
- 推荐下一条命令
