/**
 * SKILL.md template tests (Phase 5 Task 5.6).
 *
 * The skill connector ships SKILL.md to skill-driven agents (Claude Code,
 * Cursor, Codex, etc.). The template must teach Phase 5's three tools:
 *   - brv-search (LLM-free tier 0/1/2)
 *   - brv-gather (LLM-free context bundle)
 *   - brv-record-answer (cache-write companion)
 *
 * Both surfaces matter:
 *   - MCP Workflow section — for clients using MCP-tool calls
 *   - CLI Commands sections — for skill/hook-driven agents that invoke
 *     `brv <command>` from terminal instructions
 *
 * Critical regression: existing CLI sections (`### 1. Query Knowledge`,
 * `### 2. Search Context Tree`, `### 3. Curate Context`, etc.) MUST stay
 * intact byte-for-byte — only re-numbered when new sections are inserted.
 */

import {expect} from 'chai'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

describe('SKILL.md template (Phase 5 Task 5.6)', () => {
  let template: string

  before(() => {
    const templatePath = join(
      process.cwd(),
      'src',
      'server',
      'templates',
      'skill',
      'SKILL.md',
    )
    template = readFileSync(templatePath, 'utf8')
  })

  describe('Workflow snippet — LLM-free synthesis loop bullet', () => {
    it('top-level Workflow section includes the search → gather → record-answer loop', () => {
      // Numbered bullet that names all three tools — exact wording flexible
      // but the chain must be discoverable for skill-driven agents.
      const workflowSection = template.slice(template.indexOf('## Workflow'), template.indexOf('## Commands'))
      expect(workflowSection).to.match(/brv search/i)
      expect(workflowSection).to.match(/brv gather/i)
      expect(workflowSection).to.match(/brv record-answer/i)
    })
  })

  describe('MCP Workflow section', () => {
    it('contains a "## MCP Workflow" section before "## Commands"', () => {
      const mcpIdx = template.indexOf('## MCP Workflow')
      const cmdIdx = template.indexOf('## Commands')
      expect(mcpIdx).to.be.greaterThan(-1)
      expect(cmdIdx).to.be.greaterThan(-1)
      expect(mcpIdx).to.be.lessThan(cmdIdx)
    })

    it('names brv-search, brv-gather, and brv-record-answer in the MCP Workflow section (hyphenated — matches actual MCP registrations)', () => {
      const mcpStart = template.indexOf('## MCP Workflow')
      const mcpEnd = template.indexOf('## Commands')
      const mcpSection = template.slice(mcpStart, mcpEnd)

      // Hyphenated names match the actual `server.registerTool('brv-search', ...)`
      // registrations in mcp-server.ts. Codex Pass 7 caught the mismatch where
      // SKILL.md taught underscored names that did not exist.
      expect(mcpSection).to.include('brv-search')
      expect(mcpSection).to.include('brv-gather')
      expect(mcpSection).to.include('brv-record-answer')
      // Negative regression: ensure no underscored aliases creep back
      expect(mcpSection).to.not.match(/\bbrv_search\b/)
      expect(mcpSection).to.not.match(/\bbrv_gather\b/)
      expect(mcpSection).to.not.match(/\bbrv_record_answer\b/)
    })

    it('teaches the escalation rule (status: needs_synthesis → brv_gather)', () => {
      const mcpStart = template.indexOf('## MCP Workflow')
      const mcpEnd = template.indexOf('## Commands')
      const mcpSection = template.slice(mcpStart, mcpEnd)

      // The four-step escalation rule from DESIGN §7.1
      expect(mcpSection).to.match(/needs_synthesis/i)
      expect(mcpSection).to.match(/cached_answer|tier/i)
    })
  })

  describe('CLI sections — Gather Context Bundle', () => {
    it('has a Gather Context Bundle section under ## Commands', () => {
      const cmdStart = template.indexOf('## Commands')
      const commands = template.slice(cmdStart)

      expect(commands).to.match(/###\s+\d+\.\s+Gather Context Bundle/i)
    })

    it('shows the brv gather command with examples', () => {
      const cmdStart = template.indexOf('## Commands')
      const commands = template.slice(cmdStart)

      expect(commands).to.match(/brv gather "/)
    })

    it('documents when to escalate to brv gather (after brv search has no high-confidence direct answer)', () => {
      const cmdStart = template.indexOf('## Commands')
      const commands = template.slice(cmdStart)
      const gatherIdx = commands.search(/Gather Context Bundle/i)
      const gatherSection = commands.slice(gatherIdx, gatherIdx + 2000)

      expect(gatherSection.toLowerCase()).to.match(/synthesi|brv search|no high|llm/)
    })
  })

  describe('CLI sections — Record Synthesized Answer', () => {
    it('has a Record Synthesized Answer section under ## Commands', () => {
      const cmdStart = template.indexOf('## Commands')
      const commands = template.slice(cmdStart)

      expect(commands).to.match(/###\s+\d+\.\s+Record Synthesized Answer/i)
    })

    it('shows the brv record-answer command with --fingerprint flag', () => {
      const cmdStart = template.indexOf('## Commands')
      const commands = template.slice(cmdStart)

      expect(commands).to.match(/brv record-answer/)
      expect(commands).to.match(/--fingerprint/)
    })

    it('documents the cache TTL so agents understand stale entries expire', () => {
      const cmdStart = template.indexOf('## Commands')
      const commands = template.slice(cmdStart)
      const recordIdx = commands.search(/Record Synthesized Answer/i)
      const recordSection = commands.slice(recordIdx, recordIdx + 2000)

      expect(recordSection.toLowerCase()).to.match(/ttl|expire|60s|60 second/)
    })
  })

  describe('No regression on existing CLI sections', () => {
    it('still has Query Knowledge section', () => {
      expect(template).to.match(/###\s+\d+\.\s+Query Knowledge/)
    })

    it('still has Search Context Tree section', () => {
      expect(template).to.match(/###\s+\d+\.\s+Search Context Tree/)
    })

    it('still has Curate Context section', () => {
      expect(template).to.match(/###\s+\d+\.\s+Curate Context/)
    })

    it('still has Version Control section', () => {
      expect(template).to.match(/###\s+\d+\.\s+Version Control/)
    })
  })
})
