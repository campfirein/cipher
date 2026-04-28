/**
 * MCP workflow template tests (Phase 5 — PHASE-5-CODE-REVIEW.md Pass 7 Finding 2).
 *
 * `RuleTemplateService.generateMcpContent()` loads `sections/mcp-workflow.md`
 * and substitutes it into the MCP base template. The connector connectors
 * (Cursor, Claude Code, etc.) install the rendered content as the MCP
 * agent's primary instructions. If this template still teaches the legacy
 * two-tool flow, every connector-installed agent will skip the Phase 5
 * search → gather → record-answer pipeline.
 *
 * These tests assert the template content directly (mirrors
 * skill-template.test.ts) — `template-service.test.ts` already covers the
 * substitution machinery with a mock loader, so no point re-testing that.
 */

import {expect} from 'chai'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

describe('sections/mcp-workflow.md template (Phase 5)', () => {
  let template: string

  before(() => {
    const templatePath = join(
      process.cwd(),
      'src',
      'server',
      'templates',
      'sections',
      'mcp-workflow.md',
    )
    template = readFileSync(templatePath, 'utf8')
  })

  describe('Tool registrations advertised', () => {
    it('mentions all 5 hyphenated MCP tool names that mcp-server.ts registers', () => {
      // Hyphenated names match `server.registerTool('brv-search', ...)` etc.
      // Codex Pass 7 caught the prior template advertising only the legacy
      // brv-query / brv-curate pair.
      expect(template).to.include('brv-search')
      expect(template).to.include('brv-gather')
      expect(template).to.include('brv-record-answer')
      expect(template).to.include('brv-curate')
      expect(template).to.include('brv-query')
    })

    it('does NOT use underscored aliases (no brv_search etc.) — those tool names are not registered', () => {
      expect(template).to.not.match(/\bbrv_search\b/)
      expect(template).to.not.match(/\bbrv_gather\b/)
      expect(template).to.not.match(/\bbrv_record_answer\b/)
      expect(template).to.not.match(/\bbrv_query\b/)
      expect(template).to.not.match(/\bbrv_curate\b/)
    })
  })

  describe('Phase 5 workflow guidance', () => {
    it('teaches the search → gather → record-answer pipeline', () => {
      const lower = template.toLowerCase()
      // Pipeline ordering hint — search before gather, gather before record
      const searchIdx = lower.indexOf('brv-search')
      const gatherIdx = lower.indexOf('brv-gather')
      const recordIdx = lower.indexOf('brv-record-answer')
      expect(searchIdx).to.be.greaterThan(-1)
      expect(gatherIdx).to.be.greaterThan(-1)
      expect(recordIdx).to.be.greaterThan(-1)
      expect(searchIdx).to.be.lessThan(gatherIdx, 'search should be introduced before gather')
      expect(gatherIdx).to.be.lessThan(recordIdx, 'gather should be introduced before record-answer')
    })

    it('marks brv-query as deprecated so connector-installed agents migrate', () => {
      expect(template.toLowerCase()).to.match(/deprecat/i)
    })

    it('explains the LLM-free property of the new tools (key Phase 5 invariant)', () => {
      expect(template.toLowerCase()).to.match(/llm-free|no llm|never invokes/i)
    })

    it('includes the needs_synthesis escalation rule', () => {
      expect(template.toLowerCase()).to.match(/needs_synthesis|status:\s*'needs_synthesis'/i)
    })
  })
})
