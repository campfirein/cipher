import {expect} from 'chai'

import {AgentEntry} from '../../../../../src/server/core/domain/channel/types.js'
import {DefaultAgentRegistry, SUPPORTED_CLAUDE_CODE_ACP_VERSION} from '../../../../../src/server/infra/channel/drivers/default-agent-registry.js'

describe('DefaultAgentRegistry', () => {
  const registry = new DefaultAgentRegistry()

  describe('claude-code', () => {
    it('returns a stdio launch spec on PATH (no npx)', () => {
      const entry = registry.get('claude-code')
      expect(entry).to.exist
      if (!entry) return
      expect(entry.launch.kind).to.equal('stdio')
      if (entry.launch.kind === 'stdio') {
        expect(entry.launch.command).to.equal('claude-code-acp')
        expect(entry.launch.args).to.deep.equal([])
        // F1 review fix: never npx, never @latest
        expect(entry.launch.command).to.not.equal('npx')
      }
    })

    it('round-trips through AgentEntry zod schema', () => {
      const entry = registry.get('claude-code')!
      expect(() => AgentEntry.parse(entry)).to.not.throw()
    })

    it('exports a pinned supported version constant', () => {
      expect(SUPPORTED_CLAUDE_CODE_ACP_VERSION).to.match(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('opencode', () => {
    it('returns a stdio launch spec calling `opencode acp`', () => {
      const entry = registry.get('opencode')
      expect(entry).to.exist
      if (!entry) return
      expect(entry.launch.kind).to.equal('stdio')
      if (entry.launch.kind === 'stdio') {
        expect(entry.launch.command).to.equal('opencode')
        expect(entry.launch.args).to.deep.equal(['acp'])
      }
    })

    it('round-trips through AgentEntry zod schema', () => {
      const entry = registry.get('opencode')!
      expect(() => AgentEntry.parse(entry)).to.not.throw()
    })
  })

  describe('lookup', () => {
    it('returns undefined for unknown ids', () => {
      expect(registry.get('definitely-not-a-real-agent')).to.be.undefined
    })

    it('list() returns every built-in entry', () => {
      const ids = registry.list().map((e) => e.id).sort()
      expect(ids).to.include('claude-code')
      expect(ids).to.include('opencode')
    })
  })
})
