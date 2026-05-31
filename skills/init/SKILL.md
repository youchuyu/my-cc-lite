---
name: init
description: Initialize my-cc-lite stage-callable capability inventory
---

# my-cc-lite /init

Use this skill to initialize a small project-level inventory of external companion capabilities that my-cc-lite stages can directly use.

Use the helper from the installed plugin root while keeping the target project as the current working directory:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

If `CLAUDE_PLUGIN_ROOT` is unavailable, use the absolute path to the installed `my-cc-lite` plugin root. The skill directory is not the plugin root, so do not build a helper path under `skills/init/scripts/`.

For this checkout, the fallback helper path is:

```bash
MY_CC_LITE_HELPER="/Users/youchuyu/Desktop/ai/my-cc-lite/scripts/my-cc-lite-state.mjs"
```

## Rules

- Use only the current visible session context.
- Do not ask for, read, or reference logs, traces, request snapshots, or historical transcript files.
- Do not create a task or advance `plan`, `do`, `verify`, or `status`.
- Build a curated companion-capability index, not a complete dump of visible context.
- Empty buckets are valid. Do not add weak entries just to make a stage look populated.
- Include a capability only when a my-cc-lite stage can directly invoke or delegate to it as an optional helper.
- A capability may appear in multiple top-level categories only when it directly supports each listed stage. Do not duplicate a capability across stages just because it is generally useful.
- Exclude Claude Code native capabilities. This includes built-in tools such as `Bash`, `Read`, `Write`, `Edit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Task`, and native agents or skills such as `general-purpose`, `Plan`, `Explore`, `run`, and `verify`.
- Exception: if the `Workflow` tool is visible, classify it under `execution.tools` as a conditional multi-agent orchestration tool. Its description must state that invocation requires explicit opt-in such as the `ultrawork` keyword. Do not add `ultrawork` as a separate capability; it is only an opt-in signal for `Workflow`.
- Exclude my-cc-lite's own capabilities. This includes `my-cc-lite:init`, `my-cc-lite:plan`, `my-cc-lite:do`, `my-cc-lite:verify`, `my-cc-lite:status`, un-namespaced `init`, `plan`, `do`, `verify`, `status`, and the plugin's own planner, executor, verifier, and explore agents.
- Exclude configuration, recurring-loop, background-task, permission-management, transcript-cleanup, status-line, HUD, and setup utilities. Examples: `update-config`, `loop`.
- Exclude research-only capabilities by default. Include them only when their description clearly says they provide planning evidence for `/plan`; otherwise omit them.
- Do not put review, security review, bug sweep, or branch review capabilities in `execution` unless the capability explicitly performs execution work for `/do`, not just post-change assessment.
- Keep only capabilities that fit one of these buckets:
  - `skills`: skills the target stage can call, or skills that can replace the target stage skill.
  - `agents`: agents the target stage can delegate to for part or all of the stage responsibility.
  - `tools`: other callable abilities that the target stage can directly use, including MCP tools and callable tools exposed by companion plugins.
- Put unclear callable abilities in `tools` only when they are directly usable by a target stage and materially useful for that stage.
- Exclude commands, MCP servers, hooks, plugin containers, instruction text, configuration, HUD, status-line, permission-management, transcript-cleanup, research-only, and recurring-loop utilities.
- Exclude raw primitive tools by default, including file read/write/edit, shell, web fetch/search, notebook, task-list, scheduling, worktree, and generic user-question tools.
- If relevance is uncertain, omit the capability.

## Stage Routing

- `planning`: planning-specific companion skills or agents, such as multi-plan synthesis, architecture strategy, or risk planning.
- `execution`: non-native execution helpers that apply changes, run domain-specific automation, or operate project-specific workflows. Include review or research helpers here only when they explicitly perform `/do` execution work.
- `review`: review, security review, bug finding, branch review, verification evidence, and diagnostic companion capabilities.
- `Workflow` belongs in `execution.tools` when visible, because it executes deterministic multi-agent orchestration. Keep its `ultrawork` opt-in requirement in the description. Do not duplicate it into `planning` or `review`.

## Steps

1. Review the currently visible skills, agents, and directly callable tools.
2. Apply the inclusion rules above before classifying anything. Do not include a visible item merely because it exists in the context.
3. Classify each retained capability into every top-level category it directly supports, keeping the set as small as possible:
   - `planning`: capabilities the `/plan` stage can directly use.
   - `execution`: capabilities the `/do` stage can directly use.
   - `review`: capabilities the `/verify` stage can directly use.
4. Within each category, group entries under these buckets:
   - `skills`
   - `agents`
   - `tools`
5. Review duplicate capability names across categories. Keep cross-stage duplicates only when each entry has a direct stage-specific use; otherwise keep the strongest category.
6. Each entry must include:

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

Use `confidence: "high"` only when the stage fit is direct. Use `medium` only for a useful but conditional fit. Omit low-confidence entries.

When `Workflow` is visible, place it under `execution.tools` and use:

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

7. Send the complete JSON to the helper:

```bash
node "$MY_CC_LITE_HELPER" init-capabilities
```

Pass the JSON on stdin. The helper writes `.my-cc-lite/capabilities.json`, preserves existing `providers`, and refreshes the `inventory`.

## Output

- State that `.my-cc-lite/capabilities.json` was initialized.
- Summarize the number of capabilities found under `planning`, `execution`, and `review`.
- Recommend `/plan` as the next command when the user is ready to start a task.
