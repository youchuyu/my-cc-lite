# my-cc-lite 各阶段执行流程（分阶段展开）

> 每个阶段独立 mermaid 图，便于聚焦细读。

---

## 1. INIT — 项目初始化

```mermaid
flowchart LR
    classDef stageBox fill:#fff8f0,stroke:#e65100,stroke-width:2px
    classDef stateWrite fill:#ede7f6,stroke:#4527a0,stroke-width:2px,stroke-dasharray: 5 5
    classDef hookNote fill:#fffef5,stroke:#f9a825,stroke-width:1px,stroke-dasharray: 3 3,font-size:11px
    classDef routeBox fill:#f8f9fa,stroke:#78909c,stroke-width:1px
    classDef productBox fill:#e0f2f1,stroke:#00695c,stroke-width:1px

    START(["init"])
    START --> INIT_HOOK

    INIT_HOOK["UserPromptExpansion\nstage-preflight: 仅检查 activeTasks.count ≤ 1\nstage-context: 对 init 静默，不注入"]:::hookNote
    INIT_ANALYZE["分析项目结构\n识别项目类型"]:::stageBox
    INIT_SUMMARY["产出 projectSummary\n一句轻量项目摘要"]:::productBox
    INIT_HELPERS["产出 stageHelpers\n三个阶段 helper 清单"]:::stageBox

    subgraph HELPERS["stageHelpers 三阶段分类"]
        H_PLANNING["planning → /plan\n规划辅助、架构判断、\n风险识别、上下文分析"]:::productBox
        H_EXECUTION["execution → /do\n领域专项执行、\n外部自动化、委派 agent"]:::productBox
        H_REVIEW["review → /verify\ncode review、security review\nbug finding、验证诊断"]:::productBox
    end

    INIT_WRITE["Script: init init-project\n写入 project.json"]:::stateWrite

    INIT_HOOK --> INIT_ANALYZE --> INIT_SUMMARY
    INIT_ANALYZE --> INIT_HELPERS
    INIT_SUMMARY --> INIT_WRITE
    INIT_HELPERS --> H_PLANNING --> INIT_WRITE
    INIT_HELPERS --> H_EXECUTION --> INIT_WRITE
    INIT_HELPERS --> H_REVIEW --> INIT_WRITE

    INIT_WRITE --> TO_PLAN["→ 进入 /plan 阶段"]:::routeBox

    style START fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style HELPERS fill:#f8f9fa,stroke:#90a4ae,stroke-width:1px,stroke-dasharray: 3 3
```

---

## 2. PLAN — 任务计划

```mermaid
flowchart LR
    classDef stageBox fill:#fff8f0,stroke:#e65100,stroke-width:2px
    classDef stateWrite fill:#ede7f6,stroke:#4527a0,stroke-width:2px,stroke-dasharray: 5 5
    classDef hookNote fill:#fffef5,stroke:#f9a825,stroke-width:1px,stroke-dasharray: 3 3,font-size:11px
    classDef routeBox fill:#f8f9fa,stroke:#78909c,stroke-width:1px
    classDef decisionBox fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef agentBox fill:#e0f7fa,stroke:#00838f,stroke-width:2px

    PLAN_PREFLIGHT["UserPromptExpansion ①\nstage-preflight: 检查 project.json 存在且有效\n无 active task（count=0）"]:::hookNote
    PLAN_CONTEXT["UserPromptExpansion ②\nstage-context: 注入 projectSummary\n+ planning helpers\n+ execution skills（作为 Do 字段参考）"]:::hookNote
    PLAN_METHOD{"计划生成方式?"}:::decisionBox
    PLAN_NATIVE["my-cc-lite /plan 原生\n直接基于本地上下文\n生成 plan 草案"]:::stageBox
    PLAN_DELEGATE(("第三方规划 skill/agent\n如 plan-hunter workflow\n生成计划草案")):::agentBox
    PLAN_CONVERGE["收敛第三方草案\n适配 plan.md 格式"]:::stageBox
    PLAN_MERGE["确认定稿 final plan.md"]:::stageBox
    PLAN_WRITE["Script: plan create-task\n创建 tasks/taskId/ 目录\n写入 plan.md"]:::stateWrite

    PLAN_PREFLIGHT --> PLAN_CONTEXT --> PLAN_METHOD
    PLAN_METHOD -->|原生生成| PLAN_NATIVE
    PLAN_METHOD -->|第三方委派| PLAN_DELEGATE --> PLAN_CONVERGE
    PLAN_NATIVE --> PLAN_MERGE
    PLAN_CONVERGE --> PLAN_MERGE
    PLAN_MERGE --> PLAN_WRITE

    PLAN_WRITE --> TO_DO["→ 进入 /do 阶段"]:::routeBox
```

