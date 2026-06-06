---
name: plan
description: 创建由 my-cc-lite 任务状态支撑的计划
argument-hint: "<task description>"
---

# my-cc-lite /plan

使用此 skill 初始化任务，生成 `.my-cc-lite/tasks/<taskId>/plan.md`，并填充 `.my-cc-lite/tasks/<taskId>/workflow.json`。

在保持目标项目为当前工作目录的同时，从已安装插件根目录使用 helper：

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

如果 `CLAUDE_PLUGIN_ROOT` 不可用，使用已安装插件目录的绝对路径。

## 步骤

1. 只有在需要发现信息时才探索代码库。
2. 创建简洁的验收标准和有序工作项，id 使用 `T1`、`T2`、...
3. 从目标项目运行 `node "$MY_CC_LITE_HELPER" plan-start "<task>"`。每次 `/plan` 调用都会创建新任务，并更新 `.my-cc-lite/current-task.json`。
4. 写入 `.my-cc-lite/tasks/<taskId>/plan.md`，内容包括任务、验收标准、工作项、验证步骤和风险。
5. 更新该任务的 `workflow.json`，使 plan 阶段完成，并让 `workItems` 与计划一致：

```bash
node "$MY_CC_LITE_HELPER" set-work-items '[{"id":"T1","title":"Create plugin manifest","status":"pending","owner":"executor","evidence":[]}]'
```

6. `set-work-items` helper 会自动向任务本地 `events.jsonl` 追加 `plan.updated`。

## 状态结构

每个条目应类似：

```json
{
  "id": "T1",
  "title": "Create plugin manifest",
  "status": "pending",
  "owner": "executor",
  "evidence": []
}
```

## 输出

- 简短计划摘要
- 当前 task id 和阶段
- 推荐下一条命令：`/do`
