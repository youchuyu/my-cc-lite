---
name: init
description: 初始化或刷新 my-cc-lite 项目级状态
disable-model-invocation: true
---

# Init

`/init` 是 my-cc-lite 的项目级初始化入口。它只负责分析传给模型的上下文信息，收集项目基本信息，并识别各阶段（参考**阶段路由**）可用的外部 helper（system-reminder 中可见的 skills），然后写入 `.my-cc-lite/project.json`。

## 执行步骤

1. 确认当前工作目录就是目标项目根目录。
2. 逐条遍历 system-reminder 中的 skill 列表，按下方**阶段路由**和**排除类别**规则筛选 helper。
3. 读取少量顶层目录下的项目线索，例如 `README`、package manifest、已有设计文档。
4. 写出一到两句 `projectSummary`，只描述项目基本形态和后续阶段需要知道的轻量背景。
5. 调用 my-cc-lite runtime entry 的 `init init-project`，通过 stdin 传入 JSON（见下方调用示例）。
6. 汇报 `.my-cc-lite/project.json` 路径、项目摘要和各阶段 helper 数量，提示可以进入 `/plan`。

## helper 纳入规则

只纳入同时满足以下全部条件的 helper：

- 当前上下文明确定义或可见。
- 对目标阶段有直接帮助。
- 不属于排除类别（见下）。

**排除类别：**

- Claude Code 宿主基础能力：`Bash`、`Read`、`Write`、`Edit`、`WebSearch`、`WebFetch`、`TodoWrite`、`Task`。
- Claude Code 原生协作模式：`Plan`、`Explore`。
- Claude Code 原生通用 agent：`general-purpose`。
- my-cc-lite 自身能力：`my-cc-lite:*`。
- 配置、后台循环、权限管理、HUD、status-line、transcript 清理和 setup 类能力。

**阶段路由：**

- `planning`：供 `/plan` 使用，例如代码上下文分析、架构判断、风险识别。
- `execution`：供 `/do` 使用，例如领域专项执行 helper 或可委派实现 agent。
- `review`：供 `/verify` 使用，例如 code review、security review、bug finding 或验证诊断。

每个 helper 是一个包含四个字段的对象：`name`、`type`、`invoke`、`description`。

- `invoke` 填 system-reminder skill 列表中的名称，原样照抄。
- `description` 描述该 helper 在此阶段如何帮助 my-cc-lite，不描述泛化能力。

没有明确外部 helper 时，三个数组全部为空。

## 调用示例

脚本调用统一使用 my-cc-lite runtime entry：

- 如果当前工作目录存在 `scripts/run.mjs`，使用：

```bash
node scripts/run.mjs init init-project
```

- 否则先定位 my-cc-lite 插件根目录，使用：

```bash
node <pluginRoot>/scripts/run.mjs init init-project
```

- 调用命令时不得切换到插件根目录；当前工作目录必须保持为目标项目根目录。
- 如果无法定位插件根目录，停止并提示用户提供；不要尝试直接调用 `/scripts/run.mjs`。

```bash
node scripts/run.mjs init init-project <<'JSON'
{
  "projectSummary": "A Claude Code plugin project for lightweight local task workflow state.",
  "stageHelpers": {
    "planning": [],
    "execution": [],
    "review": []
  }
}
JSON
```

## 禁止事项

- 不运行项目检查命令。
- 不记录事件日志。
- 不记录完整能力清单。
- 不扫描 Claude Code transcript。
- 不创建 `.my-cc-lite/tasks/`。
