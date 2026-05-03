---
name: byterover
description: |
  Use when the user asks about prior work on this project — questions
  like "how did we handle X", "what's our approach to Y", "did we decide
  on Z", "remind me how we did W", or any reference to project
  conventions, past decisions, or implementation history. Retrieves
  curated project context that is not available through native memory or grep.
---

# ByteRover Recall

When the user asks about *prior work* on this project, query the ByteRover
memory tree before answering from your own reasoning or native memory.

## Trigger phrases (high confidence)

- "how did we..." / "how do we..." / "what's our approach to..."
- "did we decide..." / "what did we settle on for..."
- "last time we..." / "previously..." / "before, we..."
- "our convention for..." / "the way we do X" / "our pattern"
- "remind me how..." / "refresh my memory on..."

## Workflow

1. Call `brv-query` with 3-7 keywords from the user's question.
2. If you get matches, surface what was curated, when, and against which
   task/issue if available — give the user enough provenance to audit:

   > Per this project's curated context (curated against BRV-241), the billing
   > team is resolved server-side from user_id, not from sync remote config.

3. If no matches, say so plainly:

   > Nothing in your ByteRover memory matches this. Want me to grep the
   > codebase or work from first principles?

4. If a match conflicts with current code, surface that explicitly — do not
   silently use stale info.

## Don't

- Don't paraphrase memory content without the provenance — users need to audit
- Don't query `brv-query` for public library docs, generic syntax, or non-project info
- Don't skip the citation even if the answer feels obvious; the citation IS the value
