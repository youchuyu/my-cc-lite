# skills 门禁表达弱化方案

## 背景

当前 `stage-preflight` hook 已经在 `UserPromptExpansion` 阶段读取结构化 hook 输入，通过 `command_name`、`cwd` 和当前 `.my-cc-lite/` 状态提前判断显式 slash command 的阶段入口条件。

现有 hook 行为分为两类：

- 硬阻断：返回 `decision: "block"`，阻止 slash command 展开进入模型。
- 软提示：返回 `hookSpecificOutput.additionalContext`，继续请求模型，但向当前阶段补充状态提示。

因此，`skills/*/SKILL.md` 中部分“项目是否初始化、是否存在 active task、是否缺少 plan/task”等入口门禁表达可以弱化，避免 hook、skill、script 三层重复讲同一件事。

但 skill 仍然不能完全删除阶段边界，因为：

- hook 只覆盖显式 `UserPromptExpansion` slash command，不等于所有调用路径。
- hook 只做入口静态检查，不负责阶段内流程编排。
- 阶段脚本仍是最终硬校验来源。
- skill 仍要约束模型在进入阶段后的判断、交接、脚本调用和禁止事项。

## 当前 hook 边界

`scripts/hooks/stage-preflight.mjs` 当前覆盖：

- 通用入口：
  - 未初始化时阻断 `/plan`、`/do`、`/verify`、`/archive`。
  - `project.json` 非法时阻断。
  - 多 active task 时阻断。
- `/plan`：
  - 已有 active task 时阻断新建计划。
- `/do`：
  - 只对 plan 入口条件硬阻断：无 active task、缺少 `plan.md`、`plan.md` 为空。
  - `task.json` 缺失、已存在、异常、tasks 已完成等只做上下文提示，不硬阻断。
- `/verify`：
  - 缺少 `task.json`、任务未全部完成或跳过、全部 skipped 等阻断。
- `/archive`：
  - 缺少 `task.json`、`taskId` 不一致、归档目标已存在、`verification.status !== "passed"` 等阻断。

## 总体修改原则

1. 弱化 skill 中重复的静态入口门禁描述。
2. 保留阶段内流程路由和模型判断约束。
3. 保留脚本调用、输入 JSON、禁止事项、完成反馈。
4. 保留脚本错误码处理，但改成“脚本兜底”口径，不再在 skill 中重复维护完整状态判断逻辑。
5. 不把 hook 当成唯一安全边界；阶段脚本仍是最终硬校验。
6. 文案改短，不引入新流程、新状态或新配置。

## 需要先确认的语义冲突

### `/archive` 的未通过归档

当前存在一个不一致：

- `stage-preflight` 对 `verification.status !== "passed"` 做硬阻断。
- `skills/archive/SKILL.md` 仍表达“如果用户明确要求归档，未验证通过也可以继续关闭任务”。

这两者必须二选一。

推荐选择：

```text
hook 不硬阻断 verification.status !== "passed"，只软提示。
```

理由：

- `/archive` 的设计语义是“关闭任务”，不等同于“完成任务”。
- 未通过任务是否关闭属于用户意图确认，不是纯静态状态错误。
- `verification.status !== "passed"` 更适合由 archive skill 在对话层说明风险并等待确认。

如果坚持当前 hook 硬阻断，则需要把 archive skill 中“用户明确要求可以继续”的语义删除，改成“必须先 `/verify passed` 才允许归档”。这会改变 `/archive` 的阶段语义。

## 文件级修改方案

### 1. `skills/do/SKILL.md`

#### 可弱化内容

当前“使用条件”中：

```text
当前工作目录必须是目标项目根目录。项目必须已执行 `/init`，且 `.my-cc-lite/tasks/` 下只能有一个未归档任务目录。
```

建议改成：

```text
当前工作目录应是目标项目根目录。显式 `/do` 的基础入口条件由 preflight hook 提前提示或阻断；进入 `/do` 后仍必须从 `scripts/run.mjs do inspect` 获取状态快照，并以脚本返回为准。
```

#### 入口检查可压缩

当前 `入口检查` 同时描述硬门禁和流程路由。建议保留流程路由，弱化门禁：

- 保留“每次从 `inspect` 开始”。
- 保留 `task.exists === false` 首次物化。
- 保留 `task.exists === true` 恢复检查。
- 保留所有 completed/skipped 时提示 `/verify`。
- 保留 blocked/failed 需要用户确认。
- 删除或压缩“PROJECT_NOT_INITIALIZED / NO_ACTIVE_TASK / MULTIPLE_ACTIVE_TASKS / PLAN_NOT_FOUND”逐项说明，改到错误处理里兜底。

建议结构：

```text
## 入口检查

1. 始终先调用 `scripts/run.mjs do inspect` 读取状态快照。
2. 如果 `inspect` 返回错误，按脚本错误码简短提示，不自行扫描或修复状态。
3. 如果 `inspect` 成功，只基于快照做静态路由：
   - 无 `task.json`：进入首次物化流程。
   - 有 `task.json`：进入恢复状态检查。
   - 全部 completed/skipped：停止并提示进入 `/verify`。
   - 只剩 blocked/failed：停止并请求用户确认恢复、重试、跳过或回到 `/plan`。
```

