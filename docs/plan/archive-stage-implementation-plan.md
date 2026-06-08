# Archive Stage Implementation Plan

本文基于 `docs/design/06-archive-stage-design.md`，并对齐 `docs/design/00-core-workflow-state.md`、`docs/design/01-stage-scripts.md`、`docs/design/05-verify-stage-design.md` 和当前已落地的 `/verify` 实现，给出 `/archive` 阶段的详细执行方案。

## 目标结论

`/archive` 是当前任务生命周期的关闭阶段。它只负责把唯一 active task 从 `.my-cc-lite/tasks/<taskId>/` 移动到 `.my-cc-lite/archived_tasks/<taskId>/`，并在移动前把最小归档摘要写入当前任务的 `task.json.archive`。

MVP 完成后，用户调用 `/archive` 时，my-cc-lite 应做到：

- 只处理 `.my-cc-lite/tasks/` 下唯一 current task。
- 要求当前任务已经由 `/do` 物化，即当前任务目录下必须存在 `task.json`。
- 不要求 `verification.status` 必须是 `passed`，但未通过验证时由 `/archive` skill 明确提示归档语义。
- 只写 `task.json` 的顶层 `status`、`stage`、`updatedAt` 和 `archive`。
- 保持 `verification`、`tasks[]`、`steps[]`、`checks[]` 和 `plan.md` 原样。
- 不更新 `.my-cc-lite/project.json`。
- 不生成 `archive.md`、事件日志、changed files、命令日志或完整总结报告。
- 不自动创建新任务，不设计恢复归档任务。

当前仓库已经有：

```text
scripts/verify.mjs
skills/verify/SKILL.md
scripts/lib/state.mjs
scripts/lib/schema.mjs
scripts/lib/format.mjs
test/smoke.mjs
```

当前还没有：

```text
scripts/archive.mjs
skills/archive/SKILL.md
```

因此本阶段实施重点是补齐 archive 阶段脚本、扩展最小 schema 和 state 能力、补充 `/archive` skill 编排说明，并用 smoke 覆盖归档写入和目录移动契约。

## 能力清单

`/archive` 阶段完整能力分为四类。

### 1. 进入条件检查

`/archive` 执行前必须确认：

