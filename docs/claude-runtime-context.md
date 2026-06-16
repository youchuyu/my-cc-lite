# Claude 运行时上下文工作机制

本文档描述 Claude 在 Claude Code 环境中如何接收信息、如何决策、如何调用工具，以及哪些部分对 Claude 可见、哪些不可见。

---

## 一、会话启动时 Claude 拿到什么

### 1. 系统提示（System Prompt）

会话开始时一次性注入，整个会话期间固定不变。包含：

- **身份与行为规则**：Claude 的角色定义（Kiro）、tone/style 要求、默认行为（default-to-action、verification 等）
- **工具定义**：每个可调用工具的名称、描述、参数 schema。Claude 只能调用这里出现的工具
- **环境信息**：工作目录、OS、shell 类型、模型名称、知识截止日期
- **安全规则**：git 安全协议、内容安全、destructive action 确认要求
- **记忆系统说明**：memory 文件路径、类型定义、读写规则
- **MCP server 工具**：通过 MCP 协议挂载的额外工具（如 `mcp__chrome-devtools__*`、`mcp__context7__*`）

### 2. system-reminder（动态注入）

在每轮对话中由运行时动态附加，Claude 无法控制其内容。包含：

- **可用 skill 列表**：每个 skill 的名称、描述、trigger 条件。这是 Claude 唯一知道哪些 skill 存在的来源
- **当前日期**：`currentDate`
- **MCP server 使用指令**：例如 context7 的使用规则

### 3. 对话历史

每轮对话包含：
- 所有历史用户消息
- Claude 之前的所有回复（文本 + 工具调用）
- 每次工具调用的返回结果

当上下文接近窗口上限时，运行时会自动压缩历史消息（summarization），Claude 只看到摘要，不再看到原始内容。

---

## 二、处理一条用户消息的决策流程

```
用户消息
  │
  ├─ 是否命中某个 skill 的 trigger 条件？
  │     是 → 用 Skill 工具 invoke，不自己实现
  │     否 ↓
  │
  ├─ 是否适合委派给专用 subagent（Agent 工具）？
  │     适合 → 选择对应 subagent_type，spawn agent
  │     不适合 ↓
  │
  └─ 直接用基础工具（Bash / Read / Edit / Write 等）自己执行
```

### Skill 命中规则

- 只有出现在 system-reminder skill 列表里的 skill 对 Claude 存在
- `disable-model-invocation: true` 的 skill 不会出现在列表里，Claude 完全不可见，无法 invoke
- 命中 trigger 后必须先 invoke skill，不能先回复用户再 invoke

### Subagent 选择规则

- `subagent_type` 列表在 `Agent` 工具描述里定义，包括 `Explore`、`Plan`、`general-purpose`、`my-cc-lite:*` 等
- 每种 subagent 有各自的工具集限制（如 `Explore` 只读，不能写文件）
- spawn 的 subagent 没有当前对话的上下文，需要在 prompt 里显式提供背景

---

## 三、工具调用机制

### Claude 的输出格式

Claude 的每次输出由两部分组成：
1. **文本**：直接显示给用户
2. **工具调用（tool use）**：结构化的函数调用，包含工具名和参数

工具调用不是 Claude 自己执行的，Claude 只是"声明想调用什么"。

### 工具调用的执行主体

运行时（harness）负责：
- 接收 Claude 的工具调用声明
- 实际执行工具（运行 bash 命令、读写文件、触发 MCP 调用等）
- 将执行结果作为新的上下文返回给 Claude

Claude 看到的是结果，不是执行过程。

### Hooks

`settings.json` 里配置的 hooks 由运行时执行，不是 Claude 执行。触发时机由 hook 类型决定（如 `PreToolUse`、`PostToolUse`）。Claude 只能看到 hook 产生的反馈消息，不能控制 hook 的执行。

---

## 四、Skill 调用的完整链路

以 `/do` 为例（但 `disable-model-invocation: true` 使其对 Claude 不可见，这里仅作说明）：

```
用户输入 /do
  │
  ├─ 如果 skill 在列表里：Claude 调用 Skill 工具 → 运行时执行 SKILL.md 定义的逻辑
  │
  └─ 如果 skill 不在列表里（disable-model-invocation: true）：
        Claude 看不到该 skill，无法 invoke，用户需通过其他路径触发
```

