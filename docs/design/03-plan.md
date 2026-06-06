# plan module design

`/plan` 是任务创建阶段，也是唯一能创建 task 的入口。

## 目标

- 把用户目标转成可执行、可检查的任务计划。
- 创建 `.my-cc-lite/tasks/<taskId>/`。
- 写入 `plan.md`。
- 更新 `.my-cc-lite/project.json.currentTaskId`。

## 输入

- 用户任务描述。
- `.my-cc-lite/project.json`。
- 必要时只读探索项目文件。

## 输出

```text
.my-cc-lite/project.json
.my-cc-lite/tasks/<taskId>/plan.md
```

## 计划内容

`plan.md` 建议包含：

```text
# Task

## Objective

## Acceptance Criteria

## Work Items

## Verification

## Risks / Unknowns

## Next
```

## work item 表达

```json
{
  "id": "T1",
  "title": "实现目标功能",
  "status": "pending",
  "required": true,
  "checks": [],
  "evidence": []
}
```

id 使用 `T1`、`T2`、`T3`，保持稳定。  
标题应描述结果，不写过细的执行步骤。  
检查命令可以为空，后续 `/do` 或 `/verify` 再补充。

这里的 work item 只是 `plan.md` 中的人类可读计划表达，不在 `/plan` 阶段写入 `task.json`。执行阶段由 `/do` 根据最新 `plan.md` 创建或更新 `task.json`。

## 阶段状态

创建任务后，任务处于计划阶段：

```json
{
  "stage": "planned",
  "status": "active"
}
```

不建议 `/plan` 直接进入 executing，除非用户明确要求计划后立即执行。

`/plan` 不创建 `task.json`，上述状态由 current task 指针和 `plan.md` 存在共同表达；机器执行状态在 `/do` 阶段创建。

## 当前任务规则

- 每次 `/plan` 创建一个新 task。
- `/plan` 是唯一 task 创建入口。
- MVP 只允许一个 current task。
- 如果 `project.json.currentTaskId` 不为 `null`，`/plan` 阻止创建新 task。
- 创建成功后更新 `project.json.currentTaskId` 指向新 task。
- 当前任务必须通过 `/archive` 释放后，才能创建新的 current task。

## helper 操作

建议 helper 提供：

```text
plan-start "<objective>"
```

## 输出给用户

```text
Task: 20260606-153012-add-feature
Created plan.
Next: /do
```

## 待确认

- 是否需要支持 `/plan --from-current-diff`。
- work item 是否需要 owner 字段。
