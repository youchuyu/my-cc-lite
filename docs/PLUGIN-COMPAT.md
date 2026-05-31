# my-cc-lite Plugin Compatibility

Companion plugins are optional. The core must keep working when none are installed.

## Integration Points

Companion plugins may:

- read `.my-cc-lite/state.json`
- read `.my-cc-lite/plan.md`
- append events to `.my-cc-lite/events.jsonl`
- write artifacts under `.my-cc-lite/artifacts/<provider>/`
- register capabilities in `.my-cc-lite/capabilities.json`

They should not mutate core-owned state fields directly.

Manual examples below use `MY_CC_LITE_HELPER` for the installed helper path:

```bash
MY_CC_LITE_HELPER="$CLAUDE_PLUGIN_ROOT/scripts/my-cc-lite-state.mjs"
```

Run helper commands from the target project so `.my-cc-lite/` state is written to that project.

## Register A Capability

Create `capability.json`:

```json
{
  "provider": "verification.browser",
  "type": "verification",
  "plugin": "my-cc-lite-browser",
  "commands": ["/browser-test"],
  "events": ["verification.evidence.added", "verification.failed"],
  "artifacts": ["screenshot", "console-log"],
  "description": "Runs browser checks and contributes UI evidence"
}
```

Then run:

```bash
node "$MY_CC_LITE_HELPER" register-capability capability.json
```

## Add Verification Evidence

Create `evidence.json`:

```json
{
  "source": "my-cc-lite-browser",
  "summary": "Home page loaded without console errors",
  "status": "passed",
  "path": ".my-cc-lite/artifacts/browser/home.png"
}
```

Then run:

```bash
node "$MY_CC_LITE_HELPER" add-evidence evidence.json
```

Alternatively append a raw event:

```json
{"version":1,"runId":"run-id","source":"my-cc-lite-browser","type":"verification.evidence.added","timestamp":"2026-05-31T12:20:00.000Z","payload":{"summary":"Home page loaded","status":"passed"}}
```

## Read-only HUD Example

A HUD plugin should read `state.json` and recent events, then render status. It should usually write nothing. If it needs to record display metadata, write under:

```json
{
  "extensions": {
    "my-cc-lite-hud": {
      "lastRenderedAt": "2026-05-31T12:20:00.000Z"
    }
  }
}
```

## Failure Handling

- Unknown event types are ignored but preserved.
- Malformed event lines are ignored and reported by `/status`.
- Missing companion plugins are not errors.
- Failed companion verification should append `verification.failed` or add evidence with `"status": "failed"`.