`disable-model-invocation: true` 的效果：
- SKILL.md 存在于磁盘
- 但运行时在构建 system-reminder 时将其过滤，不注入到 skill 列表
- Claude 的上下文里没有这条记录，等同于不存在

---

## 五、记忆系统

Claude 的记忆是文件系统级别的持久化，不是模型权重级别的记忆。

- **存储位置**：`~/.claude/projects/<project-path>/memory/`
- **索引文件**：`MEMORY.md`，每次会话启动时自动加载到上下文
- **记忆类型**：`user`（用户画像）、`feedback`（行为偏好）、`project`（项目上下文）、`reference`（外部资源指针）
- **读取时机**：MEMORY.md 在每轮对话开始时自动注入；具体记忆文件需要 Claude 主动 Read

Claude 对记忆的感知：能看到 MEMORY.md 索引，需要主动读取具体文件才能获取详情。

---

## 六、Claude 明确不知道的部分

| 内容 | 原因 |
|------|------|
| SKILL.md 如何被读取和过滤 | 运行时内部逻辑，未在上下文中说明 |
| `disable-model-invocation` 的处理路径 | 同上 |
| Hooks 的具体执行方式 | 只知道"由 harness 执行"，无更多细节 |
| Workflow/Agent 的并发调度实现 | 只知道上限约束（max 16 并发，max 1000 agents） |
| 输出如何渲染给用户 | 输出后的事情 Claude 不感知 |
| system-reminder 的注入时机和来源 | 只能观察到结果，不知道构建过程 |

---

## 七、本次对话历史的实际内容（示例）

以当前这次对话为例，说明"对话历史"具体包含什么。

### 用户消息（5条）

1. 问当前 skills 中设置了 `disable-model-invocation: true` 的，Claude 能不能看到相关描述
2. "Tool results are attached"（运行时确认工具结果已返回）
3. 一段追问：`disable-model-invocation` 语义、harness 是什么、上下文中给了哪些 harness 信息、Claude 如何工作、输出到文档
4. "Tool results are attached"
5. 当前这条：问对话历史有哪些，并要求追加到文档

### Claude 回复（5条）

1. 声明"查 skills 配置"，调用两个 `Bash` 工具（find 文件 + cat SKILL.md）
2. 调用 `Read`（完整读 init/SKILL.md）+ `Bash`（grep 所有含该字段的 skill 文件）
3. 多段分析文本，依次回答：harness 的来源、上下文中的 harness 信息、skill 可见性机制；调用 `Bash`（提取 5 个 skill 的字段）；调用 `Write`（写文档）
4. 回答"对话历史有哪些"；调用 `Read`（读文档确认内容）
5. 当前这条（追加本节内容）

### 工具调用返回结果（每次工具调用都有对应返回，共约 8 次）

| 调用 | 返回内容摘要 |
|------|-------------|
| `Bash` find | 配置文件路径列表 + SKILL.md 路径列表 |
| `Bash` cat | init/SKILL.md 前几行 |
| `Read` | init/SKILL.md 完整内容（92行） |
| `Bash` grep | 5个含 `disable-model-invocation: true` 的文件路径 |
| `Bash` for loop | 5个 skill 的 name/description/flag 字段 |
| `Write` | "File created successfully" 确认 |
| `Read` | 文档完整内容（152行） |

### 说明

- "Tool results are attached" 是运行时的占位消息，表示上一轮工具调用结果已附加到上下文，用户本人没有输入实质内容
- 工具返回结果不是用户消息，也不是 Claude 回复，是独立的第三类内容
- system-reminder（skill 列表、当前日期等）附在每轮消息里，但不属于对话历史，不计入上述统计

---

## 八、核心约束总结

Claude 是一个**无状态函数**：

```
f(system_prompt + conversation_history + new_message) → text + tool_calls
```

- 没有持久状态，每轮对话都从完整上下文重新推断
- 只能使用上下文里定义的工具
- 只能 invoke system-reminder 里出现的 skill
- 看不到的东西对 Claude 等同于不存在
