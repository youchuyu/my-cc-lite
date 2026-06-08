# Stage Scripts Design

本文定义 my-cc-lite 各阶段脚本的结构和调用协议。`00-core-workflow-state.md` 负责定义状态模型和阶段写入边界；本文只说明这些边界如何落到 `scripts/`。

当前项目准备完全重写，因此脚本设计不考虑兼容旧的 `.my-cc-lite/capabilities.json`、`current-task.json`、`workflow.json`、`events.jsonl` 或旧 helper 命令。

## 目标

阶段脚本只负责确定性的本地状态操作：

- 创建目录。
- 读写 JSON。
- 写入 `plan.md`。
- 定位当前任务目录。
- 校验最小状态结构。
- 使用轻量锁保护写入。
- 移动归档目录。

阶段脚本不负责：

- 替模型生成计划内容。
- 判断代码应该如何修改。
- 执行复杂任务编排。
- 记录完整事件审计。
- 维护 changed files 或命令日志。
- 替代 executor、verifier 或 companion helper 的判断。

## 目录结构

推荐结构：

```text
scripts/
  lib/
    state.mjs
    schema.mjs
    format.mjs
  run.mjs
  init.mjs
  plan.mjs
  do.mjs
  verify.mjs
  archive.mjs
  status.mjs
```

阶段入口按生命周期拆开，公共状态能力集中在 `scripts/lib/`。这样每个阶段脚本的职责清晰，同时避免路径扫描、锁、JSON 读写和校验逻辑散落到多个文件中。

`scripts/run.mjs` 是 skill 推荐使用的统一入口。它只负责从 my-cc-lite 插件根目录分发到对应阶段脚本，不理解业务状态，也不改变当前工作目录。

统一入口命令：

```text
node scripts/run.mjs init init-project
node scripts/run.mjs plan create-task
node scripts/run.mjs do materialize
node scripts/run.mjs do update-task
node scripts/run.mjs verify complete
node scripts/run.mjs archive archive
```

如果当前工作目录不是插件源码目录，skill 应先定位插件根目录，再调用 `node <pluginRoot>/scripts/run.mjs <stage> <command>`。调用时不得切换到插件根目录；`process.cwd()` 必须保持为目标项目根目录，所有 `.my-cc-lite/` 状态都从当前工作目录解析。

## 公共模块

### state.mjs

`state.mjs` 是唯一直接理解 `.my-cc-lite/` 路径模型的模块。

它负责：

- 计算 `.my-cc-lite/`、`tasks/`、`archived_tasks/`、`project.json`、`task.json` 和 `plan.md` 路径。
- 确保状态目录存在。
- 读取和写入 JSON。
- 读取和写入 `plan.md`。
- 扫描 `.my-cc-lite/tasks/` 下的当前任务目录。
- 定位当前任务目录。
- 移动当前任务目录到 `archived_tasks/`。
- 提供 `withStateLock()`。

建议接口：

```js
ensureStateRoot(projectRoot)
readProject(projectRoot)
writeProject(projectRoot, project)

listActiveTaskDirs(projectRoot)
getCurrentTaskDir(projectRoot)
createTaskDir(projectRoot, taskId)

readPlan(taskDir)
writePlan(taskDir, markdown)
readTask(taskDir)
writeTask(taskDir, task)

archiveTaskDir(projectRoot, taskId)
withStateLock(projectRoot, fn)
```

`getCurrentTaskDir(projectRoot)` 的规则固定为：

- `.my-cc-lite/tasks/` 下没有任务目录：返回 `null`。
- `.my-cc-lite/tasks/` 下只有一个任务目录：返回该目录。
- `.my-cc-lite/tasks/` 下多于一个任务目录：报错，不做隐式选择。

### schema.mjs

`schema.mjs` 负责最小结构校验，不追求完整 schema 框架。

它负责：

- 校验 `project.json` 是否具备项目级必需字段。
- 校验 `task.json` 是否具备任务级必需字段。
- 校验 `tasks[]`、`steps[]`、`checks[]` 的最小结构。
- 校验 verification 通过前的任务终态要求。
- 输出稳定错误码。

建议接口：

```js
validateProject(project)
validateTask(task)
validateTaskPatch(patch)
assertNoActiveTask(projectRoot)
assertVerifiableTask(task)
```

`assertVerifiableTask(task)` 用于校验 verify 前置任务终态：`tasks[]` 非空、所有 task 都是 `completed` 或 `skipped`、至少一个 task 是 `completed`、当前任务未归档。它不解析 `plan.md`，不支持全 `skipped` 通过。

### format.mjs

`format.mjs` 放置不涉及状态读写的小工具。

它可以负责：

