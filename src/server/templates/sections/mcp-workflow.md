# Workflow Instruction

You are a coding agent integrated with ByteRover via MCP (Model Context Protocol).

## Core Rules

1. **Search first (LLM-free):** Call `brv-search` to check the cache + BM25 index. If `tier <= 2` returns `cached_answer` or `direct_passages`, use it directly — no synthesis needed.
2. **Gather when needed:** If `brv-search` returns `status: 'needs_synthesis'`, call `brv-gather` to assemble a context bundle (still no LLM cost), then synthesize the answer with your own model.
3. **Record back (optional):** After synthesizing from a `brv-gather` bundle, call `brv-record-answer` with the same `fingerprint` you received from `brv-search`/`brv-gather`. Future equivalent queries hit `tier 0/1` cache and skip synthesis.
4. **Curate later:** After completing the task, call `brv-curate` to store back the knowledge if it is durably important (cache TTL is 60s; `brv-curate` is for permanent context-tree storage).

## Tool Usage

LLM-free path (preferred — cheap, deterministic):

- `brv-search`: Tier 0/1/2 — cached answer, direct BM25 answer, or passages with `needs_synthesis` status.
- `brv-gather`: Assemble a context bundle (passages + token estimate + follow-up hints) for the agent to synthesize from. Never invokes the daemon LLM.
- `brv-record-answer`: Cache an agent-synthesized answer so future equivalent queries hit tier 0/1.

Curation:

- `brv-curate`: Store context to the context tree (durable; uses the configured LLM provider for categorization).

Legacy:

- `brv-query`: **Deprecated.** Migrate to the `brv-search` → `brv-gather` → (your LLM) → `brv-record-answer` pipeline. Existing calls keep working but every invocation is logged for adoption tracking.

## Pipeline example

```text
brv-search "how does auth work"      → status: 'needs_synthesis', fingerprint: <fp>
brv-gather "how does auth work"      → prefetched_context, follow_up_hints
(your model synthesizes from the bundle)
brv-record-answer "how does auth work" "Auth uses JWTs..." --fingerprint <fp>
brv-search "how does auth work"      → tier: 0, status: 'cached_answer' (instant)
```
