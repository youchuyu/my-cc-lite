# Archive Stage Design

本设计定义 my-cc-lite `/archive` 阶段的职责、状态写入边界和脚本协议。它建立在 `00-core-workflow-state.md`、`01-stage-scripts.md` 和 `05-verify-stage-design.md` 之上。

`/archive` 的核心作用是关闭当前任务，把当前任务目录从 active 区移动到 archived 区，并在 `task.json.archive` 中保存最小归档摘要。它不重新验证任务，不生成额外报告，也不更新项目级状态。

## 阶段定位

`/archive` 是当前任务生命周期的关闭阶段：

```text
/plan -> /do -> /verify -> /archive
```

常规路径是 `/verify` 写入 `passed` 后执行 `/archive`。但 `/archive` 不强制要求 `verification.status` 必须是 `passed`。用户可以选择归档未通过、阻塞或不再继续处理的任务；这类归档表示关闭任务目录，不表示任务完成。

任务是否完成仍以：

```json
{
  "verification": {
    "status": "passed"
  }
}
```

为准。归档只表示当前任务已经从 active 工作区移走。

## 核心契约

`/archive` 必须保持这些边界：

- 只处理 `.my-cc-lite/tasks/` 下唯一 current task。
- 只写当前任务目录下的 `task.json.archive`、顶层 `status`、顶层 `stage` 和顶层 `updatedAt`。
- 只移动当前任务目录到 `.my-cc-lite/archived_tasks/<taskId>/`。
- 不更新 `.my-cc-lite/project.json`。
- 不修改 `plan.md`。
- 不修改 `tasks[]`、`steps[]`、`checks[]` 或 `verification`。
- 不生成 `archive.md`、事件日志、changed files、命令日志或完整总结报告。
- 不自动创建新任务。
- 不支持从归档目录恢复任务；恢复可以作为后续能力单独设计。

`/archive` 是状态关闭动作，不是 review、cleanup 或 release 流程。需要额外清理、提交、发布、回滚或报告时，应在 `/do` 或用户显式请求下完成，不放进 `/archive` 的默认契约。

## 进入条件

`/archive` 开始时必须满足：

- `.my-cc-lite/project.json` 存在且结构合法。
- `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 当前任务目录下存在 `plan.md`。
- 当前任务目录下存在结构合法的 `task.json`。
- 当前任务还没有被归档。

如果没有 current task，说明没有可归档任务。若存在多个 active task，说明状态异常，`/archive` 必须停止，不做隐式选择。

如果当前任务缺少 `task.json`，说明任务只停留在 `/plan` 之后、尚未进入执行状态。MVP 下 `/archive` 不归档这种半初始化任务，应提示用户先执行 `/do` 物化，或后续另行设计取消任务能力。这样可以避免 `/archive` 同时承担“取消未执行计划”的语义。

## 归档前判断

`/archive` 不重新执行验证，但需要在归档前读取当前 `task.json` 并给出清晰提示：

- `verification.status: "passed"`：常规完成归档。
- `verification.status: "needs_fix"`：仍有修复缺口，归档后表示放弃继续处理当前任务。
- `verification.status: "blocked"`：任务验证被阻塞，归档后表示关闭这个阻塞任务。
- `verification.status: "not_started"`：任务尚未完成最终验证，归档后不代表完成。
- 顶层 `status: "blocked"`：任务仍处于阻塞状态，归档后只表示关闭。

当任务未验证通过时，`/archive` skill 应在对话中明确说明归档后不会被视为完成。若用户已经明确要求归档，可以继续；若用户没有表达关闭未完成任务的意图，应先提示风险并让用户确认。这个确认只属于 skill 交互，不写入 `task.json`。

`scripts/archive.mjs` 不负责二次确认。脚本只根据输入和当前状态执行确定性写入与目录移动。

## 状态写入

归档成功前，`archive.mjs` 在当前任务目录内更新 `task.json`：

```json
{
  "status": "archived",
  "stage": "archived",
  "updatedAt": "2026-06-08T12:00:00+08:00",
  "archive": {
    "summary": "Implemented the planned docs update and verified it against the original acceptance checks.",
    "archivedAt": "2026-06-08T12:00:00+08:00"
  }
}
```

写入规则：

- 顶层 `status` 固定写为 `archived`。
- 顶层 `stage` 固定写为 `archived`。
- 顶层 `updatedAt` 刷新为当前时间。
- `archive.summary` 必须非空，保持一句到几句短摘要。
- `archive.archivedAt` 写入当前时间。
- `verification` 保持原样。
- `tasks[]` 保持原样。

`archive.summary` 只保存可用于回看任务的短结论。它可以说明任务完成情况、验证状态或关闭原因，但不保存完整执行报告。

示例：

```text
Verified and archived after completing the planned archive-stage design document.
```

未通过验证但用户决定关闭时：

```text
Archived while verification was blocked because the task is no longer being pursued.
```

## 目录移动

状态写入完成后，`archive.mjs` 将整个当前任务目录移动：

```text
.my-cc-lite/tasks/<taskId>/
-> .my-cc-lite/archived_tasks/<taskId>/
```

移动后目录结构为：

```text
.my-cc-lite/
  tasks/
  archived_tasks/
    <taskId>/
      task.json
      plan.md
