# my-cc-lite design overview

本文是讨论稿，用来拆分 my-cc-lite 的核心模块边界。当前项目允许破坏性调整，因此这里优先描述目标契约，不约束现有 demo 实现。

## 定位

my-cc-lite 是 Claude Code 编排插件，不是独立 agent runtime。

Claude Code 继续负责对话、工具调用、文件编辑、模型执行和权限确认。my-cc-lite 只补充：

- 本地可读的任务状态
- 阶段入口提示
- 执行与检查记录
- 可恢复的当前任务指针
- 任务完成后的归档摘要

## 核心流程

```text
/init
/plan -> /do -> /verify -> /archive
/status
```

- `/init`：项目级初始化，每次执行都会覆盖项目画像和 capabilities，但保留当前任务指针。
- `/plan`：唯一任务创建入口，生成计划和任务状态。
- `/do`：分步骤执行，每个步骤内部包含执行和检查。
- `/verify`：任务级总检查，判断是否满足验收标准。
- `/archive`：关闭当前任务，保留验证状态，并释放当前任务指针。
- `/status`：只读状态入口，用于恢复和查看下一步。

## 设计原则

- core 保持轻量，只保留编排、状态、检查、归档。
- 所有任务信息保存在目标项目本地。
- 状态文件必须可读、可手动修复、可恢复。
- 强约束放在 helper 脚本中，提示词只负责引导。
- hooks 只做轻量记录和提醒，不做后台调度。
- companion plugin 可以提供额外能力，但不并入 core。

## 推荐文件结构

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

其中 `project.json` 保存项目画像、capabilities 和当前任务指针，`task.json` 是单个任务的唯一机器状态源。

## 非核心能力

以下能力默认不进入 core：

- 后台 daemon
- 自动循环执行到完成
- 多 agent runtime
- 团队协作系统
- browser automation
- memory 系统
- LSP 或代码索引服务
- 研究型 agent
- 权限管理和复杂阻断策略

这些能力可以作为 companion plugin，被 `/init` 识别后写入能力清单。

## 待确认

- `/do` 检查失败后的 retry 语义。
