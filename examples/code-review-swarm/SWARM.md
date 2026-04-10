---
name: Code Review Pipeline
description: Three-agent code review with static analysis, doc research, and synthesis
slug: code-review-pipeline
schema: byterover-swarm/v1
version: 1.0.0
goals:
  - Catch bugs and security vulnerabilities before they ship
  - Produce actionable, prioritized code review feedback
  - Cross-reference findings with project documentation
includes:
  - agents/analyzer/AGENT.md
  - agents/researcher/AGENT.md
  - agents/synthesizer/AGENT.md
---

A three-agent pipeline for comprehensive code reviews:

1. **Analyzer** performs static code analysis (bugs, security, performance)
2. **Researcher** cross-references findings with docs and known patterns
3. **Synthesizer** merges all inputs into a single prioritized review report

The analyzer and researcher run in parallel (both feed into synthesizer).
An optional potential edge from analyzer→researcher lets the optimizer
decide if feeding analysis results into research improves output quality.
