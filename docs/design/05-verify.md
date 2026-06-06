# verify module design

`/verify` 是任务级总检查阶段。它判断当前任务是否满足计划中的验收标准。

## 目标

- 检查 required work items 是否全部进入终态。
- 对照验收标准评估证据是否充分。
- 对照最新 `plan.md` 判断执行记录是否覆盖计划目标。
- 运行最终验证命令。
- 将 verification 标记为 passed 或 failed。

## 输入

- `.my-cc-lite/project.json`。
- 当前任务的 `plan.md`。
- 当前任务的 `task.json`。

## 前置条件

以下状态不能通过验证：

- required item 仍为 `pending`
- required item 仍为 `in_progress`
- required item 仍为 `checking`
- required item 为 `failed`
- required item 为 `blocked`

helper 必须强制这个规则，不能只依赖 skill 文本。

## 验证流程

```text
read current task
-> inspect latest plan.md and task.json
-> ensure required items are complete/skipped/not_applicable
-> run final checks
-> collect evidence
-> set verification passed / failed
```

## 验证状态

```text
not_started
in_progress
passed
failed
```

`passed` 表示任务满足验收标准。`/archive` 可以关闭任意当前任务，但只有 `verification.status` 为 `passed` 的归档任务表示已验证完成。  
`failed` 表示需要回到 `/do` 修复或补充证据。

## 证据要求

验证依据可以来自：

- 最新 `plan.md`。
- `task.json` 中的 item 状态。
- `/verify` 最终检查命令。
- companion review 工具或 agent 的明确结论。
- 人工说明，但应标记 source。

验证结论不应只写“看起来没问题”。需要包含命令、文件、检查点或具体结论。

## helper 操作

建议 helper 提供：

```text
set-verification <passed|failed>
verification-preflight
```

`verification-preflight` 用于提前返回阻止通过的 item 列表。

## 输出给用户

通过：

```text
Verification passed.
Evidence:
- npm run check passed
Next: /archive
```

失败：

```text
Verification failed.
Missing:
- T2 has no passing check evidence
Next: /do T2
```

## 待确认

- skipped item 是否需要用户显式确认。
- 是否允许没有命令检查、只用人工证据通过。
- verification failed 后是否自动把 stage 改回 executing。