- `.my-cc-lite/project.json` 存在且结构合法。
- `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 当前任务目录下存在非空 `plan.md`。
- 当前任务目录下存在结构合法的 `task.json`。
- 当前任务尚未归档。
- 目标 `.my-cc-lite/archived_tasks/<taskId>/` 不存在。

如果没有 active task，提示当前没有可归档任务。如果存在多个 active task，停止并提示状态异常，需要手动处理。如果缺少 `task.json`，提示先执行 `/do` 物化任务；MVP 不把只有 `plan.md` 的半初始化任务纳入 `/archive`。

### 2. 归档语义提示

`/archive` 不重新执行验证，也不判断任务是否完成。任务是否完成仍以 `verification.status: "passed"` 为准；归档只表示任务目录已经从 active 工作区移走。

`/archive` skill 在归档前读取当前 `task.json` 并根据状态提示：

- `verification.status: "passed"`：常规完成归档。
- `verification.status: "needs_fix"`：仍有修复缺口，归档后表示放弃继续处理当前任务。
- `verification.status: "blocked"`：任务验证被阻塞，归档后表示关闭这个阻塞任务。
- `verification.status: "not_started"`：任务尚未完成最终验证，归档后不代表完成。
- 顶层 `status: "blocked"`：任务仍处于阻塞状态，归档后只表示关闭。

如果用户已经明确要求归档，可以继续。若用户没有表达关闭未完成任务的意图，skill 需要先说明风险并等待用户确认。这个确认只发生在对话层，不写入 `task.json`。

### 3. 归档状态写入

`scripts/archive.mjs` 只负责确定性状态写入和目录移动。建议提供一个子命令：

```text
node scripts/archive.mjs archive
```

输入：

```json
{
  "summary": "Verified and archived after completing the planned task."
}
```

脚本行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 在写锁内重新定位唯一 active task。
- 读取非空 `plan.md`。
- 读取并校验 `task.json`。
- 校验输入 `summary` 非空且保持简短。
- 校验当前任务不是已归档状态。
- 校验目标归档目录不存在。
- 写入 `task.json.status = "archived"`。
- 写入 `task.json.stage = "archived"`。
- 刷新 `task.json.updatedAt`。
- 写入 `task.json.archive.summary` 和 `task.json.archive.archivedAt`。
- 移动整个任务目录到 `.my-cc-lite/archived_tasks/<taskId>/`。

写入后的关键形态：

```json
{
  "status": "archived",
  "stage": "archived",
  "updatedAt": "2026-06-08T12:00:00+08:00",
  "archive": {
    "summary": "Verified and archived after completing the planned task.",
    "archivedAt": "2026-06-08T12:00:00+08:00"
  }
}
```

`archive.summary` 只保存一句到几句短结论。它可以说明完成情况、验证状态或关闭原因，但不能保存完整执行报告、命令输出或文件列表。

### 4. 目录移动和恢复边界

归档移动路径固定为：

```text
.my-cc-lite/tasks/<taskId>/
-> .my-cc-lite/archived_tasks/<taskId>/
```

移动必须和 `task.json` 写入处于同一个短写锁范围内。目标目录已经存在时，脚本必须返回 `ARCHIVE_TARGET_EXISTS`，不能覆盖、合并或自动改名。

`/archive` 成功后，`.my-cc-lite/tasks/` 为空，后续 `/plan` 可以创建新的 current task。已归档任务只保留在 `archived_tasks/<taskId>/` 供回看，不提供恢复语义。

## 实施顺序

建议按五个小步落地。

### 1. 扩展 state 能力

在 `scripts/lib/state.mjs` 中新增：

```js
getArchivedTaskDir(projectRoot, taskId)
archiveTaskDir(projectRoot, taskId)
```

职责划分：

- `getArchivedTaskDir(projectRoot, taskId)` 返回 `.my-cc-lite/archived_tasks/<taskId>` 的绝对路径。
- `archiveTaskDir(projectRoot, taskId)` 只负责创建 `archived_tasks/` 父目录、检查目标目录不存在、移动 `tasks/<taskId>/` 到归档目录。
- `archiveTaskDir` 不理解任务是否完成，也不修改 `task.json`。
- 目标目录已存在时抛出 `StateError("ARCHIVE_TARGET_EXISTS", ...)`。

目录移动应复用现有 `statePaths()`、`getCurrentTaskDir()` 和 `withStateLock()`，保持脚本层状态访问方式一致。

### 2. 扩展 schema 能力

在 `scripts/lib/schema.mjs` 中新增：

```js
normalizeArchiveInput(input)
assertArchivableTask(task)
```

`normalizeArchiveInput(input)` 校验：

- 输入必须是 JSON object。
- 只允许 `summary` 字段。
- `summary` 必须是非空字符串。
- `summary` trim 后写入。

`assertArchivableTask(task)` 校验：

- `task.json` 结构合法。
- `task.status` 不是 `archived`。
- `task.stage` 不是 `archived`。
- `task.archive.archivedAt` 为空。

它不要求 `verification.status` 是 `passed`，也不判断用户是否应该关闭未完成任务。这个判断留给 `/archive` skill。

`assertArchivableTask(task)` 只校验 `task.json` 自身的归档状态，不理解路径。`task.taskId` 与当前任务目录名是否一致，由 `scripts/archive.mjs` 在读取当前任务目录后校验。

### 3. 新增 `scripts/archive.mjs`

新增文件：

```text
scripts/archive.mjs
```

脚本结构参考 `scripts/verify.mjs`：

- 支持 `--help` / `-h`。
- 只接受 `archive` 子命令。
- 从 stdin 读取 JSON。
- 使用 `StateError` 输出统一错误格式。
- 成功时输出 `{ ok: true, result }`。
- 失败时输出 `{ ok: false, error: { code, message } }` 并设置非零退出码。

主流程：

1. 解析命令和 stdin JSON。
2. `normalizeArchiveInput(input)`。
3. `assertInitializedProject(await readProject(projectRoot))`。
4. 进入 `withStateLock(projectRoot, ..., { operation: "archive-task" })`。
5. 锁内再次读取并校验 `project.json`。
6. 定位唯一 current task，缺失时报 `NO_ACTIVE_TASK`。
7. 读取 `plan.md`，缺失或为空时报 `PLAN_NOT_FOUND`。
8. 读取 `task.json`，缺失时报 `TASK_STATE_NOT_FOUND`。
9. 校验 `task.taskId` 必须等于当前任务目录名；不一致时报 `INVALID_TASK_STATE`，不写入、不移动。
10. `assertArchivableTask(task)`。
11. 确认目标归档目录不存在。
12. 写入归档字段和顶层状态。
13. `writeTask(taskDir, task)`。
14. `archiveTaskDir(projectRoot, task.taskId)`。
15. 输出归档结果。

成功输出建议包含：

```json
{
  "taskId": "20260608-120000-archive-stage-design",
  "archivedDir": "/path/to/project/.my-cc-lite/archived_tasks/20260608-120000-archive-stage-design",
  "taskPath": "/path/to/project/.my-cc-lite/archived_tasks/20260608-120000-archive-stage-design/task.json",
  "planPath": "/path/to/project/.my-cc-lite/archived_tasks/20260608-120000-archive-stage-design/plan.md",
  "status": "archived",
  "stage": "archived",
  "verification": {
    "status": "passed",
    "summary": "All planned checks passed."
  },
  "archive": {
    "summary": "Verified and archived after completing the planned task.",
    "archivedAt": "2026-06-08T12:00:00+08:00"
  }
}
```

错误码至少覆盖：

```text
PROJECT_NOT_INITIALIZED
NO_ACTIVE_TASK
MULTIPLE_ACTIVE_TASKS
PLAN_NOT_FOUND
TASK_STATE_NOT_FOUND
ARCHIVE_TARGET_EXISTS
INVALID_INPUT
INVALID_PROJECT_STATE
INVALID_TASK_STATE
LOCK_TIMEOUT
```

### 4. 新增 `skills/archive/SKILL.md`

新增目录和文件：

```text
skills/archive/SKILL.md
```

skill 负责模型侧交互：

- 读取 `.my-cc-lite/project.json`。
- 扫描 `.my-cc-lite/tasks/` 并确认唯一 current task。
- 读取当前 `plan.md` 和 `task.json`。
- 根据 `verification.status`、顶层 `status` 和 `stage` 说明归档语义。
- 未验证通过时，在用户没有明确关闭意图的情况下先确认。
- 基于 `plan.md`、`task.json.objective`、`verification.summary` 和当前状态生成短 `archive.summary`。
- 调用 `node scripts/archive.mjs archive` 并通过 stdin 传入 JSON。
- 返回归档路径、验证状态和归档摘要。

skill 禁止事项：

- 不重新验证任务。
- 不执行修复。
- 不修改 `plan.md`。
- 不直接手写 `task.json`。
- 不修改 `.my-cc-lite/project.json`。
- 不修改已有 `tasks[]`、`steps[]`、`checks[]` 或 `verification`。
- 不生成 `archive.md`、完整报告、命令日志、changed files 或事件日志。
- 不自动创建新任务。

脚本路径解析方式沿用其他 skill：

- 如果当前工作目录存在 `scripts/archive.mjs`，使用相对路径调用。
- 如果当前工作目录不是 my-cc-lite 插件源码目录，先定位插件根目录，再使用绝对路径调用 `<pluginRoot>/scripts/archive.mjs`。
- 如果无法定位插件根目录，停止并提示用户提供插件根目录。

### 5. 补充 smoke 验证

扩展 `test/smoke.mjs`，只增加最小必要场景，不建立完整测试框架。

建议覆盖：

1. 未初始化项目执行 archive，返回 `PROJECT_NOT_INITIALIZED`。
2. 已初始化但没有 active task，返回 `NO_ACTIVE_TASK`。
3. 当前任务目录缺少 `plan.md`，返回 `PLAN_NOT_FOUND`。
4. 当前任务目录缺少 `task.json`，返回 `TASK_STATE_NOT_FOUND`。
5. 输入 `summary` 为空，返回 `INVALID_INPUT`。
6. 目标 `archived_tasks/<taskId>/` 已存在，返回 `ARCHIVE_TARGET_EXISTS`，且不覆盖目标目录。
7. `verification.status: "passed"` 时归档成功。
8. `verification.status: "needs_fix"` 或 `blocked` 时，只要输入合法摘要，脚本仍可归档成功。
9. 归档后 active task 目录被移动到 `archived_tasks/<taskId>/`。
10. 归档后 `task.json.status` 和 `task.json.stage` 都是 `archived`。
11. 归档后 `task.json.verification`、`tasks[]` 和 `plan.md` 保持不变。
12. 归档后 `.my-cc-lite/tasks/` 为空。
13. 确认 `project.json` 没有被 `/archive` 修改。
14. 确认没有生成 `archive.md`、changed files、命令日志或事件日志。
15. 当前任务目录名与 `task.json.taskId` 不一致时，返回 `INVALID_TASK_STATE`，且 active task 目录、`task.json` 和归档目录都不变。

## 协作流程

`/archive` 的推荐执行流：

1. 用户调用 `/archive` 或明确要求关闭当前任务。
2. skill 读取项目状态和当前任务上下文。
3. skill 判断验证状态并说明归档语义。
4. 如果任务未验证通过且用户没有明确关闭意图，先询问确认。
5. skill 生成短 `archive.summary`。
6. skill 调用 `scripts/archive.mjs archive`。
7. 脚本在锁内写入归档状态并移动目录。
8. skill 返回归档结果。

返回给用户时说明：

- 归档目录。
- `verification.status`。
- `archive.summary`。
- 如果验证未通过，明确说明这次归档表示关闭任务，不表示任务完成。
- 下一步可以重新执行 `/plan` 创建新任务。

## 与其他阶段的交接

`/verify` 通过后，建议用户执行 `/archive`。`/archive` 成功后，`.my-cc-lite/tasks/` 为空，后续 `/plan` 不会被旧 current task 阻塞。

如果用户归档未通过验证的任务，后续 `/plan` 同样可以创建新任务；旧任务仍保留在 `archived_tasks/<taskId>/`，回看时应根据 `verification.status` 判断是否完成。

`/archive` 不负责 `/status` 展示。未来如果设计 `/status`，可以只读展示最近归档任务，但这不是 archive 阶段的必需能力。

## 取舍

本阶段刻意不引入：

- `archive.md`。
- 归档索引。
- 归档事件流。
- 完整执行报告。
- changed files、命令日志或证据日志。
- 自动验证。
- 自动修复。
- 自动提交、发布或清理。
- 归档恢复。
- 未物化 `plan.md` 的取消流程。
- 多任务归档或批量归档。

保留的核心能力是：

- 关闭唯一 current task。
- 保存短归档摘要和归档时间。
- 移动整个任务目录，保留 `plan.md` 和 `task.json`。
- 让 `.my-cc-lite/tasks/` 回到空状态，使下一个 `/plan` 可以开始。
- 保持完成语义和关闭语义分离：完成看 `verification.status`，关闭看 `status/stage: archived`。
