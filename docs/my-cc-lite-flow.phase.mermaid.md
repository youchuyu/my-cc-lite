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

    INIT_HOOK["Hook: preflight/context"]:::hookNote
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

    PLAN_PREFLIGHT["Hook: stage-preflight\n检查 /plan 是否可进入"]:::hookNote
    PLAN_CONTEXT["Hook: stage-context\n注入 /do execution helpers\n作为计划阶段执行建议"]:::hookNote
    PLAN_METHOD{"计划生成方式?"}:::decisionBox
    PLAN_NATIVE["my-cc-lite /plan 原生\n直接基于本地上下文\n生成 plan 草案"]:::stageBox
    PLAN_DELEGATE(("第三方规划 skill/agent\n如 plan-hunter workflow\n生成计划草案")):::agentBox
    PLAN_CONVERGE["收敛第三方草案\n适配 plan.md 格式"]:::stageBox
    PLAN_MERGE["确认定稿 final plan.md"]:::stageBox
    PLAN_WRITE["Script: plan create-task\n创建 active task\n写入 plan.md"]:::stateWrite

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
        DO_HOOK["Hook: preflight"]:::hookNote
        DO_INSPECT["Script: do inspect\n检查当前状态"]:::stageBox
        DO_EXISTS{"task.json 存在?\n（已有物化任务？）"}:::decisionBox

        DO_HOOK --> DO_INSPECT --> DO_EXISTS

        MATERIALIZER(("agent: task-materializer\n从 plan.md 物化 coarse task")):::agentBox
        MATERIALIZER_RESULT{"物化结果?"}:::decisionBox
        MATERIALIZER_CONFIRM{"用户确认\ncoarse task?"}:::decisionBox
        MATERIALIZE_WRITE["Script: do materialize\n写入 task.json"]:::stateWrite
        BACK_TO_PLAN["回到 /plan\nneeds_plan_update / blocked"]:::backBox

        DO_EXISTS -->|否| MATERIALIZER --> MATERIALIZER_RESULT
        MATERIALIZER_RESULT -->|ready| MATERIALIZE_WRITE
        MATERIALIZER_RESULT -->|coarse_ready| MATERIALIZER_CONFIRM
        MATERIALIZER_CONFIRM -->|确认| MATERIALIZE_WRITE
        MATERIALIZER_CONFIRM -->|取消| BACK_TO_PLAN
        MATERIALIZER_RESULT -->|needs_plan_update / blocked| BACK_TO_PLAN
    end

    subgraph PHASE_B["阶段 B — 接管与执行"]
        TAKEOVER{"接管方式?"}:::decisionBox
        TAKEOVER -->|原生接管| EXECUTOR

        EXTERNAL_WRITE["外部高阶接管\nScript: do update-task"]:::stateWrite

        TAKEOVER -->|外部接管| EXTERNAL_WRITE --> CHECK_ALL_DONE_B

        EXECUTOR(("agent: executor\n执行具体 task")):::agentBox
        EXECUTOR_HOOK["Hook: do-agent-chain"]:::hookNote
        EXECUTOR_RESULT{"executor 结果?"}:::decisionBox

        MATERIALIZE_WRITE --> TAKEOVER
        DO_EXISTS --->|是| TAKEOVER
        EXECUTOR --> EXECUTOR_HOOK --> EXECUTOR_RESULT
    end

    subgraph PHASE_C["阶段 C — 审核与调试"]
        TASK_REVIEW(("agent: verifier\n(task_review)\n审核执行结果")):::agentBox
        REVIEW_HOOK["Hook: do-agent-chain"]:::hookNote
        REVIEW_RESULT{"verifier 结果?"}:::decisionBox
        DEBUGGER(("agent: debugger\n定位失败根因")):::agentBox

        EXECUTOR_RESULT -->|completed| TASK_REVIEW --> REVIEW_HOOK --> REVIEW_RESULT
        EXECUTOR_RESULT -->|failed / blocked| UPDATE_TASK_FAIL

        REVIEW_RESULT -->|passed| UPDATE_TASK_PASS
        REVIEW_RESULT -->|needs_fix| DEBUGGER --> EXECUTOR
        REVIEW_RESULT -->|blocked| UPDATE_TASK_BLOCKED

        UPDATE_TASK_PASS["Script: do update-task\nstatus: completed"]:::stateWrite
        UPDATE_TASK_FAIL["Script: do update-task\nstatus: failed/blocked"]:::stateWrite
        UPDATE_TASK_BLOCKED["Script: do update-task\nstatus: blocked"]:::stateWrite

        UPDATE_TASK_PASS --> CHECK_ALL_DONE_C
        UPDATE_TASK_FAIL --> DO_BLOCKED
        UPDATE_TASK_BLOCKED --> DO_BLOCKED

        DO_BLOCKED["停止执行"]:::doneBox
    end

    DO_BLOCKED --> BACK_PLAN_DO["→ /plan"]:::backBox

    CHECK_ALL_DONE_B{"全部 task 完成?"}:::decisionBox
    CHECK_ALL_DONE_C{"全部 task 完成?"}:::decisionBox

    EXTERNAL_WRITE --> CHECK_ALL_DONE_B
    CHECK_ALL_DONE_B -->|否| EXECUTOR
    CHECK_ALL_DONE_B -->|是| TO_VERIFY

    UPDATE_TASK_PASS --> CHECK_ALL_DONE_C
    CHECK_ALL_DONE_C -->|否| EXECUTOR
    CHECK_ALL_DONE_C -->|是| TO_VERIFY

    TO_VERIFY["→ 进入 /verify 阶段"]:::routeBox

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

    VERIFY_HOOK["Hook: preflight"]:::hookNote
    FINAL_VERIFY(("agent: verifier\n(final_verify)\n全局验收")):::agentBox
    VERIFY_RESULT{"验收结论?"}:::decisionBox

    VERIFY_HOOK --> FINAL_VERIFY --> VERIFY_RESULT

    VERIFY_PASSED["Script: verify complete\nstatus: verified"]:::doneBox
    VERIFY_REPAIR["append repair tasks\n回到 /do 修复"]:::backBox
    VERIFY_BLOCKED["write blocked\n回到 /plan 重规划"]:::backBox

    VERIFY_RESULT -->|passed| VERIFY_PASSED
    VERIFY_RESULT -->|needs_fix| VERIFY_REPAIR
    VERIFY_RESULT -->|blocked| VERIFY_BLOCKED

    VERIFY_PASSED --> TO_ARCHIVE["→ 进入 /archive 阶段"]:::doneBox
    VERIFY_REPAIR --> BACK_TO_DO["→ /do（执行 repair task）"]:::backBox
    VERIFY_BLOCKED --> BACK_TO_PLAN["→ /plan（重新规划）"]:::backBox

    style VERIFY_PASSED fill:#e0f2f1,stroke:#00695c
    style VERIFY_REPAIR fill:#fff8e1,stroke:#f57f17
    style VERIFY_BLOCKED fill:#fce4ec,stroke:#c62828
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

    ARCHIVE_HOOK["Hook: preflight"]:::hookNote
    ARCHIVE_GATE{"verified 通过\n或用户确认关闭?"}:::decisionBox

    ARCHIVE_HOOK --> ARCHIVE_GATE

    ARCHIVE_WRITE["Script: archive archive\n移动到 archived_tasks"]:::stateWrite
    ARCHIVE_STOP["保留 active task\n不归档"]:::routeBox

    ARCHIVE_GATE -->|是| ARCHIVE_WRITE
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
