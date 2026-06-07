# Init Stage Implementation Plan

本文基于 `docs/design/02-init-stage-design.md`，并对齐 `docs/design/00-core-workflow-state.md` 与 `docs/design/01-stage-scripts.md`，给出 `/init` 阶段的落地执行方案。

## 目标结论

`/init` 只落地项目级初始化，不进入任务生命周期。

MVP 完成后，用户手动调用 `/init` 时，my-cc-lite 应在目标项目根目录写入或刷新：

```text
.my-cc-lite/project.json
```

它必须做到：

- 首次执行时创建 `.my-cc-lite/` 和 `project.json`。
- 重复执行时保留 `initializedAt`。
- 每次执行时刷新 `updatedAt`、`projectRoot`、`projectSummary` 和 `stageHelpers`。
- 过滤 Claude Code 宿主基础能力、Claude Code 原生协作模式、my-cc-lite 自身能力。
- 不扫描、创建、修复或修改 `.my-cc-lite/tasks/`。
- 不写 `plan.md`、`task.json`、事件日志、完整能力清单或命令日志。

## 实施顺序

建议按三个小步落地：

1. 先实现确定性的脚本能力：`scripts/lib/*` 与 `scripts/init.mjs`。
2. 再更新 `skills/init/SKILL.md`，让 skill 按新协议生成输入并调用脚本。
3. 最后补一个最小 smoke，验证首次初始化、重复初始化、过滤规则和不触碰任务目录。

这样可以先把本地状态写入边界跑通，再处理 Claude Code 提示流程。

## 文件落点

推荐新增：

```text
scripts/
  lib/
    state.mjs
    schema.mjs
    format.mjs
  init.mjs
```

推荐更新：

```text
skills/init/SKILL.md
test/smoke.mjs
```

暂不恢复旧的巨大状态入口，不新增 `capabilities.json`，不新增 `current-task.json`、`workflow.json` 或 `events.jsonl`。

## 脚本协议

`scripts/init.mjs` 是 `/init` 阶段入口。

为同时对齐两份设计文档，MVP 建议让它支持以下调用：

```bash
node scripts/init.mjs init-project
```

`init-project` 是唯一子命令。后续如果需要统一 helper 入口，可以再增加包装脚本；当前不要为了还不存在的阶段提前做命令路由。

stdin 输入：

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

stdout 成功输出：

```json
{
  "ok": true,
  "result": {
    "project": {
      "initializedAt": "2026-06-06T15:30:12+08:00",
      "updatedAt": "2026-06-06T15:40:00+08:00",
      "projectRoot": "/path/to/project",
      "projectSummary": "A short project summary.",
      "stageHelpers": {
        "planning": [],
        "execution": [],
        "review": []
      }
    },
    "projectPath": "/path/to/project/.my-cc-lite/project.json"
  }
}
```

