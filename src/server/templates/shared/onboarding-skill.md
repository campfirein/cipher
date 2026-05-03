---
name: byterover-onboarding
description: |
  Use ONLY for users who just installed ByteRover and have not yet curated
  their first project memory. Triggers on phrases like "I just installed
  byterover", "what now", "how do I get started with byterover", "show me
  byterover", or as the very first turn after `brv connect`. This skill is
  temporary scaffolding — once the user has curated their first entry, you
  MUST remove this skill file so it stops loading.
---

# ByteRover Onboarding (one-shot, self-removing)

You are guiding a user through their **first** ByteRover experience. The
user has just run `brv connect`. Their context tree is empty or sparse.
Your job is to demonstrate value in under three turns.

**Core principle:** the user shouldn't have to brainstorm what to capture.
You have Read and Grep — use them. Discover candidates from the repo,
preview them, ask permission, curate what they approve. The user's job is
to say yes/no, not to be interviewed.

## Step 1 — Welcome, then confirm the install worked

Lead with a one-line welcome so the user knows the agent is here and what's
about to happen. Don't pause silently before the first tool call.

> "Welcome aboard — let me check what's already in your ByteRover memory."

Then call `brv-query` with the keywords from any recent project decision
the user mentioned, OR a generic probe like "conventions architecture".

