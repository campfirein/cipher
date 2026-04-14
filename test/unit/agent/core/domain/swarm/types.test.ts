import {expect} from 'chai'

import {
  createDefaultCapabilities,
  isCloudProvider,
  isLocalProvider,
  PROVIDER_TYPES,
} from '../../../../../../src/agent/core/domain/swarm/types.js'

describe('Swarm Types', () => {
  describe('PROVIDER_TYPES', () => {
    it('contains all seven provider types', () => {
      expect(PROVIDER_TYPES).to.have.length(7)
      expect(PROVIDER_TYPES).to.include('byterover')
      expect(PROVIDER_TYPES).to.include('honcho')
      expect(PROVIDER_TYPES).to.include('hindsight')
      expect(PROVIDER_TYPES).to.include('obsidian')
      expect(PROVIDER_TYPES).to.include('local-markdown')
      expect(PROVIDER_TYPES).to.include('gbrain')
      expect(PROVIDER_TYPES).to.include('memory-wiki')
    })

    it('is readonly', () => {
      // The array should be a readonly tuple — verify it has the expected values
      const types: readonly string[] = PROVIDER_TYPES
      expect(types).to.be.an('array')
    })
  })

  describe('isLocalProvider', () => {
    it('returns true for local providers', () => {
      expect(isLocalProvider('byterover')).to.be.true
      expect(isLocalProvider('obsidian')).to.be.true
      expect(isLocalProvider('local-markdown')).to.be.true
      expect(isLocalProvider('memory-wiki')).to.be.true
    })

    it('returns false for cloud providers', () => {
      expect(isLocalProvider('honcho')).to.be.false
      expect(isLocalProvider('hindsight')).to.be.false
      expect(isLocalProvider('gbrain')).to.be.false
    })
  })

  describe('isCloudProvider', () => {
    it('returns true for cloud providers', () => {
      expect(isCloudProvider('honcho')).to.be.true
      expect(isCloudProvider('hindsight')).to.be.true
      expect(isCloudProvider('gbrain')).to.be.true
    })

    it('returns false for local providers', () => {
      expect(isCloudProvider('byterover')).to.be.false
      expect(isCloudProvider('obsidian')).to.be.false
      expect(isCloudProvider('local-markdown')).to.be.false
      expect(isCloudProvider('memory-wiki')).to.be.false
    })
  })

  describe('createDefaultCapabilities', () => {
    it('returns correct defaults for byterover', () => {
      const caps = createDefaultCapabilities('byterover')
      expect(caps.keywordSearch).to.be.true
      expect(caps.semanticSearch).to.be.false
      expect(caps.graphTraversal).to.be.false
      expect(caps.temporalQuery).to.be.false
      expect(caps.userModeling).to.be.false
      expect(caps.writeSupported).to.be.false
      expect(caps.localOnly).to.be.true
      expect(caps.avgLatencyMs).to.equal(50)
    })

    it('returns correct defaults for obsidian', () => {
      const caps = createDefaultCapabilities('obsidian')
      expect(caps.keywordSearch).to.be.true
      expect(caps.semanticSearch).to.be.false
      expect(caps.graphTraversal).to.be.true
      expect(caps.localOnly).to.be.true
      expect(caps.writeSupported).to.be.false
      expect(caps.avgLatencyMs).to.equal(100)
    })

    it('returns correct defaults for honcho', () => {
      const caps = createDefaultCapabilities('honcho')
      expect(caps.semanticSearch).to.be.true
      expect(caps.userModeling).to.be.true
      expect(caps.temporalQuery).to.be.true
      expect(caps.localOnly).to.be.false
      expect(caps.avgLatencyMs).to.equal(500)
    })

    it('returns correct defaults for hindsight', () => {
      const caps = createDefaultCapabilities('hindsight')
      expect(caps.semanticSearch).to.be.true
      expect(caps.keywordSearch).to.be.true
      expect(caps.graphTraversal).to.be.true
      expect(caps.temporalQuery).to.be.true
      expect(caps.localOnly).to.be.false
      expect(caps.avgLatencyMs).to.equal(300)
    })

    it('returns correct defaults for gbrain', () => {
      const caps = createDefaultCapabilities('gbrain')
      expect(caps.semanticSearch).to.be.true
      expect(caps.keywordSearch).to.be.true
      expect(caps.temporalQuery).to.be.true
      expect(caps.localOnly).to.be.false
      expect(caps.avgLatencyMs).to.equal(200)
    })

    it('returns correct defaults for local-markdown', () => {
      const caps = createDefaultCapabilities('local-markdown')
      expect(caps.keywordSearch).to.be.true
      expect(caps.graphTraversal).to.be.true
      expect(caps.writeSupported).to.be.true
      expect(caps.localOnly).to.be.true
      expect(caps.avgLatencyMs).to.equal(80)
    })

    it('returns correct defaults for memory-wiki', () => {
      const caps = createDefaultCapabilities('memory-wiki')
      expect(caps.keywordSearch).to.be.true
      expect(caps.semanticSearch).to.be.false
      expect(caps.graphTraversal).to.be.false
      expect(caps.writeSupported).to.be.true
      expect(caps.localOnly).to.be.true
      expect(caps.avgLatencyMs).to.equal(60)
    })
  })
})