```

移动必须和 `task.json` 写入处于同一个短写锁范围内，避免写入后移动前被其他阶段读到半归档状态。

如果目标归档目录已经存在，必须停止并返回 `ARCHIVE_TARGET_EXISTS`，不能覆盖、合并或自动改名。`taskId` 是任务身份，不应通过自动改名制造两个近似归档。

## 协作流程

`/archive` skill 负责模型侧交互和摘要生成，`scripts/archive.mjs` 只负责确定性状态写入和目录移动。

推荐流程：

1. 读取 `.my-cc-lite/project.json`。
2. 定位唯一 current task。
3. 读取当前 `plan.md`。
4. 读取并校验当前 `task.json`。
5. 查看 `verification.status`、顶层 `status` 和顶层 `stage`。
6. 如果任务未验证通过，确认用户是否确实要关闭未完成任务。
7. 基于 `plan.md`、`task.json.objective`、`verification.summary` 和当前状态生成短 `archive.summary`。
8. 调用 `scripts/archive.mjs archive` 写入归档字段并移动目录。
9. 在对话中返回归档路径、验证状态和简短摘要。

`/archive` 不需要委派专门 agent。归档摘要不需要模型做复杂判断，只需要从已有状态归纳一句到几句短文本。

## scripts/archive.mjs

`archive.mjs` 对应 `/archive` 的确定性状态入口。建议命令：

```text
node scripts/archive.mjs archive
```

输入：

```json
{
  "summary": "Verified and archived after completing the planned task."
}
```

行为：

- 读取并校验 `.my-cc-lite/project.json`。
- 确认 `.my-cc-lite/tasks/` 下刚好存在一个当前任务目录。
- 读取当前 `plan.md`。
- 读取并校验当前 `task.json`。
- 校验输入 `summary` 非空且保持简短。
- 确认目标 `.my-cc-lite/archived_tasks/<taskId>/` 不存在。
- 在写锁内更新 `task.json` 的归档字段、顶层 `status`、顶层 `stage` 和 `updatedAt`。
- 移动当前任务目录到 `archived_tasks/<taskId>/`。
- 输出 `taskId`、归档目录、`plan.md` 路径、`task.json` 路径、验证状态和归档摘要。

成功输出示例：

```json
{
  "ok": true,
  "result": {
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
}
```

失败输出沿用 `01-stage-scripts.md` 的统一错误格式。

### 错误码

`archive.mjs` 至少使用这些错误码：

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

错误语义：

- `PROJECT_NOT_INITIALIZED`：找不到 `.my-cc-lite/project.json`。
- `NO_ACTIVE_TASK`：`.my-cc-lite/tasks/` 下没有当前任务目录。
- `MULTIPLE_ACTIVE_TASKS`：`.my-cc-lite/tasks/` 下存在多个任务目录，状态异常，不能隐式选择。
- `PLAN_NOT_FOUND`：当前任务目录下缺少 `plan.md`。
- `TASK_STATE_NOT_FOUND`：当前任务目录下缺少 `task.json`，不归档未物化任务。
- `ARCHIVE_TARGET_EXISTS`：目标归档目录已经存在，不能覆盖。
- `INVALID_INPUT`：stdin JSON 缺少必要字段或字段结构非法。
- `INVALID_PROJECT_STATE`：`project.json` 不合法。
- `INVALID_TASK_STATE`：`task.json` 不合法。
- `LOCK_TIMEOUT`：无法获得 `.my-cc-lite/state.lock`。

## 公共库补充

为了实现 `archive.mjs`，需要在公共库补齐最小接口。

`scripts/lib/state.mjs` 增加或确认已有：

```js
archiveTaskDir(projectRoot, taskId)
getArchivedTaskDir(projectRoot, taskId)
```

`archiveTaskDir(projectRoot, taskId)` 只负责目录移动和目标存在检查，不理解任务是否完成。

`scripts/lib/schema.mjs` 增加：

```js
normalizeArchiveInput(input)
assertArchivableTask(task)
```

`normalizeArchiveInput(input)` 接受：

```ts
type ArchiveInput = {
  summary: string;
};
```

输入规则：

- `summary` 必须是非空字符串。
- `summary` 应保持简短，不能把完整执行报告、命令输出或文件列表塞进归档状态。

`assertArchivableTask(task)` 只做确定性结构和阶段校验：

- `task.status` 不是 `archived`。
- `task.stage` 不是 `archived`。
- `task.archive.archivedAt` 为空。
- `task.archive.summary` 可以为空或旧空字符串。

它不要求 `verification.status` 是 `passed`，也不判断任务是否应该被归档。

## skills/archive/SKILL.md

`skills/archive/SKILL.md` 是 `/archive` 的模型侧入口。

它负责：

- 读取当前项目状态。
- 判断是否存在唯一 current task。
- 根据当前验证状态提示用户归档语义。
- 在未验证通过时确认用户是否仍要关闭任务。
- 生成短 `archive.summary`。
- 调用 `scripts/archive.mjs archive`。
- 返回归档路径、验证状态和下一步状态。

它不负责：

- 执行修复。
- 重新验证任务。
- 修改 `plan.md`。
- 修改 `tasks[]`、`steps[]`、`checks[]` 或 `verification`。
- 创建 `archive.md` 或完整任务报告。
- 更新 `project.json`。
- 自动创建新任务。

## 与其他阶段的交接

`/verify` 通过后，建议用户执行 `/archive`。`/archive` 成功后，`.my-cc-lite/tasks/` 为空，后续 `/plan` 可以创建新的 current task。

如果用户归档未通过验证的任务，后续 `/plan` 也可以创建新任务；但旧任务仍保留在 `archived_tasks/<taskId>/` 中，回看时应根据 `verification.status` 判断它是否完成。

`/archive` 不设计恢复语义。若未来需要恢复归档任务，应单独定义 `/restore` 或手工恢复流程，并明确如何处理 active task 唯一性、归档字段清理和状态回退。

`/status` 后续可以只读展示最近归档任务，但这不是 `/archive` 的必需能力。MVP 中 `/status` 能报告当前没有 active task 即可。

## 验证

`/archive` 阶段的验证以 smoke 为主，不建立完整测试框架。

最小 smoke 场景：

1. 未初始化项目执行 `archive.mjs archive`，返回 `PROJECT_NOT_INITIALIZED`。
2. 已初始化但没有当前任务目录，返回 `NO_ACTIVE_TASK`。
3. 当前任务目录缺少 `plan.md`，返回 `PLAN_NOT_FOUND`。
4. 当前任务目录缺少 `task.json`，返回 `TASK_STATE_NOT_FOUND`。
5. 目标 `archived_tasks/<taskId>/` 已存在，返回 `ARCHIVE_TARGET_EXISTS`，不覆盖目标目录。
6. 输入 `summary` 为空，返回 `INVALID_INPUT`。
7. `verification.status: "passed"` 时归档成功，任务目录移动到 `archived_tasks/<taskId>/`。
8. `verification.status` 不是 `passed` 时，只要用户侧已确认并输入合法摘要，脚本仍可归档成功。
9. 归档后 `task.json.status` 和 `task.json.stage` 都是 `archived`。
10. 归档后 `task.json.verification`、`tasks[]` 和 `plan.md` 保持不变。
11. 归档后 `.my-cc-lite/tasks/` 为空，后续 `/plan` 不会被旧 current task 阻塞。
12. 确认 `/archive` 没有修改 `project.json`，也没有生成 `archive.md`、changed files、命令日志或事件日志。

如果这些场景通过，`/archive` 阶段的本地状态契约即可认为成立。

## 取舍

本方案刻意不引入：

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
- 保持任务完成语义和归档语义分离：完成看 `verification.status`，关闭看 `status/stage: archived`。