---

## 3. DO — 任务执行

```mermaid
flowchart LR
    classDef stageBox fill:#fff8f0,stroke:#e65100,stroke-width:2px
    classDef stateWrite fill:#ede7f6,stroke:#4527a0,stroke-width:2px,stroke-dasharray: 5 5
    classDef agentBox fill:#e0f7fa,stroke:#00838f,stroke-width:2px
    classDef routeBox fill:#f8f9fa,stroke:#78909c,stroke-width:1px
    classDef doneBox fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef backBox fill:#f1f8e9,stroke:#a5d6a7,stroke-width:1px,stroke-dasharray: 4 3
    classDef hookNote fill:#fffef5,stroke:#f9a825,stroke-width:1px,stroke-dasharray: 3 3,font-size:11px
    classDef decisionBox fill:#fff3e0,stroke:#e65100,stroke-width:2px

    subgraph PHASE_A["阶段 A — 检查与物化"]
        DO_PREFLIGHT["UserPromptExpansion ①\nstage-preflight: 检查 plan.md 存在且非空\ntask.json 若存在需 valid"]:::hookNote
        DO_CONTEXT["UserPromptExpansion ②\nstage-context: 注入 task 快照\n（status / stage / subtask 列表）"]:::hookNote
        DO_INSPECT["Script: do inspect\n读取当前 plan.md + task.json"]:::stageBox
        DO_EXISTS{"task.json 存在?"}:::decisionBox

        DO_PREFLIGHT --> DO_CONTEXT --> DO_INSPECT --> DO_EXISTS

        MATERIALIZER(("agent: task-materializer\n读 plan.md → 分解 subtasks")):::agentBox
        MAT_HOOK["SubagentStop ①\ndo-agent-chain: 解析 result 字段\n注入下一步提示"]:::hookNote
        MAT_RESULT{"result?"}:::decisionBox
        MAT_CONFIRM{"用户确认?"}:::decisionBox
        MATERIALIZE_WRITE["Script: do materialize\n写入 task.json\n（status: active, stage: executing）"]:::stateWrite
        BACK_TO_PLAN["→ /plan"]:::backBox

        DO_EXISTS -->|否| MATERIALIZER --> MAT_HOOK --> MAT_RESULT
        MAT_RESULT -->|ready| MATERIALIZE_WRITE
        MAT_RESULT -->|coarse_ready| MAT_CONFIRM
        MAT_CONFIRM -->|确认| MATERIALIZE_WRITE
        MAT_CONFIRM -->|取消| BACK_TO_PLAN
        MAT_RESULT -->|"needs_plan_update\nblocked"| BACK_TO_PLAN
    end

    subgraph PHASE_B["阶段 B — 执行循环"]
        NEXT_TASK{"还有 pending subtask?"}:::decisionBox
        EXECUTOR(("agent: executor\n执行当前 subtask")):::agentBox
        EXEC_HOOK["SubagentStop ②\ndo-agent-chain: 解析 result 字段\n注入下一步提示"]:::hookNote
        EXEC_RESULT{"executor result?"}:::decisionBox

        MATERIALIZE_WRITE --> NEXT_TASK
        DO_EXISTS -->|是| NEXT_TASK
        NEXT_TASK -->|是| EXECUTOR
        EXECUTOR --> EXEC_HOOK --> EXEC_RESULT
    end

    subgraph PHASE_C["阶段 C — 审核与调试"]
        TASK_REVIEW(("agent: verifier (task_review)\n审核单个 subtask 执行结果")):::agentBox
        REVIEW_HOOK["SubagentStop ③\ndo-agent-chain: 解析 result 字段\n注入下一步提示"]:::hookNote
        REVIEW_RESULT{"verifier result?"}:::decisionBox
        DEBUGGER(("agent: debugger\n定位根因 / 提出修复方案")):::agentBox
        DEBUG_HOOK["SubagentStop ④\ndo-agent-chain: 解析 result 字段\n注入下一步提示"]:::hookNote
        DEBUG_RESULT{"debugger result?"}:::decisionBox

        EXEC_RESULT -->|completed| TASK_REVIEW
        EXEC_RESULT -->|"failed\nblocked"| UPDATE_FAIL

        TASK_REVIEW --> REVIEW_HOOK --> REVIEW_RESULT
        REVIEW_RESULT -->|passed| UPDATE_PASS
        REVIEW_RESULT -->|needs_fix| DEBUGGER
        REVIEW_RESULT -->|blocked| UPDATE_BLOCKED

        DEBUGGER --> DEBUG_HOOK --> DEBUG_RESULT
        DEBUG_RESULT -->|fixed| TASK_REVIEW
        DEBUG_RESULT -->|suggested_fix| EXECUTOR
        DEBUG_RESULT -->|blocked| UPDATE_BLOCKED

        UPDATE_PASS["Script: do update-task\nstatus: completed"]:::stateWrite
        UPDATE_FAIL["Script: do update-task\nstatus: failed / blocked"]:::stateWrite
        UPDATE_BLOCKED["Script: do update-task\nstatus: blocked"]:::stateWrite

        UPDATE_PASS --> NEXT_TASK
        UPDATE_FAIL --> DO_STOP["停止执行\n→ /plan"]:::backBox
        UPDATE_BLOCKED --> DO_STOP
    end

    NEXT_TASK -->|否，全部完成| TO_VERIFY["→ 进入 /verify 阶段"]:::routeBox

    style PHASE_A fill:#f0f7ff,stroke:#90caf9
    style PHASE_B fill:#fff8f0,stroke:#ffcc80
    style PHASE_C fill:#fff0f3,stroke:#ef9a9a
```