- 生成 `taskId`。
- 生成当前时间字符串。
- 渲染 `plan.md` 初始模板。
- 将用户目标转换为 taskId slug。

建议接口：

```js
nowIso()
createTaskId(objective)
renderPlanMarkdown(input)
```

如果实现初期希望减少文件数量，`format.mjs` 可以先并入 `state.mjs` 或 `schema.mjs`。但不要让阶段入口脚本各自实现时间和 taskId 规则。

## 阶段入口

### init.mjs

`init.mjs` 对应 `/init`。

输入：

```json
{
  "projectSummary": "A short project summary.",
  "stageHelpers": {
    "planning": [],
    "execution": [],
    "review": []
  }
}
```

行为：

- 确保 `.my-cc-lite/` 存在。
- 创建或更新 `.my-cc-lite/project.json`。
- 首次写入 `initializedAt`。
- 每次刷新 `updatedAt`、`projectRoot`、`projectSummary` 和 `stageHelpers`。

禁止：

- 不扫描 `.my-cc-lite/tasks/`。
- 不创建 task 目录。
- 不创建或修改 `plan.md`。
- 不创建或修改 `task.json`。
- 不推进任务阶段。

### plan.mjs

`plan.mjs` 对应 `/plan`。

输入：

```json
{
  "objective": "User objective",
  "planMarkdown": "# Task: ..."
}
```

行为：

- 确认 `.my-cc-lite/tasks/` 下没有当前任务目录。
- 生成 `taskId`。
- 创建 `.my-cc-lite/tasks/<taskId>/`。
- 写入 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 输出 `taskId` 和 `plan.md` 路径。

禁止：

- 不创建 `task.json`。
- 不更新 `project.json`。
- 不把计划同步成机器任务。

### do.mjs

`do.mjs` 对应 `/do`。

详细阶段方案见 `04-do-stage-design.md`。脚本层只负责确定性状态读写，不负责理解业务代码或替模型执行任务。

建议提供两个子命令：

```text
node scripts/run.mjs do materialize
node scripts/run.mjs do update-task
```

`materialize` 输入：

```json
{
  "objective": "Objective snapshot derived from current plan.md",
  "tasks": [
    {
      "id": "T1",
      "title": "Implement the first planned task",
      "status": "pending",
      "steps": [],
      "checks": []
    }
  ]
}
```

`materialize` 行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 读取当前 `plan.md`。
- 校验 `objective` 非空、`tasks[]` 结构合法，以及 `steps[]` / `checks[]` 满足最小结构要求。
- 如果 `task.json` 不存在，根据输入创建任务级机器状态。
- 如果 `task.json` 已存在，不做写入，返回 `TASK_ALREADY_MATERIALIZED`。
- 设置顶层 `status: "active"` 和 `stage: "executing"`。
- 初始化或保留 `verification` 和 `archive`。
- 输出 `taskId`、`task.json` 路径、`plan.md` 路径和 `tasks[]` 摘要。

`update-task` 输入：

```json
{
  "id": "T1",
  "status": "completed"
}
```

`update-task` 行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 读取并校验 `task.json`。
- 更新指定 `tasks[].id` 对应 task 的 `status`。
- 刷新顶层 `updatedAt`。
- 如果所有 task 都是 `completed` 或 `skipped`，顶层仍保持 `stage: "executing"`，由 `/verify` 根据最终结论推进后续状态。

禁止：

- 不更新 `project.json`。
- 不记录 step 级状态。
- 不记录 changed files。
- 不写执行日志。
- 不自动推进 `/verify` 或 `/archive`。

### verify.mjs

`verify.mjs` 对应 `/verify`。

输入：

```json
{
  "status": "passed",
  "summary": "Verification summary."
}
```

行为：

- 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 读取 `plan.md` 和 `task.json`。
- 更新 `verification.status` 和 `verification.summary`。
- 刷新顶层 `updatedAt`。
- 写入 `passed` 时设置 `stage: "verified"` 和 `status: "verified"`。
- 写入 `needs_fix` 时设置 `stage: "executing"` 和 `status: "active"`，并 append 一个或少量 repair tasks。
- 写入 `blocked` 时设置 `stage: "verifying"` 和 `status: "blocked"`。

写入 `passed` 前必须确认：

- `tasks[]` 非空。
- 所有 `tasks[].status` 都是 `completed` 或 `skipped`。
- 至少存在一个 `completed` task。
- verifier 判断每个 task 的 `checks[]` 已通过。

禁止：

- 不更新 `project.json`。
- 不修改 `plan.md`。
- 不为每条 check 维护独立状态。
- 不把 checks 写成命令日志。

### archive.mjs

`archive.mjs` 对应 `/archive`。

输入：

```json
{
  "summary": "Archive summary."
}
```

行为：

