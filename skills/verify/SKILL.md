---
name: verify
description: 验收当前 my-cc-lite 任务并写入 task.json 最终验证结论
disable-model-invocation: true
---

# Verify

`/verify` 是 my-cc-lite 的任务级验收阶段。它判断当前 active task 是否满足 `plan.md` 的目标、范围和验收口径，并通过 my-cc-lite runtime entry 把最终结论写回当前任务目录下的 `task.json`。

`/verify` 不执行修复，不改写 `plan.md`，不改写已有 task、step 或 check，不更新 `project.json`，不自动归档任务。

## 使用条件

当用户手动调用 `/verify`，或明确要求验收当前 my-cc-lite 任务时使用。

当前工作目录应是目标项目根目录。显式 `/verify` 的静态入口条件由 preflight hook 提前阻断。

## 进入条件

进入 skill 后只做两件事：

1. 基于脚本可读取的当前 `plan.md` 和 `task.json` 形成最终验收判断。
2. 如果脚本返回入口条件错误，按错误码提示下一步，不自行修改状态文件。

## 执行步骤

1. 上下文已注入 `objective`、`verification.status`（上一轮）、`subtasks[]`（含 `checks[]`）和可用的 review helpers。扫描所有 `checks[]`，对可从代码或配置静态推断的 checks 立即执行静态检查，结果暂存为当前上下文中的证据，不写 `task.json`，不修改目标项目代码。
   - 若所有 checks 均已静态覆盖 → 直接进入 **步骤 3**。
   - 若存在以下任一情况 → 进入 **步骤 2**：checks 涉及运行时行为（UI 渲染、交互、命令输出、网络请求）、checks 表述模糊无法静态判断、上一轮 `verification.status` 是 `needs_fix`。

2. 针对静态无法覆盖的 checks（涉及运行时行为、表述模糊、或上一轮 `verification.status` 是 `needs_fix`），按 `reference/verification-plan.md` 制定验证计划并向用户展示，使用 `AskUserQuestion` 询问是否执行（若缺少必要参数如 dev server 启动命令或目标 URL，一并在此说明）；确认后按组依次执行。

3. 仅当 `checks[]` 出现歧义或明显不完整时，才读取 `plan.md` 作为仲裁来源；否则跳过。

4. 在所有已规划分组的验证执行完成之前，不形成最终结论。所有验证完成后，基于全量证据一次性形成判断，在 `passed`、`needs_fix`、`blocked` 中选择一个结论。

5. 调用 verify 阶段脚本执行 `complete`，通过 stdin 传入 JSON。

6. 如果脚本返回入口条件或状态错误，停止并按错误码说明下一步。

7. 向用户返回结论、简短原因、写入摘要和下一步。

## 判断依据

- `subtasks[].checks[]` 是首要验收标准；`objective` 是目标快照。判断基于进入 verify 时目标项目的代码状态；verify 执行过程中发现的代码问题应体现在结论（`needs_fix` 或 `blocked`）中，不得当场修复后以修复后状态形成 `passed` 结论。
- `plan.md` 是兜底仲裁来源，仅在 `checks[]` 出现歧义或明显不完整时使用。
- `checks[]` 与 `plan.md` 不一致时，以 `plan.md` 为准；但这表明 `/do` 阶段的 `checks[]` 质量有问题，应在 `summary` 中说明。
- 项目文件、命令输出、review helper 输出或用户补充说明只作为本轮判断的支撑证据，不落盘。

## 结论处理

只有 `needs_fix` 会新增 repair task。`blocked` 表示当前无法在原计划范围内形成明确 repair task，因此只写入阻塞结论，不追加 `subtasks[]`。

`passed`：

- 用于整个任务已经满足 `plan.md` 的目标、范围和验收口径。
- 调用脚本写入 `status: "verified"`、`stage: "verified"`、`verification.status: "passed"`。
- 下一步建议 `/archive`。

`needs_fix`：

