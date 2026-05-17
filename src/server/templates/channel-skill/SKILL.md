---
name: brv-channel
description: Use when the user asks to consult a *different* agent (kimi, opencode, codex, pi, etc.) for a second opinion, peer review, or focused subtask — trigger phrases include "ask @<agent>", "get a second opinion from", "have @<agent> review", "what does @<agent> think", "delegate this to @<agent>". Do not use for Claude-Code-to-Claude-Code coordination — use agent teams instead.
---

# Using brv channel for cross-host agent collaboration

## Core principle

brv channel is for **heterogeneous** multi-agent collaboration. Use it
when you need an answer from an agent **on a different model or
runtime** than yourself. For Claude-Code-to-Claude-Code coordination,
use agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); brv channel
is overkill there.

The interface is **the `brv channel` CLI**. Invoke it via your shell
tool. The CLI is at `{{BRV_BIN}}` (resolved at install time; if that
path doesn't work, fall back to whatever `brv` resolves to on the
user's PATH).

## When to use

Run `brv channel mention …` when the user says ANY of:

- "ask @\<agent\> to ..."
- "get a second opinion from @\<agent\>"
- "have @\<agent\> review ..."
- "what does @\<agent\> think about ..."
- "delegate this to @\<agent\>"

## When NOT to use

Do NOT call `brv channel mention` when:

- The user asks "what do YOU think" — they want your answer, not a peer's.
- The user asks to delegate a sub-task to another Claude Code instance —
  use the `Agent` tool or agent teams.
- The user asks to "save this conversation" or "share with X" — wrong
  primitive; channels are not a messaging app.
- You're tempted to use it to "double-check" your own answer. If your
  answer might be wrong, fix it; don't shop for confirmation.

## Steps

1. **Confirm a channel exists.** Run:

   ```bash
   {{BRV_BIN}} channel list --json
   ```

   Parse the JSON; check `channels[*].channelId`. If no relevant
   channel exists, ASK the user:
   > "Want me to create a channel for this? It's a one-time setup
   > (channels persist; we can reuse it later)."

   Do NOT silently run `brv channel new` — that's a human op.

2. **Confirm the target agent is a member.** From the same JSON,
   check `channels[*].members[*].handle`. If `@<target>` isn't there,
   tell the user verbatim:
   > "@\<target\> isn't in #\<channel\>. Run
   > `brv channel invite #\<channel\> @\<target\> --profile \<name\>`
   > from your terminal first."

3. **Mention the agent.** Run **exactly this shape** (substitute the
   bracketed values):

   ```bash
   {{BRV_BIN}} channel mention <channelId> "<prompt>" --mode sync --suppress-thoughts --json --timeout 300000
   ```

   - `<channelId>` is bare (no `#` prefix).
   - `<prompt>` MUST contain at least one `@<handle>` of a channel member.
   - `--mode sync` makes the CLI block until the turn completes.
   - `--suppress-thoughts` drops the reasoning trace at the daemon
     (saves bandwidth + disk; does NOT save wall-clock).
   - `--json` returns a structured object on stdout.
   - `--timeout 300000` is 5 minutes; sufficient for routine reviews.
     Use a smaller value (e.g. `120000`) only when the user has asked
     for a fast answer.

   The shell command blocks while the agent thinks; expect 30s–5min.

4. **Parse the JSON output.** stdout is a single JSON object:

   ```json
   {
     "channelId": "...",
     "turnId": "...",
     "finalAnswer": "...",
     "toolCalls": [...],
     "durationMs": 47312,
     "endedState": "completed"
   }
   ```

   The user-visible answer is `finalAnswer`. Quote it as you would
   quote any source that isn't yourself. Attribute it to `@<target>`,
   not to yourself.

5. **If the command exits non-zero**, stdout will contain
   `{"success": false, "code": "...", "error": "..."}`. Surface the
   error code verbatim to the user. Common codes:
   - `BRV_DAEMON_NOT_INITIALISED` — user must run any `brv` command
     once in their terminal to boot the daemon.
   - `CHANNEL_SYNC_TIMEOUT` — the agent took longer than the timeout.
     Suggest a higher `--timeout` or a more focused prompt.
   - `CHANNEL_NOT_FOUND` — channel doesn't exist; offer to ask the
     user to create it.
   - `CHANNEL_MEMBER_NOT_FOUND` — the `@<handle>` you used isn't a
     channel member.
   - `CHANNEL_MENTION_EMPTY` — the prompt didn't contain a parseable
     `@<handle>`. Add one.

## Red flags — STOP and reconsider

- **You're running `brv channel mention` to get an answer YOU could
  give.** The user asked for a peer's opinion. Re-read the request:
  if they said "what do you think", they want your answer.
- **You're calling it twice in a row for the same question to
  "double-check".** If the first answer is wrong, ask the same agent
  to revisit; don't poll.
- **The user is having an iterative back-and-forth and you call
  `brv channel mention` on every turn.** brv channel is one-shot per
  turn; conversation context stays on YOUR side. Carry it forward.
- **You're tempted to use `brv channel mention` to send the user a
  status update.** It's not a notification mechanism.
- **You silently ran `brv channel new` or `brv channel invite`.**
  Those are human operations; ask the user instead.

## Quick reference

| Want to ... | Run ... |
|---|---|
| Ask `@kimi` to review a file | `{{BRV_BIN}} channel mention <ch> "@kimi <prompt>" --mode sync --suppress-thoughts --json` |
| See what channels exist | `{{BRV_BIN}} channel list --json` |
| Read a past turn's transcript | `{{BRV_BIN}} channel show <ch> <turnId> --json` |
| Check which agents are healthy | `{{BRV_BIN}} channel doctor --json` |
| Coordinate with another Claude Code | **agent teams**, not brv channel |
| Create a channel | Tell the user to run `brv channel new <id>` |
| Invite/remove a member | Tell the user — these are human-only ops |
| Approve/deny a pending permission | Tell the user to run `brv channel permission-decision …` |

## Common misapplications

| Tempted to ... | Don't, because ... | Do instead |
|---|---|---|
| Use brv channel as your "scratchpad" | Channels are durable transcripts visible to other agents — not private notes | Use TodoWrite or your own context |
| Drop `--suppress-thoughts` for routine tasks | The thought trace is ~20× longer than the answer and adds 100s+ of seconds of bandwidth + disk | Always pass `--suppress-thoughts` unless debugging an agent that's giving bad answers |
| Drop `--mode sync` | Without sync, the CLI returns the dispatch ack immediately and turn events stream — useless for a non-interactive shell call | Always pass `--mode sync` |
| Drop `--json` | Without `--json` you get human-rendered streaming output; brittle to parse | Always pass `--json` |
| Mention every member when in doubt | Each mention is a billed turn against that agent's model | Single targeted mention to the agent most likely to know |
| Use brv channel for Claude-Code-to-Claude-Code | Redundant with agent teams which is faster and bidirectional | Agent teams |
| Use mention to ask an agent for a file's contents | The agent's filesystem may differ from the user's | Read the file yourself with `Read`/`Bash`, then include relevant excerpts in the prompt |
| Pass a multi-paragraph prompt that mixes several questions | The agent will burn time on the least-important parts | Break it into focused mentions, one question each |

## Worked example

User: *"Ask kimi to review src/auth.py for token-leak risks via the
review-2026 channel."*

You:

1. Run `{{BRV_BIN}} channel list --json` — confirm `review-2026` exists
   and `@kimi` is a member.
2. Run `Read src/auth.py` so you have the content.
3. Run the mention:

   ```bash
   {{BRV_BIN}} channel mention review-2026 "@kimi review the following for token-leak risks; be terse:

   <paste relevant excerpts from src/auth.py>" --mode sync --suppress-thoughts --json --timeout 180000
   ```

4. Parse the JSON, extract `finalAnswer`.
5. Reply to the user:
   > **Kimi's review of src/auth.py:**
   >
   > [paste finalAnswer]
   >
   > Want me to fix the issues kimi flagged?

If the shell command times out or errors, surface the `code` field
verbatim and stop — don't retry silently.

## Multi-agent fan-out + gather (push, not poll)

When you want to ask **multiple agents** the same question in parallel and
wait for all of them — e.g. independent reviews from kimi + codex — use
the dispatch-async + subscribe pattern instead of N serial sync mentions:

1. **Dispatch** each member with `--no-wait --json` (returns immediately
   with the assigned turnId):

   ```bash
   {{BRV_BIN}} channel mention review-2026 "@kimi review src/auth.py" --no-wait --json
   # parse turnId from stdout
   {{BRV_BIN}} channel mention review-2026 "@codex review src/auth.py" --no-wait --json
   # parse second turnId
   ```

2. **Subscribe** to wait for both terminal-delivery events without
   polling — the command exits as soon as `--count` is reached:

   ```bash
   {{BRV_BIN}} channel subscribe review-2026 \
     --roles @kimi,@codex \
     --kinds delivery_state_change \
     --count 2 \
     --exit-on-terminal \
     --json
   ```

3. **Read** each turn's `finalAnswer` via `channel show <ch> <turnId>
   --json` and synthesize the response.

**When to choose mention --mode sync vs subscribe quorum:**
- Single agent, one question → `mention --mode sync` (simpler).
- ≥2 agents in parallel, or you need a turnId before the result is
  ready → `mention --no-wait` then `subscribe --count N`.

**`subscribe` flag reference (Slice 8.9):**
- `--roles @a,@b` filter by member handle
- `--kinds delivery_state_change,turn_state_change` filter by event kind
- `--turn <id>` scope to a single turnId
- `--after-seq <n>` exclusive cursor (skip events with seq ≤ n) — used
  for crash-recovery from a known cursor
- `--count N` exit after N unique `(turnId, memberHandle)` terminal
  delivery events
- `--exit-on-terminal` exit on the first `turn_state_change → completed/cancelled`
- `--timeout <ms>` hard timeout
- `--json` (default true) emit newline-delimited JSON

## Permission requests

If an agent's turn includes a `permission_request` event (the agent is
asking for permission to write a file, run a command, etc.), the user's
host LLM must respond before the turn can continue:

- `{{BRV_BIN}} channel approve <ch> <turnId> <permissionRequestId> --json`
  resolves with the first `allow*`-flavoured option.
- `{{BRV_BIN}} channel deny <ch> <turnId> <permissionRequestId> --json`
  resolves with the first `reject*`-flavoured option.
- `--option-id <id>` overrides the default for explicit choice.

The `permissionRequestId` comes from the `permission_request` event in
the turn's stream. Use `{{BRV_BIN}} channel show <ch> <turnId> --json`
to locate it if you've lost it.

## Error recovery

| Error code | Means | What to do |
|---|---|---|
| `CHANNEL_PERMISSION_LOST_ON_RESTART` | The brv daemon restarted while a delivery was awaiting a permission decision. The ACP subprocess is dead; the user's choice cannot be forwarded. The error message contains a `--after-seq` cursor pointing at the daemon-written `errored` event. | **Do NOT retry the approve** — the in-flight session is unrecoverable. Re-invite the affected member (re-spawns the ACP subprocess), then re-mention with the original context. Optionally use the supplied `brv channel subscribe <ch> --turn <id> --after-seq <n>` command to inspect the lost-permission event. |
| `CHANNEL_DRIVER_NOT_REGISTERED` | No live ACP driver for this `(channelId, memberHandle)`. Usually fires in the brief race window after a daemon restart but BEFORE `warmDriversForProject` has finished spawning drivers from `meta.json` (Slice 8.11 auto-warm). | **First try**: wait ~2 seconds and retry the same mention — the auto-warm typically completes within that window. If it still fails: re-invite the member with `brv channel invite <ch> @handle --profile <name>` to force-spawn a fresh subprocess. Carried on `delivery.errorCode`, `failedDeliveries[*].code`, AND the `delivery_state_change → errored` event's `errorCode` field (visible via `subscribe`/`watch`). |
| `CHANNEL_TURN_NOT_FOUND` | The turn id genuinely doesn't exist in this channel. | Verify the channel id and turn id; don't retry blindly. |

