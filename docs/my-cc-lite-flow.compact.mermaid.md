# my-cc-lite 完整执行流程（紧凑版）

```mermaid
flowchart TD
    classDef stage fill:#fff8f0,stroke:#e65100,stroke-width:2px
    classDef script fill:#ede7f6,stroke:#4527a0,stroke-width:2px,stroke-dasharray:5 5
    classDef agent fill:#e0f7fa,stroke:#00838f,stroke-width:2px
    classDef hook fill:#fffef5,stroke:#f9a825,stroke-width:1px,stroke-dasharray:3 3
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:1px
    classDef done fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef back fill:#f1f8e9,stroke:#a5d6a7,stroke-width:1px,stroke-dasharray:4 3

    %% ── INIT ──────────────────────────────────────────
    INIT_CMD(["/init"])
    INIT_PRE["preflight + context hooks"]:::hook
    INIT_WORK["分析项目结构\n生成 projectSummary + stageHelpers"]:::stage
    INIT_SCRIPT["run.mjs init init-project\n→ .my-cc-lite/project.json"]:::script

    INIT_CMD --> INIT_PRE --> INIT_WORK --> INIT_SCRIPT

    %% ── PLAN ──────────────────────────────────────────
    PLAN_CMD(["/plan"])
    PLAN_PRE["preflight: project.json 存在 & 无 active task\ncontext: 注入 projectSummary + execution skills"]:::hook
    PLAN_WORK["生成 plan.md\n（含 Objective / Plan / Checks）"]:::stage
    PLAN_SCRIPT["run.mjs plan create-task\n→ .my-cc-lite/tasks/taskId/plan.md"]:::script

    PLAN_CMD --> PLAN_PRE --> PLAN_WORK --> PLAN_SCRIPT

    %% ── DO ────────────────────────────────────────────
    DO_CMD(["/do"])
    DO_PRE["preflight: plan.md 存在\ncontext: 注入 task 快照（subtask 状态）"]:::hook
    DO_INSPECT["run.mjs do inspect\n检查 task.json 是否存在"]:::script
    DO_EXISTS{"task.json 存在?"}:::decision

    DO_CMD --> DO_PRE --> DO_INSPECT --> DO_EXISTS

    MATERIALIZER(["agent: task-materializer\n从 plan.md 分解 subtasks"]):::agent
    MATERIALIZE_RESULT{"result?"}:::decision
    MATERIALIZE_WRITE["run.mjs do materialize\n→ task.json（subtasks 初始化）"]:::script

    DO_EXISTS -->|否| MATERIALIZER
    MATERIALIZER -->|"ready"| MATERIALIZE_WRITE
    MATERIALIZER -->|"coarse_ready\n用户确认后"| MATERIALIZE_WRITE
    MATERIALIZER -->|"needs_plan_update\nblocked"| BACK_PLAN_M["→ /plan"]:::back

    EXEC_LOOP{"还有 pending subtask?"}:::decision
    EXECUTOR(["agent: executor\n执行当前 subtask"]):::agent
    EXEC_HOOK["SubagentStop hook: do-agent-chain\n解析 result 字段，注入下一步提示"]:::hook
    EXEC_RESULT{"executor result?"}:::decision

    DO_EXISTS -->|是| EXEC_LOOP
    MATERIALIZE_WRITE --> EXEC_LOOP
    EXEC_LOOP -->|是| EXECUTOR
    EXECUTOR --> EXEC_HOOK --> EXEC_RESULT

    TASK_REVIEW(["agent: verifier (task_review)\n审核单个 subtask 执行结果"]):::agent
    REVIEW_HOOK["SubagentStop hook: do-agent-chain"]:::hook
    REVIEW_RESULT{"verifier result?"}:::decision
    DEBUGGER(["agent: debugger\n定位根因 / 提出修复方案"]):::agent
    DEBUG_HOOK["SubagentStop hook: do-agent-chain"]:::hook

    EXEC_RESULT -->|"completed"| TASK_REVIEW
    EXEC_RESULT -->|"failed / blocked"| UPDATE_FAIL["run.mjs do update-task\nstatus: failed / blocked"]:::script

    TASK_REVIEW --> REVIEW_HOOK --> REVIEW_RESULT
    REVIEW_RESULT -->|"passed"| UPDATE_PASS["run.mjs do update-task\nstatus: completed"]:::script
    REVIEW_RESULT -->|"needs_fix"| DEBUGGER
    REVIEW_RESULT -->|"blocked"| UPDATE_BLOCKED["run.mjs do update-task\nstatus: blocked"]:::script

    DEBUGGER --> DEBUG_HOOK --> EXECUTOR

    UPDATE_PASS --> EXEC_LOOP
    UPDATE_FAIL --> DO_STOP["停止 / → /plan"]:::back
    UPDATE_BLOCKED --> DO_STOP

    EXEC_LOOP -->|否，全部完成| TO_VERIFY(["→ /verify"])

    %% ── VERIFY ────────────────────────────────────────
    VERIFY_CMD(["/verify"])
    VERIFY_PRE["preflight: 所有 subtask 完成 / 至少一个 completed\ncontext: 注入 task 快照 + review helpers"]:::hook
    FINAL_VERIFIER(["agent: verifier (final_verify)\n全局验收：对比 plan.md 目标与执行结果"]):::agent
    VERIFY_RESULT{"verifier result?"}:::decision
    VERIFY_PASS["run.mjs verify complete\nstatus: passed → task.status: verified"]:::script
    VERIFY_FIX["run.mjs verify complete\nstatus: needs_fix → append repair tasks"]:::script
    VERIFY_BLOCKED_W["run.mjs verify complete\nstatus: blocked"]:::script

    VERIFY_CMD --> VERIFY_PRE --> FINAL_VERIFIER --> VERIFY_RESULT
    VERIFY_RESULT -->|"passed"| VERIFY_PASS
    VERIFY_RESULT -->|"needs_fix"| VERIFY_FIX
    VERIFY_RESULT -->|"blocked"| VERIFY_BLOCKED_W

    VERIFY_FIX --> BACK_DO["→ /do（执行 repair tasks）"]:::back
    VERIFY_BLOCKED_W --> BACK_PLAN_V["→ /plan（重新规划）"]:::back

    %% ── ARCHIVE ───────────────────────────────────────
    ARCHIVE_CMD(["/archive"])
    ARCHIVE_PRE["preflight: task verified 或用户确认关闭\n(未验证通过时说明语义、等待确认)"]:::hook
    ARCHIVE_WRITE["run.mjs archive archive\n写入 archive.summary\n移动到 archived_tasks/taskId/"]:::script
    DONE(["归档完成 → /plan 开始新任务"]):::done

    VERIFY_PASS --> ARCHIVE_CMD
    ARCHIVE_CMD --> ARCHIVE_PRE --> ARCHIVE_WRITE --> DONE

    %% ── 阶段间回流 ─────────────────────────────────────
    INIT_SCRIPT --> PLAN_CMD
    PLAN_SCRIPT --> DO_CMD
    TO_VERIFY --> VERIFY_CMD
```

## 关键约定

| 层 | 职责 |
|---|---|
| **Hooks（只读）** | `stage-preflight`：结构性检查，不通过则硬阻断；`stage-context`：注入阶段快照；`do-agent-chain`：解析 agent 输出、注入下一步提示 |
| **Agents（不写状态）** | `task-materializer` 分解 plan → subtasks；`executor` 执行；`verifier` 审核（task_review / final_verify）；`debugger` 诊断 |
| **Scripts（持久化）** | `run.mjs <stage> <action>` 是唯一写 `.my-cc-lite/` 的入口；CWD 始终为目标项目根 |
| **状态文件** | `project.json`（全局）、`tasks/<id>/plan.md`（只读参考）、`tasks/<id>/task.json`（执行状态）、`archived_tasks/<id>/`（归档） |
