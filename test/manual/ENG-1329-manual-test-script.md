# ENG-1329 Manual Test Script

Manual verification of the four ENG-1329 pillars:
1. Zero-cost continuity & escalated compression
2. Parallel map tools (llm_map, agentic_map)
3. Pre-curation compaction pipeline
4. Hierarchical DAG (archives, summaries, manifests, expand_knowledge)

## Prerequisites

```bash
# Build
npm run build

# Start in dev mode (opens REPL)
./bin/dev.js

# Ensure you're logged in
/status
# If not: /login
```

**Tip:** Use `/new -y` between tests to start fresh sessions.

---

## Test 1: Pre-Curation Compaction (20K Threshold)

**What it tests:** Contexts >20,000 chars trigger the 3-tier compaction pipeline before the curation agent sees them.

### 1a. Small context — should skip compaction (single-pass)

```
/curate This is a small piece of context about our auth module using JWT tokens.
```

**Expected:**
- Agent starts curation immediately (no compaction delay)
- Curation completes in ~3-5 iterations
- Entry saved to `.brv/context-tree/`

**Verify:**
```bash
ls -la .brv/context-tree/
cat .brv/context-tree/*.md  # Should contain the curated fact
```

### 1b. Large context — should trigger compaction

Create a large input file (>20K chars):

```bash
# Generate a large test file (~25K chars)
python3 -c "
for i in range(500):
    print(f'[USER]: Question {i} about feature {i % 10}')
    print(f'[ASSISTANT]: The answer to question {i} involves module_{i % 5} which handles feature_{i % 10}. This is a detailed explanation with enough text to push the total over the 20K threshold. The implementation uses pattern_{i % 3} for optimal performance.')
    print()
" > /tmp/large-context.txt
wc -c /tmp/large-context.txt  # Should be >20K
```

Then curate it:

```
/curate @file /tmp/large-context.txt
```

**Expected:**
- Pre-compaction fires (brief pause before agent starts)
- Agent sees a compacted version, NOT the full 25K+ chars
- Curation completes in ~3-8 iterations (NOT 15-25)
- Facts saved to context tree

**Verify:**
```bash
ls -la .brv/context-tree/
```

---

## Test 2: Hierarchical DAG — Archives, Summaries, Manifests

**What it tests:** Low-importance entries get archived with ghost cues; summaries and manifests are generated.

### 2a. Curate multiple entries to build tree structure

```
/curate The login endpoint at /api/auth/login accepts POST with email+password and returns a JWT token. Source: src/server/routes/auth.ts:45-60
```

```
/curate Rate limiting is configured at 100 requests per minute per IP using express-rate-limit middleware. Source: src/server/middleware/rate-limiter.ts:10-15
```

```
/curate The database uses PostgreSQL with connection pooling (max 20 connections). Config in src/server/config/database.ts
```

**Verify tree structure:**
```bash
find .brv/context-tree/ -type f | sort
# Should see:
# .brv/context-tree/<topic>.md files
# .brv/context-tree/_index.md (if summary was generated)
# .brv/context-tree/_manifest.json (if manifest was built)
```

### 2b. Check manifest content

```bash
cat .brv/context-tree/_manifest.json 2>/dev/null | python3 -m json.tool
```

**Expected manifest structure:**
```json
{
  "version": "...",
  "active_context": [...],
  "lane_tokens": {
    "contexts": <number>,
    "stubs": <number>,
    "summaries": <number>
  },
  "total_tokens": <number>,
  "source_fingerprint": "..."
}
```

### 2c. Check summary (_index.md)

```bash
cat .brv/context-tree/_index.md 2>/dev/null
```

**Expected:** YAML frontmatter with `children_hash`, `compression_ratio`, `covers`, `token_count`, followed by a summary paragraph.

### 2d. Verify archiving (if entries have low importance)

After enough curation cycles, check for archived entries:

```bash
ls -laR .brv/context-tree/_archived/ 2>/dev/null
# Should see:
# *.stub.md — ghost cue with frontmatter (points_to: path)
# *.full.md — lossless original content
```

If entries exist:
```bash
cat .brv/context-tree/_archived/*.stub.md  # Check ghost cue
cat .brv/context-tree/_archived/*.full.md  # Check full content preserved
```

**Expected stub frontmatter:**
```yaml
---
points_to: _archived/<name>.full.md
original_path: <original-path>.md
importance: <number below 35>
---
<ghost cue summary>
```

---

## Test 3: Query with Context Injection

**What it tests:** Queries use manifest lanes (summaries, contexts, stubs) for structural context injection.

### 3a. Basic query against populated tree