---

## 4. VERIFY — 任务验收

```mermaid
flowchart LR
    classDef stageBox fill:#fff8f0,stroke:#e65100,stroke-width:2px
    classDef stateWrite fill:#ede7f6,stroke:#4527a0,stroke-width:2px,stroke-dasharray: 5 5
    classDef agentBox fill:#e0f7fa,stroke:#00838f,stroke-width:2px
    classDef doneBox fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef backBox fill:#f1f8e9,stroke:#a5d6a7,stroke-width:1px,stroke-dasharray: 4 3
    classDef hookNote fill:#fffef5,stroke:#f9a825,stroke-width:1px,stroke-dasharray: 3 3,font-size:11px
    classDef decisionBox fill:#fff3e0,stroke:#e65100,stroke-width:2px

    VERIFY_PREFLIGHT["UserPromptExpansion ①\nstage-preflight: 检查 task.json 存在\n所有 subtask 完成 / 至少一个 completed\n无 unfinished subtask"]:::hookNote
    VERIFY_CONTEXT["UserPromptExpansion ②\nstage-context: 注入 task 快照（含 subtask checks）\n+ review helpers"]:::hookNote
    FINAL_VERIFY(("agent: verifier (mode: final_verify)\n对比 plan.md 目标与执行结果\n产出 result + summary [+ repairTasks]")):::agentBox
    VERIFY_RESULT{"result?"}:::decisionBox

    VERIFY_PREFLIGHT --> VERIFY_CONTEXT --> FINAL_VERIFY --> VERIFY_RESULT

    VERIFY_PASS["Script: verify complete\nstatus: passed\n→ task.status: verified, stage: verified"]:::doneBox
    VERIFY_FIX["Script: verify complete\nstatus: needs_fix\n→ append repair tasks (R1, R2…)\ntask.status: active, stage: executing"]:::stateWrite
    VERIFY_BLOCKED_W["Script: verify complete\nstatus: blocked\n→ task.status: blocked, stage: verifying"]:::stateWrite

    VERIFY_RESULT -->|passed| VERIFY_PASS
    VERIFY_RESULT -->|needs_fix| VERIFY_FIX
    VERIFY_RESULT -->|blocked| VERIFY_BLOCKED_W

    VERIFY_PASS --> TO_ARCHIVE["→ 进入 /archive 阶段"]:::doneBox
    VERIFY_FIX --> BACK_TO_DO["→ /do（执行 repair tasks）"]:::backBox
    VERIFY_BLOCKED_W --> BACK_TO_PLAN["→ /plan（重新规划）"]:::backBox

    style VERIFY_PASS fill:#e0f2f1,stroke:#00695c
    style VERIFY_FIX fill:#fff8e1,stroke:#f57f17
    style VERIFY_BLOCKED_W fill:#fce4ec,stroke:#c62828
```

