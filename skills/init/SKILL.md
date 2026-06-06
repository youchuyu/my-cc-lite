---
name: init
description: 初始化 my-cc-lite 阶段可调用能力清单
---

# my-cc-lite /init

使用此 skill 初始化一个小型项目级外部伴随能力清单，供 my-cc-lite 各阶段直接使用。

在保持目标项目为当前工作目录的同时，从已安装插件根目录使用 helper：

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

如果 `CLAUDE_PLUGIN_ROOT` 不可用，使用已安装 `my-cc-lite` 插件根目录的绝对路径。skill 目录不是插件根目录，不要在 `skills/init/scripts/` 下拼接 helper 路径。

在当前 checkout 中，兜底 helper 路径是：

```bash
MY_CC_LITE_HELPER="/Users/youchuyu/Desktop/ai/my-cc-lite/scripts/my-cc-lite-state.mjs"
```

## 规则

- 只使用当前可见的会话上下文。
- 不要请求、读取或引用日志、trace、请求快照或历史 transcript 文件。
- 不要创建任务，也不要推进 `plan`、`do`、`verify` 或 `status`。
- 构建经过筛选的伴随能力索引，而不是完整转储可见上下文。
- 空 bucket 是有效的。不要为了让某个阶段看起来有内容而添加弱相关条目。
- 只有当某个 my-cc-lite 阶段可以把能力作为可选 helper 直接调用或委派时，才纳入该能力。
- 只有当能力直接支持多个列出的阶段时，才可以出现在多个顶层类别中。不要因为某个能力“通常有用”就在多个阶段重复添加。
- 排除 Claude Code 原生能力。这包括 `Bash`、`Read`、`Write`、`Edit`、`WebFetch`、`WebSearch`、`TodoWrite`、`Task` 等内置工具，以及 `general-purpose`、`Plan`、`Explore`、`run`、`verify` 等原生 agent 或 skill。
- 例外：如果 `Workflow` 工具可见，将它作为条件式多 agent 编排工具归类到 `execution.tools`。它的描述必须说明调用需要显式 opt-in，例如 `ultrawork` 关键词。不要把 `ultrawork` 作为单独能力添加；它只是 `Workflow` 的 opt-in 信号。
- 排除 my-cc-lite 自身能力。这包括 `my-cc-lite:init`、`my-cc-lite:plan`、`my-cc-lite:do`、`my-cc-lite:verify`、`my-cc-lite:status`，未命名空间化的 `init`、`plan`、`do`、`verify`、`status`，以及插件自身的 planner、executor、verifier 和 explore agents。
- 排除配置、循环任务、后台任务、权限管理、transcript 清理、status-line、HUD 和 setup 工具。例如：`update-config`、`loop`。
- 默认排除纯研究能力。只有当描述明确说明它们能为 `/plan` 提供规划证据时才纳入，否则省略。
- 不要把 review、security review、bug sweep 或 branch review 能力放入 `execution`，除非该能力明确为 `/do` 执行工作，而不只是变更后的评估。
- 只保留适合以下 bucket 的能力：
  - `skills`: 目标阶段可以调用的 skills，或可以替代目标阶段 skill 的 skills。
  - `agents`: 目标阶段可以委派部分或全部阶段职责的 agents。
  - `tools`: 目标阶段可以直接使用的其他可调用能力，包括 MCP tools 和伴随插件暴露的 callable tools。
- 不清晰的可调用能力只有在目标阶段可以直接使用且对该阶段确实有用时，才放入 `tools`。
- 排除 commands、MCP servers、hooks、plugin containers、instruction text、configuration、HUD、status-line、permission-management、transcript-cleanup、research-only 和 recurring-loop utilities。
- 默认排除原始基础工具，包括文件读写编辑、shell、web fetch/search、notebook、task-list、scheduling、worktree 和通用用户提问工具。
- 如果相关性不确定，省略该能力。

## 阶段路由

- `planning`: 面向规划的伴随 skills 或 agents，例如多方案综合、架构策略或风险规划。
- `execution`: 非原生执行 helper，用于应用变更、运行领域特定自动化或操作项目特定工作流。只有当 review 或 research helper 明确执行 `/do` 工作时，才放入这里。
- `review`: review、security review、bug finding、branch review、verification evidence 和诊断类伴随能力。
- `Workflow` 可见时属于 `execution.tools`，因为它执行确定性的多 agent 编排。在描述中保留 `ultrawork` opt-in 要求。不要把它重复放入 `planning` 或 `review`。

## 步骤

1. 审查当前可见的 skills、agents 和可直接调用的 tools。
2. 在分类前先应用上面的纳入规则。不要仅因为某个条目存在于上下文中就纳入它。
3. 将每个保留的能力分类到它直接支持的所有顶层类别中，并让集合尽可能小：
   - `planning`: `/plan` 阶段可以直接使用的能力。
   - `execution`: `/do` 阶段可以直接使用的能力。
   - `review`: `/verify` 阶段可以直接使用的能力。
4. 在每个类别内，将条目分组到这些 bucket：
   - `skills`
   - `agents`
   - `tools`
5. 检查跨类别重复的能力名称。只有当每个条目都有直接的阶段特定用途时，才保留跨阶段重复；否则只保留最强的类别。
6. 每个条目必须包含：

```json
{
  "name": "capability-name",
  "kind": "skill",
  "description": "Short purpose",
  "invoke": "capability-name",
  "source": "visible-context",
  "confidence": "high"
}
```

只有当阶段匹配是直接的，才使用 `confidence: "high"`。只有当能力有用但带条件匹配时，才使用 `medium`。省略低置信度条目。

当 `Workflow` 可见时，将它放入 `execution.tools` 并使用：

```json
{
  "name": "Workflow",
  "kind": "tool",
  "description": "Run deterministic multi-agent orchestration after explicit ultrawork opt-in",
  "invoke": "Workflow",
  "source": "visible-tools",
  "confidence": "high"
}
```

7. 将完整 JSON 发送给 helper：

```bash
node "$MY_CC_LITE_HELPER" init-capabilities
```

通过 stdin 传入 JSON。helper 会写入 `.my-cc-lite/capabilities.json`，保留已有 `providers`，并刷新 `inventory`。

## 输出

- 说明 `.my-cc-lite/capabilities.json` 已初始化。
- 汇总 `planning`、`execution` 和 `review` 下找到的能力数量。
- 当用户准备开始任务时，推荐下一条命令为 `/plan`。