#### 必须保留内容

- 首次物化流程。
- 恢复状态检查。
- 接管方式选择。
- `executor -> verifier(task_review) -> update-task` 规则。
- 不重新物化、不改任务结构、不直接写 `task.json`。
- 脚本输入和禁止事项。

### 2. `skills/verify/SKILL.md`

#### 可弱化内容

当前 `进入条件` 详细列出项目初始化、当前任务唯一、`task.json` 可验收等条件。由于这些条件已经由 hook 和 verify 脚本兜底，可以压缩。

建议改成：

```text
## 进入条件

显式 `/verify` 的静态入口条件由 preflight hook 提前阻断，verify 阶段脚本也会再次硬校验。

进入 skill 后，只做两件事：

1. 基于脚本可读取的当前 `plan.md` 和 `task.json` 形成最终验收判断。
2. 如果脚本返回入口条件错误，按错误码提示下一步，不自行修改状态文件。
```

#### 可删除或合并内容

可删除当前“不满足条件时逐项提示”的重复清单，保留到 `错误处理` 中：

- 没有当前任务。
- 存在多个当前任务。
- 缺少 `task.json`。
- 仍有未完成 task。
- 全部 skipped。

这些信息已由 hook 阻断或脚本错误码表达。

#### 必须保留内容

- `plan.md` 是最终人类语义来源。
- `task.json.objective` 是执行目标快照。
- `passed / needs_fix / blocked` 的语义。
- repair task 规则。
- 不直接手写 `task.json`。
- 不自动调用 `/do` 或 `/archive`。

### 3. `skills/archive/SKILL.md`

#### 先调整 hook 语义

推荐先把 `stage-preflight` 中：

```text
verification.status !== "passed"
```

从硬阻断改成软提示。

也就是：

- 缺少 `task.json`：硬阻断。
- `taskId` 不一致：硬阻断。
- 归档目标已存在：硬阻断。
- `task.json` 非法：硬阻断。
- `verification.status !== "passed"`：软提示，让 archive skill 继续说明语义并确认用户意图。

#### 可弱化内容

当前 `进入条件` 的静态文件状态清单可压缩为：

```text
显式 `/archive` 的静态入口条件由 preflight hook 提前阻断，archive 阶段脚本也会再次硬校验。进入 skill 后，重点处理归档语义、用户关闭意图和 `archive.summary`。
```

#### 必须保留内容

- “归档只表示关闭任务，不代表完成”。
- 未 passed 时需要说明风险并确认用户关闭意图。
- `archive.summary` 生成规则。
- 不重新验证、不执行修复、不创建新任务。
- 脚本输入和错误处理。

#### 如果不调整 hook

如果仍保持 `verification.status !== "passed"` 硬阻断，则应删除 archive skill 中以下语义：

```text
如果用户已经明确要求归档，可以继续。
若任务未验证通过，且用户没有表达关闭未完成任务的意图，先说明风险并等待确认。
```

并把 `/archive` 重新定义为“只允许已验证通过任务归档”。不推荐这个方向。

### 4. `skills/plan/SKILL.md`

基本不需要改。

当前 `状态边界` 已经写明：

```text
`/plan` skill 不维护状态判断逻辑。能否创建新计划、项目是否已初始化、是否已有未归档任务，以 plan 阶段脚本的返回为准。
```

这与 hook 方向一致。

最多可以在 `使用条件` 中补一句：

```text
显式 `/plan` 的已初始化和 active task 冲突会由 preflight hook 提前提示或阻断；脚本仍是最终状态写入边界。
```

但不是必要修改。

### 5. `skills/init/SKILL.md`

不建议修改。

`/init` 主要是项目摘要和 helper 采集，不存在复杂门禁。当前 hook 也基本不拦 `/init`，除非发现多个 active task 这种异常状态。

## 建议修改顺序

1. 先调整 `stage-preflight` 的 `/archive verification.status !== "passed"` 行为，从硬阻断改为软提示。
2. 修改 `skills/do/SKILL.md`：
   - 弱化使用条件。
   - 压缩入口检查中的错误码门禁。
   - 保留流程路由。
3. 修改 `skills/verify/SKILL.md`：
   - 压缩进入条件。
   - 保留判断依据、结论处理和 repair task 规则。
4. 修改 `skills/archive/SKILL.md`：
   - 压缩静态入口条件。
   - 保留归档语义和确认逻辑。
5. 跑 smoke：

```bash
node test/smoke.mjs
```

## 验收标准

- skill 文案不再重复维护完整静态入口门禁。
- hook、skill、script 三者边界清楚：
  - hook：显式 slash command 的入口前置检查。
  - skill：阶段内流程编排和模型判断约束。
  - script：最终状态读写和硬校验。
- `/do` 的硬约束只围绕 plan 入口，不因 `task.json` 状态阻断正常执行。
- `/archive` 的未 passed 归档语义与 hook 行为一致。
- `node test/smoke.mjs` 通过。
