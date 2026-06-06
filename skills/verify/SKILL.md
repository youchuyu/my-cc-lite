---
name: verify
description: 验证一次 my-cc-lite 运行并记录证据
argument-hint: ""
---

# my-cc-lite /verify

使用此 skill 验证已完成工作，并且只有在证据支持完成时才将运行标记为完成。

在保持目标项目为当前工作目录的同时，从已安装插件根目录使用 helper：

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

## 步骤

1. 读取 `.my-cc-lite/current-task.json`、该任务的 `workflow.json`、`plan.md`、`events.jsonl`，以及 `.my-cc-lite/capabilities.json`。
2. 如果必需条目仍为 pending 或 in progress，不要通过验证。推荐 `/do`。
3. 针对已变更文件和验收标准运行相关本地检查。
4. 添加每个证据条目：

```bash
node "$MY_CC_LITE_HELPER" add-evidence
```

必要时通过 stdin 传入 JSON：

```json
{"source":"my-cc-lite","summary":"npm test passed","status":"passed","command":"npm test"}
```

5. 消费类型为 `verification.evidence.added` 或 `verification.failed` 的伴随插件事件。
6. 如果证据充分，运行：

```bash
node "$MY_CC_LITE_HELPER" set-verification passed
```

7. 如果检查失败或证据不完整，运行：

```bash
node "$MY_CC_LITE_HELPER" set-verification failed
```

## 输出

- 使用的验证命令或检查
- 证据列表
- 通过/失败结果
- 下一步操作
