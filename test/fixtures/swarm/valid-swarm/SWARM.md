---
name: Code Review Pipeline
description: Multi-agent code review with analysis and synthesis
slug: code-review-pipeline
schema: byterover-swarm/v1
version: 1.0.0
goals:
  - Produce comprehensive code reviews
  - Catch bugs before they ship
includes:
  - agents/analyzer/AGENT.md
  - agents/synthesizer/AGENT.md
---

A two-agent pipeline that analyzes code and synthesizes findings
into actionable review feedback.