- 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 如果存在 `task.json`，更新顶层归档字段：

```json
{
  "status": "archived",
  "stage": "archived",
  "archive": {
    "summary": "Archive summary.",
    "archivedAt": "2026-06-06T16:00:00+08:00"
  }
}
```

- 移动目录：

```text
.my-cc-lite/tasks/<taskId>/
-> .my-cc-lite/archived_tasks/<taskId>/
```

禁止：

- 不要求 `verification.status` 必须是 `passed`。
- 不更新 `project.json`。
- 不生成额外归档报告。

### status.mjs

`status.mjs` 对应 `/status`。

行为：

- 只读。
- 输出项目是否初始化。
- 输出当前任务目录数量。
- 如果存在唯一当前任务目录，输出 `plan.md` 路径、`task.json` 是否存在、当前 `stage`、`status`、`tasks[]` 摘要和 `verification` 摘要。
- 如果存在多个任务目录，输出异常。

禁止：

- 不写任何文件。
- 不修复异常状态。
- 不推进任务阶段。

## 输入输出协议

所有阶段入口统一从 `stdin` 接收 JSON。无输入的只读脚本可以接受空 stdin。

示例：

```bash
node scripts/run.mjs plan create-task < /tmp/my-cc-lite-plan-input.json
```

所有阶段入口统一向 `stdout` 输出 JSON。

成功：

```json
{
  "ok": true,
  "result": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "ACTIVE_TASK_EXISTS",
    "message": "An active my-cc-lite task already exists."
  }
}
```

错误码应该稳定，供 skills、hooks 或 agents 识别。错误文案可以面向人类说明。

## 写入边界

| 阶段 | 可写内容 | 禁止写入 |
| --- | --- | --- |
| `/init` | `.my-cc-lite/project.json` | task 目录、`plan.md`、`task.json` |
| `/plan` | `.my-cc-lite/tasks/<taskId>/plan.md` | `project.json`、`task.json` |
| `/do` | 当前任务的 `task.json` | `project.json`、归档目录 |
| `/verify` | 当前任务的 `task.json.verification` 和顶层阶段状态 | `project.json`、`plan.md` |
| `/archive` | 当前任务的 `task.json.archive`，`archived_tasks/` | `project.json` |
| `/status` | 无 | 全部 |

## 锁

所有写操作都必须通过 `withStateLock(projectRoot, fn)`。

锁文件：

```text
.my-cc-lite/state.lock
```

锁只覆盖短时间状态读写和目录移动，不覆盖模型思考、代码修改、检查命令或长时间任务执行。

`status.mjs` 默认不加写锁；如果实现需要避免读取半写入 JSON，可以使用只读重试，但不要创建新的长期锁机制。

## 错误码

建议先固定最小错误码：

```text
PROJECT_NOT_INITIALIZED
ACTIVE_TASK_EXISTS
NO_ACTIVE_TASK
MULTIPLE_ACTIVE_TASKS
PLAN_NOT_FOUND
TASK_STATE_NOT_FOUND
TASK_ALREADY_MATERIALIZED
TASK_NOT_FOUND
TASK_NOT_VERIFIABLE
ARCHIVE_TARGET_EXISTS
INVALID_INPUT
INVALID_PROJECT_STATE
INVALID_TASK_STATE
LOCK_TIMEOUT
```

错误码是脚本和 skill/agent 之间的轻量契约。新增错误码可以随着实现推进补充，但不要为每个内部异常提前设计复杂层级。

## 与 skills、agents、hooks 的关系

skills 负责阶段入口和对用户的操作指引。

agents 负责可委派的规划、执行和检查判断。

hooks 负责轻量提醒、记录和状态补充。

scripts 负责可复用的状态读写和校验逻辑。

因此：

- 阶段 skill / orchestrator 可以调用对应阶段入口脚本。
- agent 是否可以调用脚本由具体阶段设计决定；默认不直接写状态。
- hook 可以调用只读或短写入脚本。
- skill、agent 和 hook 不应复制 `.my-cc-lite/` 路径扫描、锁、JSON 写入或当前任务目录定位逻辑。

## 取舍

接受的取舍：

- 阶段入口拆开，提升可读性。
- 底层状态能力集中复用，避免规则分叉。
- 使用 stdin/stdout JSON，减少 shell 参数转义问题。
- 只做最小结构校验，不引入完整测试框架或 schema 框架。
- 不在脚本层记录完整执行日志、changed files、check 级结果或 step 级状态。

不采用的方案：

- 不把所有阶段都塞进一个巨大的 `my-cc-lite-state.mjs` 入口。
- 不让每个阶段脚本各自实现路径、锁和 JSON 读写。
- 不为尚未稳定的后续能力提前设计后台调度、事件流或复杂审计。