---

## 5. ARCHIVE — 任务归档

```mermaid
flowchart LR
    classDef stageBox fill:#fff8f0,stroke:#e65100,stroke-width:2px
    classDef stateWrite fill:#ede7f6,stroke:#4527a0,stroke-width:2px,stroke-dasharray: 5 5
    classDef routeBox fill:#f8f9fa,stroke:#78909c,stroke-width:1px
    classDef doneBox fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef backBox fill:#f1f8e9,stroke:#a5d6a7,stroke-width:1px,stroke-dasharray: 4 3
    classDef hookNote fill:#fffef5,stroke:#f9a825,stroke-width:1px,stroke-dasharray: 3 3,font-size:11px
    classDef decisionBox fill:#fff3e0,stroke:#e65100,stroke-width:2px

    ARCHIVE_PREFLIGHT["UserPromptExpansion\nstage-preflight: 检查 task.json 存在且 taskId 一致\n归档目标目录不存在\nstage-context: 对 archive 静默，不注入"]:::hookNote
    ARCHIVE_READ["读取 task.json\n确认 verification.status 语义"]:::stageBox
    ARCHIVE_GATE{"verification.status = passed\n或用户明确确认关闭?"}:::decisionBox

    ARCHIVE_PREFLIGHT --> ARCHIVE_READ --> ARCHIVE_GATE

    ARCHIVE_SUMMARY["生成 archive.summary\n（基于 objective + verification.summary + 状态）"]:::stageBox
    ARCHIVE_WRITE["Script: archive archive\n写入 archive.summary + archivedAt\n移动到 archived_tasks/taskId/"]:::stateWrite
    ARCHIVE_STOP["说明风险，等待用户确认\n（对话层确认，不写状态）"]:::routeBox

    ARCHIVE_GATE -->|是| ARCHIVE_SUMMARY --> ARCHIVE_WRITE
    ARCHIVE_GATE -->|否| ARCHIVE_STOP

    ARCHIVE_WRITE --> NEXT_PLAN["归档完成\n→ /plan 开始新任务"]:::backBox
    ARCHIVE_STOP --> KEEP_TASK["active task 保留"]:::routeBox
```

---

## 阶段间流转总览

```mermaid
flowchart LR
    classDef initFill fill:#e3f2fd,stroke:#1565c0,stroke-width:3px
    classDef planFill fill:#f1f8e9,stroke:#558b2f,stroke-width:3px
    classDef doFill fill:#fff8f0,stroke:#e65100,stroke-width:3px
    classDef verifyFill fill:#fff0f3,stroke:#c62828,stroke-width:3px
    classDef archiveFill fill:#f3e5f5,stroke:#7b1fa2,stroke-width:3px

    INIT["/init"]:::initFill
    PLAN["/plan"]:::planFill
    DO["/do"]:::doFill
    VERIFY["/verify"]:::verifyFill
    ARCHIVE["/archive"]:::archiveFill

    INIT -->|初始化完成| PLAN
    PLAN -->|创建 task| DO

    DO -.->|blocked / needs_plan_update| PLAN
    DO -->|全部完成| VERIFY

    VERIFY -.->|needs_fix| DO
    VERIFY -.->|blocked| PLAN
    VERIFY -->|passed| ARCHIVE

    ARCHIVE -->|归档完成| PLAN

    linkStyle default stroke-width:2px
```