stdout 失败输出：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "projectSummary must be a non-empty string."
  }
}
```

脚本失败时退出码使用 `1`，成功时使用 `0`。所有错误都保持 JSON 输出，方便 skill 汇总。

## state.mjs 落地

`scripts/lib/state.mjs` 只负责路径、目录、锁和 JSON 原子写入。

本阶段需要先实现这些接口：

```js
statePaths(projectRoot)
ensureStateRoot(projectRoot)
readProject(projectRoot)
writeProject(projectRoot, project)
withStateLock(projectRoot, fn)
```

### statePaths

根据 `process.cwd()` 解析目标项目根目录，不从插件安装目录解析。

返回：

```js
{
  projectRoot,
  stateRoot,
  projectPath,
  lockPath
}
```

其中：

```text
stateRoot = <projectRoot>/.my-cc-lite
projectPath = <projectRoot>/.my-cc-lite/project.json
lockPath = <projectRoot>/.my-cc-lite/state.lock
```

本阶段可以只计算 `project.json` 相关路径，不需要暴露 `tasks/` 路径接口，避免 `/init` 实现误用任务状态。

### ensureStateRoot

只创建 `.my-cc-lite/`。

不要创建：

```text
.my-cc-lite/tasks/
.my-cc-lite/archived_tasks/
```

`tasks/` 和 `archived_tasks/` 留给后续阶段按需创建。

### readProject

行为：

- `project.json` 不存在时返回 `null`。
- 存在时解析 JSON。
- JSON 解析失败时抛出 `INVALID_PROJECT_STATE`。

`/init` 只读取旧 `project.json` 用于保留 `initializedAt`，不得据此读取或推断任务状态。

### writeProject

必须使用临时文件加 rename：

```text
project.json.tmp-<pid>-<timestamp>
-> project.json
```

写入前先对待写对象做 `validateProject()`。校验失败时不修改旧文件。

写入格式使用两个空格缩进，并以换行结尾，便于手工查看和 diff。

### withStateLock

所有 `/init` 写操作包在 `withStateLock(projectRoot, fn)` 内。

锁文件是：

```text
.my-cc-lite/state.lock
```

锁只覆盖读取旧 `project.json`、生成新对象、写入新 `project.json` 这一小段。

推荐实现：

- 用独占创建锁文件。
- 锁内容写入 `pid`、`createdAt` 和 `operation: "init-project"`。
- 短轮询等待，超时返回 `LOCK_TIMEOUT`。
- `finally` 删除锁文件。

不要让锁覆盖模型分析、项目文件阅读或 helper 清单整理。

## schema.mjs 落地

`scripts/lib/schema.mjs` 负责输入和项目状态的最小结构校验。

本阶段需要实现：

```js
normalizeInitInput(input)
validateProject(project)
filterStageHelpers(stageHelpers)
```

### normalizeInitInput

要求：

- stdin 必须是 JSON object。
- `projectSummary` 必须是非空字符串。
- `stageHelpers` 必须是 object。
- `stageHelpers.planning`、`stageHelpers.execution`、`stageHelpers.review` 必须是数组；缺失时可以规范化为空数组。
- 不接受 `stageHelpers` 以外的完整能力清单字段，例如 `providers`、`inventory`、`capabilities`。

建议允许 `stageHelpers` 缺失并补为空结构：

```json
{
  "planning": [],
  "execution": [],
  "review": []
}
```

这样 `/init` 在没有任何外部 companion helper 时仍能正常初始化。

### filterStageHelpers

过滤逻辑放在脚本层，但脚本只做确定性过滤。

每个 helper 必须满足：

```ts
{
  name: string;
  type: "skill" | "agent" | "tool";
  invoke: string;
  description: string;
}
```

`type` 只能是：

```text
skill
agent
tool
```

必须过滤的 denylist：

```text
Bash
Read
Write
Edit
WebSearch
WebFetch
TodoWrite
Task
general-purpose
Plan
Explore
init
plan
do
verify
status
archive
planner
executor
verifier
my-cc-lite:init
my-cc-lite:plan
my-cc-lite:do
my-cc-lite:verify
my-cc-lite:status
my-cc-lite:archive
```

过滤时同时检查 `name` 和 `invoke`。

同一阶段内按 `type + invoke` 去重，保留第一次出现的条目。不要跨阶段去重，因为同一个 helper 可能确实服务多个阶段。

脚本不判断“当前上下文是否真的可见”，这个判断由 `skills/init/SKILL.md` 引导 Claude Code 完成。脚本只负责兜底排除已知不应写入的条目。

### validateProject

写入前确认最终对象满足：

- `initializedAt` 是非空字符串。
- `updatedAt` 是非空字符串。
- `projectRoot` 是绝对路径字符串。
- `projectSummary` 是非空字符串。
- `stageHelpers` 包含 `planning`、`execution`、`review` 三个数组。
- 数组内每项符合 `StageHelper` 最小结构。

不要引入完整 JSON schema 框架。

## format.mjs 落地

`scripts/lib/format.mjs` 本阶段只需要：

```js
nowIso()
```

时间格式保持 ISO 字符串即可。当前运行环境能稳定给出 timezone offset 时可以使用本地 offset；否则使用 `new Date().toISOString()` 也可接受。关键是同一次写入中 `initializedAt` 和 `updatedAt` 来源一致、可比较、可读。

`createTaskId()` 和 `renderPlanMarkdown()` 留给 `/plan` 阶段再实现。

## init.mjs 处理流程

`scripts/init.mjs` 的主流程：

1. 校验子命令，只接受 `init-project`。
2. 读取 stdin。
3. 解析 JSON，失败返回 `INVALID_INPUT`。
4. 调用 `normalizeInitInput()`。
5. 解析 `projectRoot = process.cwd()`。
6. 调用 `ensureStateRoot(projectRoot)`。
7. 进入 `withStateLock(projectRoot, fn)`。
8. 在锁内读取旧 `project.json`。
9. 生成 `now = nowIso()`。
10. 组装新 project：

```js
{
  initializedAt: oldProject?.initializedAt ?? now,
  updatedAt: now,
  projectRoot,
  projectSummary: normalized.projectSummary,
  stageHelpers: normalized.stageHelpers
}
```

11. 调用 `validateProject(project)`。
12. 调用 `writeProject(projectRoot, project)`。
13. 输出写入后的 `project` 和 `projectPath`。

异常处理：

- 校验类错误输出稳定错误码。
- 未预期错误输出 `INVALID_PROJECT_STATE` 或 `LOCK_TIMEOUT` 等最接近的错误码。
- malformed stdin、非法 helper、校验失败都不得修改旧 `project.json`。

## init skill 落地

当前 `skills/init/SKILL.md` 需要从“初始化能力清单”改成“初始化项目摘要和外部 companion helper”。

建议内容结构：

```text
---
name: init
description: 初始化或刷新 my-cc-lite 项目级状态
---

