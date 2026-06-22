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

1. 基于 hooks 注入的 `checks[]`、`objective` 和 `projectSummary` 形成最终验收判断。
2. 如果脚本返回入口条件错误，按错误码提示下一步，不自行修改状态文件。

## 执行步骤

1. 扫描 hooks 注入的 `checks[]`，结合 `projectSummary` 判断哪些分组对当前项目类型有意义（web 应用优先浏览器验证，CLI 工具优先命令验证，library 优先测试命令），按验证逻辑从前往后自然分组（例如：静态检查 → 命令验证 → 浏览器验证），按 `reference/verification-plan.md` 的规则和格式形成全量验证计划草稿。

2. 通过 `AskUserQuestion` 向用户展示验证计划，询问是否需要补充；若缺少必要参数（如 dev server 启动命令、目标代理 URL 等），在此阶段一并与用户确认，计划定稿后再继续执行。

3. 按步骤 1 确定的分组顺序依次执行。每组完成后：
   - 若发现需要修复的 checks，立即按修复入口整理 repair subtasks，调用 `append-repairs` 脚本写入 task.json，再进入下一组。
   - 若遇到真正的环境性障碍无法继续，停止执行，直接进入步骤 4 形成 `blocked` 结论；之前各组已写入的 repair subtasks 保留在 task.json 中。
   - 若当组无问题，直接进入下一组。

4. 仅当 hooks 注入失败或 `checks[]` 字段为空时，才读取 `plan.md` 作为补充；正常注入流程下跳过，不主动读取。

5. 全部分组执行完成后，基于所有证据一次性形成判断，在 `passed`、`needs_fix`、`blocked` 中选择一个结论。

6. 调用 verify 阶段脚本执行 `complete`，通过 stdin 传入 JSON。

7. 如果脚本返回入口条件或状态错误，停止并按错误码说明下一步。

8. 向用户返回结论、简短原因、写入摘要和下一步。

## 判断依据

- `subtasks[].checks[]` 是首要验收标准；`objective` 是目标快照。判断基于进入 verify 时目标项目的代码状态；verify 执行过程中发现的代码问题应体现在结论（`needs_fix` 或 `blocked`）中，不得当场修复后以修复后状态形成 `passed` 结论。
- `plan.md` 仅在 hooks 注入失败或 `checks[]` 字段为空时作为兜底补充，正常流程不主动读取。`checks[]` 本身来源于 `plan.md`，若两者不一致说明注入环节有问题，应在 `summary` 中说明，不自动以 `plan.md` 覆盖。
- 项目文件、命令输出、review helper 输出或用户补充说明只作为本轮判断的支撑证据，不落盘。

## 结论处理

只有 `needs_fix` 会新增 repair subtask。`blocked` 表示当前无法继续执行验证，只写入阻塞结论；之前各组已通过 `append-repairs` 写入的 repair subtasks 保留，不再追加新的。

`passed`：

- 用于整个任务已经满足 `plan.md` 的目标、范围和验收口径。
- 调用脚本写入 `status: "verified"`、`stage: "verified"`、`verification.status: "passed"`。
- 下一步建议 `/archive`。

`needs_fix`：

- 用于验证未通过，但缺口可以收敛成一个或少量后续 `/do` 可执行 repair subtasks。
- Repair subtasks 已在各组验证结束时通过 `append-repairs` 写入 `subtasks[]`；`complete` 只负责将当前任务顶层状态写为 `status: "active"`、`stage: "executing"`，并写入 `verification.status: "needs_fix"` 和 `verification.summary`。
- 下一步建议 `/do`。

`blocked`：

- 仅用于真正的环境性障碍：dev server 无法启动、浏览器工具不可用、缺少必要执行参数且用户无法提供、权限或外部条件缺失。不用于"用户未确认"场景。
- 调用脚本写入 `status: "blocked"`、`stage: "verifying"`、`verification.status: "blocked"`。
- `summary` 必须说明两件事：**阻塞原因**（具体缺少什么条件）和**恢复条件**（满足什么条件后可重新运行 `/verify`）。只写"无法验证"或"缺少条件"不够，必须具体到用户可以采取行动的粒度。
- 下一步建议处理外部阻塞或用户决策。

## Repair Subtask

每组验证发现问题后，按以下约束整理 repair subtasks 并调用 `append-repairs` 写入：

- 来源必须是原 `plan.md` 的目标、范围、验收口径，或已有 `subtasks[].checks[]`。
- 不能引入新需求。
- 不能扩大任务范围。
- 以修复入口为单位生成 repair subtask：同一修复入口能覆盖的多个失败 checks 合并为一个 repair subtask，`checks[]` 列出全部受影响项；不同修复入口（涉及不同代码位置或独立根因）各自独立一个 repair subtask。不以 check 数量为上限，也不强制合并不相关问题。
- 只能 append 到 `subtasks[]` 末尾。
- 不能删除、重排、合并、拆分或改写已有 task。
- `steps[]` 和 `checks[]` 保持短，不保存完整 review 报告、命令输出、文件列表或 evidence。
- 不同组产生的 repair subtasks 可能指向同一根因，不强制跨组合并；`/do` 执行时若发现某 repair subtask 已被修复，标记为 `skipped` 即可。

repair subtask id 由脚本生成，输入不要包含 `id`、`status` 或 `statusReason`。

## 脚本输入

脚本调用统一使用 my-cc-lite runtime entry：

- 如果当前工作目录存在 `scripts/run.mjs`，使用：

```bash
node scripts/run.mjs verify <command>
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs verify <command>
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录；不要尝试调用 `/scripts/run.mjs`。

### append-repairs

每组验证发现问题后立即调用，将 repair subtasks 写入 task.json：

```bash
node scripts/run.mjs verify append-repairs
```

输入 JSON 只包含 `repairTasks`，字段约束与 Repair Subtask 章节相同：

```json
{
  "repairTasks": [
    {
      "title": "Bounded repair subtask title",
      "steps": ["Bounded repair step"],
      "checks": ["Check tied to the original plan.md acceptance criteria"]
    }
  ]
}
```

### complete

所有分组执行完成后调用，写入最终结论：

```bash
node scripts/run.mjs verify complete
```

输入 JSON 只包含 `status` 和 `summary`，不传 `repairTasks`（已由 `append-repairs` 写入）：

```json
{
  "status": "passed",
  "summary": "Short verification result summary."
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
- 如果是 `needs_fix`，列出新增 repair subtask id 和标题。
- 下一步：`/archive`、`/do`、`/plan` 或用户决策。