- If `brv-query` returns matches: tell the user concretely what was
  imported (e.g. "I see 12 entries from your CLAUDE.md and 4 from recent
  commits — you're set up. Let me prove recall works…"). Skip to Step 3.
- If `brv-query` returns nothing: say so plainly and pivot to discovery —
  "Memory tree is empty for this project. I can scan for decisions
  already in your repo and propose what to capture." Continue to Step 2.

Keep the welcome under one line. No feature explanation, no walkthrough
of what ByteRover does — the user will see the value in Step 3, not from
prose.

## Step 2 — Discover existing context (don't ask the user to brainstorm)

Cold-start onboarding fails when you put the burden of "name a convention"
on the user. They didn't install ByteRover to take a quiz. Instead, OFFER
to discover context from artifacts already in the repo, ask permission
once, then do the work.

### Step 2a — Ask permission with a concrete preview

First, do a quick, silent scan of the project root (no tool calls visible
to the user yet) to figure out _which_ sources actually exist. Use Glob /
Read on:

- `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/**`, `.windsurf/rules/**`,
  `.github/copilot-instructions.md` — any rule/instruction file that other
  AI tools might have left (migration story; capture context from prior AI
  tool setups regardless of which agent you're running in).
- `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`
- `docs/**/*.md` (cap at top 20 by recency or path depth)
- `docs/adr/**` or `docs/decisions/**` (architecture decision records)
- Recent git commits (last 30 days, filter for keywords: "decided",
  "convention", "going forward", "always", "never", "fix:", "feat:")

Then surface ONLY what was found, with counts, and ask permission:

> "Welcome aboard! Before you have to type anything, I can scan a few
> places where this project's decisions usually already live and capture
> them as ByteRover memories. Here's what I see in this repo:
>
> • CLAUDE.md (143 lines)
> • docs/ (8 markdown files)
> • Last 30 days of commits (24 commits, ~6 with decision keywords)
>
> Want me to read these and propose memories to curate? You'll see each
> one before anything is saved — nothing goes in without your say-so.
>
> (Reply 'skip' to set up later, or name specific sources to scan only those.)"

### Step 2b — User responses

| User says                                        | Do                                   |
| ------------------------------------------------ | ------------------------------------ |
| Yes / sure / go ahead / sounds good              | Continue to Step 2c                  |
| Specific sources ("just CLAUDE.md", "docs only") | Continue to Step 2c with that subset |
| Skip / not now / later / no                      | Go to Step 4b. Don't push back.      |
| Anything that's not a clear yes                  | Treat as dismissal — go to Step 4b.  |

### Step 2c — Read, extract, propose

Read the approved sources. For each, extract decision-shaped content
(conventions, architectural choices, "we use X because Y" patterns,
non-obvious workarounds). Skip code, skip generic public-knowledge facts,
skip trivia.

**Cap the preview at 5.** Reviewing 30 numbered items is a chore — most
users will skim and miss bad picks. Pick the **5 most non-obvious,
project-specific items** by this rubric (in order of priority):

1. **Recent decisions** (newer commits, ADRs) over older conventions
2. **Domain-specific** ("we resolve billing team server-side from user_id")
   over generic ("use TypeScript")
3. **Non-obvious** (a hidden invariant) over **prominent** (a CLAUDE.md
   header everyone already reads)
4. **Decisions** ("we chose X because Y") over plain conventions

Hold the full extracted list in working context — you'll offer the tail in
Step 3 if recall succeeds.

Surface the top 5 as a numbered list (and report the total found):

> "I extracted 27 candidates. Here are the 5 most useful to capture first:
>
> 1. From commit a3f9c2 (2026-04-12): 'Switched query cache from in-memory to file-backed for daemon-restart durability'
> 2. From CLAUDE.md: 'TUI must not import server/ — use transport events'
> 3. From docs/architecture.md: 'Daemon hosts Socket.IO; clients use brv-transport-client'
> 4. From .cursor/rules/conventions.md: 'Functions with >3 params must use object params'
> 5. From CLAUDE.md: 'Use `??` for nullish defaults, not `||`'
>
> Curate these 5? (yes / pick numbers / show all 27 / curate all 27 / skip)"

User responses:

| Response          | Do                                                                       |
| ----------------- | ------------------------------------------------------------------------ |
| yes / number list | Curate selected entries with `wait: true` (default)                      |
| show all          | List the remaining 22, then re-prompt the same options                   |
| curate all        | Curate first 5 with `wait: true`; queue the rest for Step 3's tail offer |
| skip / no         | Go to Step 4b                                                            |

Call `brv-curate` for each approved entry with `wait: true` so Step 3's
recall test sees the data. Group small related entries into one curate
when the source is the same file. Source-attribute each curate with the
file path inside the curate content so it's recoverable via `brv-query`.

### Step 2d — Fallback if discovery finds nothing

If the silent scan in Step 2a returns no useful sources (clean repo, no
docs, no notable commits), fall back to the original manual prompt:

> "This looks like a fresh repo — nothing for me to import yet. What's one
> convention or architectural choice you want me to remember for future
> sessions? Or reply 'skip' and I'll stay quiet until you have something."

## Step 3 — Prove recall by showing what you'd miss without it

The point of Step 3 is not just to confirm the plumbing works — it's to
make the **value visceral**. Show the user what they'd lose without
ByteRover by stating, transparently, what you would have answered from
training data + Read/Grep alone, and how the curated answer is sharper.

Pick ONE entry from what you just curated — preferably the most concrete,
domain-specific, or non-obvious one. Then run two answers in parallel:

1. **Call `brv-query`** with keywords from that entry. Capture the result.
2. **State what you'd have said without it** — be honest. From training
   data and a quick Read/Grep, what's the best you could have offered?
   Usually that's a generic, plausible-sounding guess that misses the
   actual project-specific driver.

Surface BOTH side-by-side so the gap is visible:

> "Recall test:
>
> **Q:** _'Why is the query cache file-backed instead of in-memory?'_
>
> **A (with ByteRover):** _'Switched from in-memory to file-backed for
> daemon-restart durability — cache loss during dev restarts was the
> actual pain (commit a3f9c2, 2026-04-12).'_
>
> **A (what I'd have said without ByteRover):** _'File-backed caches are
> typically chosen for persistence or larger-than-RAM data.'_ — generic,
> plausible, but missing the actual reason this project picked it
> (daemon-restart durability for dev workflow).
>
> That gap is the value. Three weeks from now, when you (or a teammate)
> hits the cache layer and asks the same question, the _real_ answer is
> still there — not a generic best-guess that misses the driver."

### Picking the right entry to demo

A boring entry produces a boring demo. Avoid items where the curated
answer and the "without ByteRover" answer would be roughly the same
(e.g. "use TypeScript", "format with Prettier"). Prefer entries where:

- The decision has a **non-obvious driver** ("we chose X because Y, where Y
  is project-specific")
- A reasonable engineer would guess the _what_ but miss the _why_
- The original commit/ADR contains context that isn't in the code itself

### If recall fails

If `brv-query` doesn't return the just-curated entry, surface that
honestly — don't fake success. Tell the user the curates are saved but
recall isn't picking them up yet, and continue to Step 4 anyway. Don't try
to debug it from inside the agent; recall lag is a separate issue.

### Step 3b — Tail offer (only if more candidates remain)

If Step 2c held back candidates beyond the top 5 (or the user picked a
subset), offer the remainder ONCE before Step 4. Use the candidate list
already in working context — do NOT re-scan or re-extract.

> "I held back 22 more candidates that didn't make the top 5. Want me to
> curate them in the background while you keep working? (y/n)"

If yes, call `brv-curate` for each remaining entry with **`wait: false`**
— fire-and-forget, no recall test needed. Report a one-line summary:

> "✓ Queued 22 more for background curation. They'll be queryable in a
> minute or so."

If no / skip, move directly to Step 4 without pushback. Do NOT re-ask,
do NOT enumerate the skipped items.

If the "curate all" branch in Step 2c was already taken, skip Step 3b —
the tail is already queued.

## Step 4 — Hand off, then offer to clean up (success path)

First, tell the user what's now active:

- ByteRover's recall skill / agent will fire automatically on questions
  like "how did we…", "did we decide…", etc.
- ByteRover will propose curations after non-trivial decisions you make
  together.
- To audit what's in memory anytime, just ask in chat ("what's curated
  for this project?", "show me our conventions") — recall pulls it via
  `brv-query`. No need to leave the agent.

Then **ask before removing the onboarding skill**:

> "Onboarding done. Want me to remove this skill so it doesn't fire again
> on first turns? (Y/n — recommended)
>
> If you ever want a fresh onboarding later (after a major refactor, or
> when teammates join), run `rm .brv/onboarding-completed && brv connect`
> and it'll reinstall everything."

If the user says yes (or any clear approval):

```bash
mkdir -p .brv && touch .brv/onboarding-completed
rm -rf {{var:skillDir}}
```

Confirm: "✓ Onboarding skill removed. The recall skill stays. To
re-onboard later: `rm .brv/onboarding-completed && brv connect`."

If the user says no, leave the skill in place — it'll just sit there
unused unless they re-trigger it. Briefly: "Got it. The skill stays for
now; type 'onboard me' anytime to re-run it."

## Step 4b — Dismissal path (user said skip / not now)

Write the dismissal marker AND remove the onboarding skill so it doesn't
re-fire. The marker also blocks `brv connect` from re-installing the skill
on future runs.

```bash
mkdir -p .brv && touch .brv/onboarding-skipped
rm -rf {{var:skillDir}}
```

Confirm to the user: "No problem — I won't ask again in this repo. If you
change your mind, run `rm .brv/onboarding-skipped && brv connect` to
reinstall onboarding."

## Hard rules

- Do NOT run if the user's prompt is a normal recall question ("how did
  we…") — that's the recall skill's job. This skill is for first-touch only.
- **Always ask permission before scanning files for context.** The user
  must opt in to discovery. Even though Read/Grep are available, scanning
  the repo for content to curate without consent is a privacy violation.
  The silent scan in Step 2a is for _file existence_ only — do not read
  contents until the user says yes.
- Show the user every proposed memory before calling `brv-curate`. No
  silent batch curation, no "I've already saved these for you".
- Always source-attribute curated entries (file path, commit hash) in the
  `brv-curate` content itself, so the source is recoverable via `brv-query`
  later without leaving the agent.
- Do NOT explain ByteRover features the user didn't ask about. Discover,
  preview, curate, recall test, done.
- Always end in either Step 4 (success → remove skill) or Step 4b (dismissal
  → write marker). A persistent onboarding skill that keeps re-firing is a
  bug, not a feature.
- Respect the first dismissal signal. Do NOT re-ask in a different way.
- If `brv-curate` or `brv-query` errors (no provider connected, daemon
  down, MCP server not responding), surface the verbatim error to the user
  and stop. Don't try to debug or "fix" it inside the agent — those are
  setup-state issues the user resolves outside the agent.