使用条件：
- 用户手动调用 /init。

执行步骤：
1. 确认目标项目根目录是当前工作目录。
2. 读取少量项目线索，例如 README、package manifest、顶层目录。
3. 写出一到两句 projectSummary。
4. 审查当前上下文可见的外部 companion helper。
5. 排除 Claude Code 宿主基础能力、协作模式和 my-cc-lite 自身能力。
6. 构造 stageHelpers。
7. 调用 node scripts/init.mjs init-project。
8. 汇总 project.json 路径、摘要和 helper 数量。
9. 提示下一步可以进入 /plan。
```

skill 需要强调：

- 不调用项目检查命令。
- 不创建任务。
- 不写 plan。
- 不把 Claude Code 基础工具写入 `stageHelpers`。
- helper 的 `description` 必须描述阶段用途，而不是泛化能力。

如果 `stageHelpers` 为空，也应继续执行初始化。

## helper 收集规则

`/init` skill 收集 helper 时按阶段路由：

### planning

只放能直接帮助 `/plan` 的外部 companion helper，例如：

- 代码上下文分析工具。
- 架构审查 skill。
- 规划前风险识别 agent。

示例：

```json
{
  "name": "codegraph_context",
  "type": "tool",
  "invoke": "mcp__codegraph.codegraph_context",
  "description": "Collect code context before /plan drafts implementation tasks"
}
```

### execution

只放能直接帮助 `/do` 执行任务的外部 companion helper，例如：

- 领域专项执行 agent。
- 明确可调用的自动化 helper。
- 特定框架的实现辅助 skill。

不要把通用文件编辑、搜索、shell 运行能力写进去。

### review

只放能直接帮助 `/verify` 判断完成质量的外部 companion helper，例如：

- code review skill。
- security review agent。
- bug finding tool。
- 变更后诊断 helper。

示例：

```json
{
  "name": "code-review",
  "type": "skill",
  "invoke": "code-review",
  "description": "Review completed code changes before /verify marks the task passed"
}
```

## 与后续阶段的接口

后续 `/plan`、`/do`、`/verify` 只读 `project.json`：

- `/plan` 可以读取 `projectSummary` 获得项目背景。
- `/plan` 可以读取 `stageHelpers.planning` 判断是否建议调用外部规划 helper。
- `/do` 可以读取 `stageHelpers.execution` 判断是否建议委派执行 helper。
- `/verify` 可以读取 `stageHelpers.review` 判断是否建议调用 review helper。

后续阶段不更新 `project.json`。

如果用户在项目中新增或移除 companion helper，需要用户重新执行 `/init` 刷新 `stageHelpers`。

## 最小验证方案

默认不建立完整测试框架，只补一个最小 smoke。建议放在：

```text
test/smoke.mjs
```

覆盖场景：

1. 首次初始化
   - 在临时目录运行 `node <repo>/scripts/init.mjs init-project`。
   - 输入合法 `projectSummary` 和空 `stageHelpers`。
   - 断言 `.my-cc-lite/project.json` 存在。
   - 断言没有 `.my-cc-lite/tasks/`。

2. 重复初始化
   - 第一次写入 summary A。
   - 第二次写入 summary B。
   - 断言 `initializedAt` 不变。
   - 断言 `updatedAt` 刷新。
   - 断言 `projectSummary` 变成 B。

3. helper 过滤
   - 输入 `Bash`、`Plan`、`my-cc-lite:plan`、`mcp__codegraph.codegraph_context`。
   - 断言前三个被过滤。
   - 断言外部 tool 被保留。

4. malformed stdin
   - 先写入合法 `project.json`。
   - 再传入非法 JSON。
   - 断言命令失败。
   - 断言原 `project.json` 内容未损坏。

5. 非法 helper
   - 输入缺少 `invoke` 或 `type` 非法的 helper。
   - 断言命令失败或被拒绝。
   - 断言旧 `project.json` 不被修改。

因为项目当前仍在重写初期，smoke 可以直接使用 Node 内置 `assert`、`fs`、`os.tmpdir()` 和 `child_process.spawnSync()`，不引入测试框架。

## 验收标准

完成 init 阶段落地后，应满足：

- `skills/init/SKILL.md` 的职责描述与 `02-init-stage-design.md` 一致。
- `node scripts/init.mjs init-project` 可以独立运行。
- `.my-cc-lite/project.json` 内容符合设计结构。
- 重复 `/init` 不改变 `initializedAt`。
- `/init` 不创建或修改任何 task 相关文件。
- 已知 denylist 不会进入 `stageHelpers`。
- 外部 companion helper 可以进入对应阶段数组。
- 错误输出是稳定 JSON，不是裸异常堆栈。
- 最小 smoke 可以证明上述核心行为。

## 不做事项

本轮 init 阶段不要做：

- 不实现 `/plan`、`/do`、`/verify`、`/archive`。
- 不设计完整能力发现系统。
- 不扫描 Claude Code transcript。
- 不把宿主基础工具落盘。
- 不保存 my-cc-lite 自身 skill、agent、hook。
- 不记录 event log、changed files、verification evidence。
- 不建立长期锁、后台守护或自动刷新机制。
- 不做旧 `.my-cc-lite/capabilities.json`、`workflow.json`、`current-task.json` 迁移。

## 推荐提交切分

如果分多次实现，建议这样拆：

1. `scripts/lib` 和 `scripts/init.mjs`：先让 `init-project` 命令跑通。
2. `skills/init/SKILL.md`：接入新的人工调用流程。
3. `test/smoke.mjs`：补最小验证。
4. 清理旧入口引用：删除或改写仍指向旧 capabilities/init-capabilities 的描述。

核心判断标准是：每一步都不扩展 `/init` 的边界，只让它更可靠地维护 `project.json`。