```
/query How is authentication implemented?
```

**Expected:**
- Agent retrieves relevant context entries
- Response references the curated facts (JWT, login endpoint, etc.)
- Should NOT hallucinate — answers should match curated knowledge

### 3b. Query triggering expand_knowledge (if archives exist)

If you have archived entries, ask a query that would match the archived content:

```
/query What are the database connection settings?
```

**Expected:**
- If the DB entry was archived, the agent should:
  1. Find the `.stub.md` via search
  2. Call `expand_knowledge` tool to retrieve full content from `.full.md`
  3. Include the expanded content in the answer

**Verify in agent output:** Look for `expand_knowledge` tool call in the response stream.

---

## Test 4: Parallel Map Tools

### 4a. llm_map — stateless parallel processing

First, create a JSONL input file in the project:

```bash
cat > /tmp/map-input.jsonl << 'EOF'
{"text": "The user authentication module uses bcrypt for password hashing", "id": 1}
{"text": "Database connections are pooled using pg-pool with max 20 connections", "id": 2}
{"text": "Rate limiting is implemented via express-rate-limit at 100 req/min", "id": 3}
{"text": "The API uses JWT tokens with 24-hour expiration for session management", "id": 4}
{"text": "File uploads are stored in S3 with presigned URLs for access control", "id": 5}
EOF
```

Then ask the agent to use llm_map (during a curate or query session, the agent decides tool use autonomously — but you can prompt it):

```
/curate @file /tmp/map-input.jsonl
```

Or, to test llm_map directly, start a curation with a large enough context that the agent might choose to use parallel map for extraction.

**Expected:**
- If the agent uses `llm_map`, you should see:
  - Input read from JSONL
  - Parallel processing (concurrency up to 8)
  - Output JSONL written with one result per line
  - Progress reporting during execution

### 4b. agentic_map — tool-equipped sub-agents

The agent uses `agentic_map` when items require tool access (e.g., reading files). This typically happens during large curation tasks where the agent needs to process multiple files.

Create a multi-file context:

```bash
mkdir -p /tmp/test-docs
echo "# Auth Module\nHandles JWT token generation and validation.\nUses bcrypt for password hashing." > /tmp/test-docs/auth.md
echo "# Database Module\nPostgreSQL with connection pooling.\nMax 20 connections, 30s timeout." > /tmp/test-docs/database.md
echo "# API Gateway\nRate limiting at 100 req/min.\nCORS configured for specific origins." > /tmp/test-docs/gateway.md
```

```
/curate @folder /tmp/test-docs
```

**Expected:**
- For multi-file input, the agent may use `agentic_map` to process files in parallel
- Each sub-agent operates in `read_only=true` mode by default
- Results aggregated into curated facts

**Verify:** Watch the agent's tool calls in the TUI output for `agentic_map` or `llm_map` usage.

---

## Test 5: Context Compression (70% Threshold)

**What it tests:** The agent loop compresses context only when token utilization exceeds 70%.

### 5a. Short conversation — no compression

```
/query What is 2 + 2?
```

**Expected:**
- Quick response, no compression events
- No `llmservice:contextOverflow` warnings in output

### 5b. Long conversation — trigger compression

Start a session and generate many tool calls to fill context:

```
/curate @folder /tmp/test-docs
```

