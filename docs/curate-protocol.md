# `brv curate` tool-mode session protocol

The session protocol lets a calling agent (Claude Code, Cursor, etc.) drive `brv curate` without byterover holding any LLM provider config. ByteRover orchestrates the multi-step flow; the calling agent supplies LLM completions across multiple CLI invocations.

This document defines the wire contract: CLI surface, JSON envelope, lifecycle. SKILL.md authors and other tool consumers key off the shapes documented here.

> **TKT 01 status.** The protocol surface and JSON envelope are stable. The orchestrator behind them is a placeholder — kickoff always emits one `needs-llm-step`, continuation always returns `done`. TKT 02 lands the real state machine. Wire-shape consumers can build against this contract today.

## CLI surface

### Kickoff — opt-in via `BRV_CURATE_TOOL_MODE=1`

```bash
BRV_CURATE_TOOL_MODE=1 brv curate "<user intent>" --format json
```

Without the env var, `brv curate` runs today's legacy agent-driven path (unchanged). The env var is the temporary opt-in; TKT 02 replaces it with a `BrvConfig` field.

### Continuation — `--session` implies tool mode

```bash
brv curate --session <sessionId> --response "<calling agent's output>" --format json
```

Presence of `--session` always means tool-mode continuation. The env var is not consulted on continuation calls.

### `--format text` fallback

Both kickoff and continuation accept `--format text` for shell users. The output is a terse human digest. The primary consumer (the calling agent) uses `--format json`.

## Wire envelope

Every kickoff and continuation call returns the same JSON envelope under the standard CLI wrapper:

```json
{
  "command": "curate",
  "success": <ok>,
  "data": {
    "ok": <bool>,
    "status": "done" | "needs-llm-step" | "failed",
    "sessionId": "<uuid>",       // present on needs-llm-step AND on transient failed (see below)
    "step": "generate-html" | "correct-html",
    "prompt": "<free-text>",      // free-text instruction for the calling agent's LLM
    "schema": { ... },            // optional per-step schema slice (TKT 03 populates)
    "errors": [                   // present on correct-html and on failed
      {
        "kind": "<machine-readable>",
        "tag": "<bv-element>?",
        "attribute": "<attribute-name>?",
        "message": "<human-readable>"
      }
    ],
    "filePath": "<relative-path>"  // present when status = done
  },
  "timestamp": "<iso>"
}
```

### Status values

| `status` | Meaning | Next action for calling agent |
|---|---|---|
| `needs-llm-step` | Byterover wants an LLM completion. `prompt` + `step` describe what. | Run the calling agent's own LLM on `prompt`, then `brv curate --session <sessionId> --response "<output>"`. |
| `done` | Curate complete. `filePath` is the location of the written topic. | Report success to user. Session is cleaned up. |
| `failed` | Terminal error. `errors[]` explains why. | Report failure to user; abandon session. |

### `step` values (when `status === 'needs-llm-step'`)

| `step` | Meaning | Expected `--response` payload |
|---|---|---|
| `generate-html` | First call asking the calling agent to author a `<bv-topic>` document. | The generated HTML. |
| `correct-html` | A previous response failed validation. `errors[]` enumerates what to fix. | Corrected HTML. |

### Error `kind` values

| `kind` | Lifecycle | Terminal? | Notes |
|---|---|---|---|
| `missing-content` | Kickoff | **terminal** | Kickoff invoked without a context argument; no session created |
| `missing-response` | Continuation | **terminal** | `--session` invoked without `--response`; session unaffected |
| `unknown-session` | Continuation | **terminal** | Session id doesn't exist, was already completed, or fails uuid validation |
| `empty-response` | Continuation | **transient** (session kept live) | Continuation received an empty `--response`; caller retries with the same `sessionId` |
| `missing-attribute` | Continuation (TKT 02) | **transient** | Schema validation found a missing required attribute; corrected via `correct-html` step |
| `unknown-element` | Continuation (TKT 02) | **transient** | Schema validation found a `<bv-*>` tag not in the registry |
| `unsafe-path` | Continuation (TKT 02) | **transient** | Generated topic's `path` attribute attempts traversal |

**Terminal vs transient.** Terminal failures end the session — the caller cannot retry the same `sessionId` and must start a new kickoff. Transient failures keep the session alive on disk; the envelope echoes the `sessionId` back and the caller is expected to issue a corrected continuation against it.

The list grows as TKT 02 + TKT 03 add real validation. Calling agents should switch on `kind`, fall back gracefully on unknown kinds, and surface the `message` text to the user.

## Lifecycle — worked example

A complete tool-mode curate session, end-to-end:

### 1. Kickoff

```bash
BRV_CURATE_TOOL_MODE=1 brv curate "remember we decided to use RS256" --format json
```

Response (placeholder):

```json
{
  "command": "curate",
  "success": true,
  "data": {
    "ok": true,
    "status": "needs-llm-step",
    "sessionId": "8c3f9e2a-...",
    "step": "generate-html",
    "prompt": "Generate a <bv-topic>...</bv-topic> HTML document for the following user intent:\n\nremember we decided to use RS256\n\n..."
  },
  "timestamp": "2026-05-11T12:00:00.000Z"
}
```

### 2. Calling agent's LLM produces HTML

```html
<bv-topic path="security/auth" title="JWT signing algorithm">
  <bv-decision id="d-rs256">Use RS256 over HS256.</bv-decision>
</bv-topic>
```

### 3. Continuation

```bash
brv curate --session 8c3f9e2a-... --response "<bv-topic ...>...</bv-topic>" --format json
```

Response (placeholder always succeeds on first continuation):

```json
{
  "command": "curate",
  "success": true,
  "data": {
    "ok": true,
    "status": "done",
    "filePath": "placeholder/8c3f9e2a-....html"
  },
  "timestamp": "2026-05-11T12:00:01.000Z"
}
```

Once TKT 02 ships the real orchestrator, validation may fail on the first continuation. The envelope then carries `status: "needs-llm-step"`, `step: "correct-html"`, and `errors[]` for the calling agent to fix in a retry round-trip. Maximum 3 corrections before `status: "failed"`.

## Session storage (TKT 01 placeholder)

CLI-side. Per-project, on disk at `<projectRoot>/.brv/sessions/curate-<sessionId>/state.json`. State is removed when the session reaches `done`. Abandoned sessions are not yet pruned — TKT 02 wires the 1-hour TTL when state moves into the daemon's existing task-session sandbox vars.

## Stability promise

Once SKILL.md (TKT 04) ships against this envelope, renaming any key here is a breaking change. New error kinds and new step values can be added without breaking existing consumers — calling agents are expected to gracefully ignore unknown values.

## What's not the protocol's job

- **HTML generation.** Calling agent's LLM authors the HTML per the `prompt`. Byterover never touches an LLM in tool mode.
- **Schema knowledge.** Embedded in the `prompt` (TKT 03 condenses the bv-* spec). Calling agent doesn't pre-load any schema.
- **Retry strategy beyond the protocol's correct-html loop.** If the calling agent's LLM keeps producing invalid HTML for 3 rounds, the session terminates `failed` — the calling agent surfaces this and falls back to asking the user for clarification.
