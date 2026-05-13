---
name: brv-channel
description: Use brv channel via the channel-mcp tool when the user asks to consult a *different* agent (kimi, opencode, etc.) for a second opinion, code review, or focused subtask. Never use brv channel for Claude-Code-to-Claude-Code coordination — use agent teams instead.
---

# Using brv channel for cross-host agent collaboration

## Core principle

brv channel is for **heterogeneous** multi-agent collaboration. Use it
when you need an answer from an agent **on a different model or
runtime** than yourself. For Claude-Code-to-Claude-Code coordination,
use agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); brv channel
is overkill there.

The wire surface lives in the `channel-mcp` server. Four tools:
`channel.list`, `channel.mention`, `channel.show`, `channel.doctor`.

## When to use

Call `channel.mention` when the user says ANY of:

- "ask @\<agent\> to ..."
- "get a second opinion from @\<agent\>"
- "have @\<agent\> review ..."
- "what does @\<agent\> think about ..."
- "delegate this to @\<agent\>"

## When NOT to use

Do NOT call `channel.mention` when:

- The user asks "what do YOU think" — they want your answer, not a peer's.
- The user asks to delegate a sub-task to another Claude Code instance —
  use the `Agent` tool or agent teams.
- The user asks to "save this conversation" or "share with X" — wrong
  primitive; channels are not a messaging app.
- You're tempted to use it to "double-check" your own answer. If your
  answer might be wrong, fix it; don't shop for confirmation.

## Steps

1. **Confirm a channel exists.** Call `channel.list` first. If no
   relevant channel exists, ASK the user:
   > "Want me to create a channel for this? It's a one-time setup
   > (channels persist; we can reuse it later)."

   Do NOT silently create channels.

2. **Confirm the target agent is a member.** `channel.list` returns
   each channel's `members[]`. If `@<target>` isn't there, tell the
   user verbatim:
   > "@\<target\> isn't in #\<channel\>. Run
   > `brv channel invite #\<channel\> @\<target\> --profile \<name\>`
   > from your terminal first."

3. **Call `channel.mention`.** Always pass `suppressThoughts: true`
   (it's the default; only set `false` for debugging). Set `timeout`
   to 120000 (2 min) for routine reviews, up to 300000 (5 min) for
   hard problems. The call blocks until the turn completes.

4. **Render the answer in your reply.** The response's `finalAnswer`
   field is a complete answer; quote it as you would quote any source
   that isn't yourself. Make clear it came from `@<target>`, not from you.

5. **If the call returns an error**, surface the error code verbatim
   to the user. Common codes:
   - `BRV_DAEMON_NOT_INITIALISED` — user must run any `brv` command
     once in their terminal to boot the daemon.
   - `CHANNEL_SYNC_TIMEOUT` — the agent took longer than the timeout.
     Suggest a higher `timeout` or a more focused prompt.
   - `CHANNEL_NOT_FOUND` — channel doesn't exist; offer to ask the
     user to create it.
   - `CHANNEL_MEMBER_NOT_FOUND` — the `@<handle>` you mentioned
     isn't a channel member.

## Red flags — STOP and reconsider

- **You're calling `channel.mention` to get an answer YOU could give.**
  The user asked for a peer's opinion. Re-read the request: if they
  said "what do you think", they want your answer.
- **You're calling it twice in a row for the same question to
  "double-check".** If the first answer is wrong, ask the same agent
  to revisit; don't poll.
- **The user is having an iterative back-and-forth and you call
  `channel.mention` on every turn.** brv channel is one-shot per
  turn; conversation context stays on YOUR side. Carry it forward.
- **You're tempted to use `channel.mention` to send the user a status
  update.** It's not a notification mechanism.
- **You silently called `channel.create` or `channel.invite`.** Those
  tools aren't exposed by `channel-mcp` on purpose. Ask the user.

## Quick reference

| Want to ... | Use ... |
|---|---|
| Ask `@kimi` to review a file | `channel.mention(channelId, prompt, suppressThoughts: true)` |
| See what channels exist | `channel.list()` |
| Read a past turn's transcript | `channel.show(channelId, turnId)` |
| Check which agents are healthy | `channel.doctor()` |
| Coordinate with another Claude Code | **agent teams**, not brv channel |
| Create a channel | Tell the user to run `brv channel new <id>` |
| Invite/remove a member | Tell the user — these are human-only ops |
| Approve/deny a pending permission | Tell the user to run `brv channel permission-decision ...` |

## Common misapplications

| Tempted to ... | Don't, because ... | Do instead |
|---|---|---|
| Use brv channel as your "scratchpad" | Channels are durable transcripts visible to other agents — not private notes | Use TodoWrite or your own context |
| Call mention with `suppressThoughts: false` for routine tasks | The thought trace is ~20× longer than the answer and adds 100s+ of seconds | Default `suppressThoughts: true`; only pass `false` to debug an agent that's giving bad answers |
| Mention every member when in doubt | Each mention is a billed turn against that agent's model | Single targeted mention to the agent most likely to know |
| Use brv channel for Claude-Code-to-Claude-Code | Redundant with agent teams which is faster and bidirectional | Agent teams |
| Use channel.mention to ask an agent for a file's contents | The agent's filesystem may differ from the user's | Read the file yourself with `Read`/`Bash`, then include relevant excerpts in the prompt |
| Pass a multi-paragraph prompt that mixes several questions | The agent will burn time on the least-important parts | Break it into focused mentions, one focused question each |

## Tool descriptions (for reference)

- `channel.list({})` — returns `{channels: [{channelId, memberCount, members, ...}]}`
- `channel.mention({channelId, prompt, suppressThoughts?, timeout?})` — returns
  `{turnId, channelId, finalAnswer, toolCalls, durationMs, endedState}`
- `channel.show({channelId, turnId})` — returns `{turn, events, deliveries?}`
- `channel.doctor({profile?})` — returns `{profiles: [{name, ok, reason?}]}`
