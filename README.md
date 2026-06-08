# my-cc-lite

`my-cc-lite` 是一个面向 Claude Code 的轻量级任务状态插件。

它不是独立 agent runtime。Claude Code 仍负责对话、工具调用、文件编辑和模型执行；`my-cc-lite` 只补充本地可读的任务状态、阶段提示和少量记录。

## 当前流程

```text
/init -> /plan -> /do -> /verify -> /archive
```

当前插件声明的 skill 位于：

- `skills/init/`
- `skills/plan/`
- `skills/do/`
- `skills/verify/`
- `skills/archive/`

## 状态目录

目标项目初始化后，`my-cc-lite` 使用目标项目内的 `.my-cc-lite/` 保存状态：

```text
.my-cc-lite/
  project.json
  tasks/
    <taskId>/
      plan.md
      task.json
  archived_tasks/
    <taskId>/
      plan.md
      task.json
```

`project.json` 只保存项目级摘要和阶段 helper 线索，不保存当前任务指针。当前任务通过 `.my-cc-lite/tasks/` 下未归档任务目录推断；MVP 阶段默认只允许一个当前任务。

## 阶段边界

### `/init`

初始化或刷新项目级状态。

- 写入 `.my-cc-lite/project.json`。
- 记录 `projectSummary` 和 `stageHelpers`。
- 不创建任务、不写计划、不推进执行。

对应脚本：

```bash
node scripts/run.mjs init init-project
```

### `/plan`

把用户目标收敛为当前任务计划。

- 创建 `.my-cc-lite/tasks/<taskId>/plan.md`。
- 不创建 `task.json`。
- 不更新 `project.json`。
- 不进入执行或验证阶段。

对应脚本：

```bash
node scripts/run.mjs plan create-task
```

### `/do`

执行当前任务。

- 首次执行时把 `plan.md` 物化为 `task.json`。
- 维护 `tasks[].status` 和 `tasks[].statusReason`。
- 默认连续推进可执行 task。
- 不做最终验收、不归档任务。

对应脚本：

```bash
node scripts/run.mjs do materialize
node scripts/run.mjs do update-task
```

### `/verify`

验收当前任务。

- 读取当前任务的 `plan.md` 和 `task.json`。
- 写入最终验证结论：`passed`、`needs_fix` 或 `blocked`。
- `needs_fix` 可以追加一个或少量 repair tasks。
- 不执行修复、不归档任务。

对应脚本：

```bash
node scripts/run.mjs verify complete
```

### `/archive`

关闭当前任务。

- 将 `.my-cc-lite/tasks/<taskId>/` 移动到 `.my-cc-lite/archived_tasks/<taskId>/`。
- 写入最小 `archive.summary`。
- 不重新验证、不执行修复、不创建新任务。

对应脚本：

```bash
node scripts/run.mjs archive archive
```

`scripts/run.mjs` 是 skill 推荐使用的统一入口。它从 my-cc-lite 插件根目录分发到各阶段脚本，同时保持当前工作目录为目标项目根目录；各阶段脚本仍可在开发时直接调用。

## 设计原则

- 保持单一路径，优先跑通最小工作流。
- 状态本地、可读、可恢复，方便人工接管。
- 阶段 skill 负责提示和操作边界，脚本负责确定性的状态读写。
- 不提前固化后续阶段状态；每个阶段只沉淀当前阶段已经确定的信息。