Then, in the same session (don't use `/new`), keep adding more:

```
/curate @file /tmp/large-context.txt
```

**Expected sequence as context grows:**
1. **Below 70%:** Zero overhead, no compression messages
2. **At 70%+:** "Context compaction: pruned N old tool outputs (~X tokens)" warning
3. **Still over after pruning:** Escalated LLM compression kicks in — "Context compaction: created summary boundary"
4. Agent continues working normally after compression

**Signs of compression in TUI:**
- Warning messages about context compaction
- Tool outputs from earlier turns showing as `[compacted]`
- Possible brief pause during LLM-based compression

### 5c. Curate/query emergency guard (90% overflow)

This is harder to trigger manually. It occurs when:
- A curate/query command has only 1 user turn (no conversation history to prune)
- The single context payload is very large (close to model context limit)

**To attempt:**
```bash
# Create a very large context (~100K chars)
python3 -c "print('x' * 100000)" > /tmp/huge-context.txt
```

```
/curate @file /tmp/huge-context.txt
```

**Expected:**
- Emergency guard triggers at 90%+ utilization
- Aggressive compaction (protects 0 turns instead of 2)
- Agent still functions after compaction

---

## Test 6: Curation REPL Library Helpers

**What it tests:** The `recon()` function suggests the right curation mode based on context size.

### 6a. Small context → single-pass mode

```
/curate A brief note about the API versioning strategy using URL prefixes (/v1/, /v2/).
```

**Expected:**
- Agent uses single-pass curation (no chunking)
- `recon()` suggests `suggestedMode: 'single-pass'`
- Completes in 2-4 iterations

### 6b. Large context → chunked mode

```
/curate @file /tmp/large-context.txt
```

**Expected:**
- Agent uses chunked curation
- `recon()` suggests `suggestedMode: 'chunked'` with chunk count > 1
- May use `chunk()`, `groupBySubject()`, `dedup()` helpers
- Completes in fewer iterations than without helpers (target: ~3-8 vs old ~25)

---

## Test 7: Edge Cases & Error Handling

### 7a. Curate empty content

```
/curate
```

**Expected:** Error message or prompt for content (should not crash).

### 7b. Query with empty context tree

```bash
# Clear context tree first
rm -rf .brv/context-tree/*
```

```
/query What modules exist in this project?
```

**Expected:** Agent indicates no curated knowledge found, may offer to explore codebase directly.

### 7c. Cancel mid-operation (Esc key)

Start a long curation:
```
/curate @file /tmp/large-context.txt
```

Press **Esc** during streaming.

**Expected:**
- Operation cancels cleanly
- No orphaned sessions or corrupted state
- Can start new operations immediately

### 7d. Concurrent operations resilience

Start a curate, cancel it, immediately start a query:

```
/curate @file /tmp/large-context.txt
# Press Esc after 2-3 seconds
/query What auth methods are used?
```

**Expected:** Query works normally despite cancelled curation.

---

## Test 8: Context Tree Sync

### 8a. Push/Pull context tree

```
/push
```

**Expected:**
- Context tree pushed to cloud
- Derived artifacts (`_index.md`, `_manifest.json`, `_archived/*.full.md`) should be excluded from sync (check `isExcludedFromSync` filtering)

```
/pull
```

**Expected:**
- Context tree pulled from cloud
- Summaries/manifests regenerated locally after pull

### 8b. Verify derived artifacts excluded

```bash
# After push, check what was synced (if you have cloud access)
# Locally verify the filter:
find .brv/context-tree/ -name '_index.md' -o -name '_manifest.json' -o -path '*/_archived/*.full.md'
# These should NOT be in the synced set
```

---

## Verification Checklist

| # | Test | Pass/Fail | Notes |
|---|------|-----------|-------|
| 1a | Small curate (<20K) — no compaction | | |
| 1b | Large curate (>20K) — pre-compaction fires | | |
| 2a | Multiple curations build tree | | |
| 2b | Manifest generated with lanes | | |
| 2c | Summary (_index.md) generated | | |
| 2d | Low-importance entries archived | | |
| 3a | Query retrieves curated facts | | |
| 3b | Query expands archived stubs | | |
| 4a | llm_map parallel processing | | |
| 4b | agentic_map with sub-agents | | |
| 5a | Short convo — no compression | | |
| 5b | Long convo — 70% threshold triggers | | |
| 5c | Emergency 90% guard (curate/query) | | |
| 6a | Small context → single-pass recon | | |
| 6b | Large context → chunked recon | | |
| 7a | Empty curate handled | | |
| 7b | Query on empty tree handled | | |
| 7c | Esc cancels cleanly | | |
| 7d | Cancel + immediate new op works | | |
| 8a | Push/pull context tree | | |
| 8b | Derived artifacts excluded from sync | | |

---

## Key Thresholds Reference

| Constant | Value | Location |
|----------|-------|----------|
| `CURATION_CHAR_THRESHOLD` | 20,000 chars | `src/shared/constants/curation.ts` |
| `TARGET_MESSAGE_TOKEN_UTILIZATION` | 0.7 (70%) | `src/agent/infra/llm/agent-llm-service.ts:61` |
| `ARCHIVE_IMPORTANCE_THRESHOLD` | 35 | `src/server/constants.ts:110` |
| `DEFAULT_GHOST_CUE_MAX_TOKENS` | 220 | `src/server/constants.ts:111` |
| `HARD_MAX_DEPTH` (agentic_map) | 3 | `src/agent/infra/map/agentic-map-service.ts` |
| `DEFAULT_CONCURRENCY` (map) | 4 (root), 2 (depth 1), 1 (depth 2+) | `src/agent/infra/map/agentic-map-service.ts` |
| Lane budgets | contexts: 4000, stubs: 500, summaries: 2000 | `src/server/core/domain/knowledge/summary-types.ts` |
| Max iterations (agent) | 50 | `src/agent/core/domain/llm/schemas.ts` |