- 用于验证未通过，但缺口可以收敛成一个或少量后续 `/do` 可执行 repair tasks。
- 调用脚本把 repair tasks append 到 `subtasks[]` 末尾；同时将当前任务的顶层状态写为 `status: "active"`、`stage: "executing"`，并写入 `verification.status: "needs_fix"` 和 `verification.summary`。
- 下一步建议 `/do`。

`blocked`：

- 仅用于真正的环境性障碍：dev server 无法启动、浏览器工具不可用、缺少必要执行参数且用户无法提供、权限或外部条件缺失。不用于"用户未确认"场景。
- 调用脚本写入 `status: "blocked"`、`stage: "verifying"`、`verification.status: "blocked"`。
- `summary` 必须说明两件事：**阻塞原因**（具体缺少什么条件）和**恢复条件**（满足什么条件后可重新运行 `/verify`）。只写"无法验证"或"缺少条件"不够，必须具体到用户可以采取行动的粒度。
- 下一步建议处理外部阻塞或用户决策。

## Repair Task

`needs_fix` 的 repair task 必须满足：

- 来源必须是原 `plan.md` 的目标、范围、验收口径，或已有 `subtasks[].checks[]`。
- 不能引入新需求。
- 不能扩大任务范围。
- 以修复入口为单位生成 repair task：同一修复入口能覆盖的多个失败 checks 合并为一个 repair task，`checks[]` 列出全部受影响项；不同修复入口（涉及不同代码位置或独立根因）各自独立一个 repair task。不以 check 数量为上限，也不强制合并不相关问题。
- 只能 append 到 `subtasks[]` 末尾。
- 不能删除、重排、合并、拆分或改写已有 task。
- `steps[]` 和 `checks[]` 保持短，不保存完整 review 报告、命令输出、文件列表或 evidence。

repair task id 由脚本生成，输入不要包含 `id`、`status` 或 `statusReason`。

## 脚本输入

脚本调用统一使用 my-cc-lite runtime entry：

- 如果当前工作目录存在 `scripts/run.mjs`，使用：

```bash
node scripts/run.mjs verify complete
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs verify complete
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

脚本输入 JSON：

- `status` 必须是 `passed`、`needs_fix` 或 `blocked`。
- `summary` 必须是简短验证结论摘要。
- 只有 `status: "needs_fix"` 时允许传入 `repairTasks`，且必须是非空数组。
- `passed` 和 `blocked` 不传 `repairTasks`。
- `repairTasks[]` 只包含 `title`、`steps` 和 `checks`，不要包含 `id`、`status` 或 `statusReason`。

最小示例：

```json
{
  "status": "passed",
  "summary": "Short verification result summary."
}
```

需要修复时：

```json
{
  "status": "needs_fix",
  "summary": "Short summary of the verification gap.",
  "repairTasks": [
    {
      "title": "Bounded repair task title",
      "steps": ["Bounded repair step"],
      "checks": ["Check tied to the original plan.md acceptance criteria"]
    }
  ]
}
```

## 禁止事项

- 不直接手写 `task.json`。
- 不修改 `.my-cc-lite/project.json`。
- 不修改 `plan.md`。
- 不修改已有 `subtasks[]`、`steps[]` 或 `checks[]`。
- 不保存完整 review 报告、命令日志、changed files、事件日志或证据文件。
- 不自动调用 `/do` 修复。
- 不自动调用 `/archive` 归档。
- 不让 review helper 直接调用阶段脚本或写入状态。

## 错误处理

入口状态异常在 skill 执行前已被拦截。以下为运行期可能出现的错误：

- `INVALID_INPUT`：修正传给 verify 脚本的 JSON 输入。

## 完成反馈

本次 `/verify` 结束时说明：

- 结论：`passed` / `needs_fix` / `blocked`。
- 简短原因。
- 写入的 `verification.summary`。
- 如果是 `needs_fix`，列出新增 repair task id 和标题。
- 下一步：`/archive`、`/do`、`/plan` 或用户决策。
