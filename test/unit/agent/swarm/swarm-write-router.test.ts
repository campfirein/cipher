import {expect} from 'chai'
import sinon from 'sinon'

import type {IMemoryProvider} from '../../../../src/agent/core/interfaces/i-memory-provider.js'

import {classifyWrite, selectWriteTarget} from '../../../../src/agent/infra/swarm/swarm-write-router.js'

function createMockProvider(
  id: string,
  type: string,
  writeSupported: boolean
): IMemoryProvider {
  return {
    capabilities: {
      avgLatencyMs: 50,
      graphTraversal: false,
      keywordSearch: true,
      localOnly: type !== 'gbrain',
      maxTokensPerQuery: 8000,
      semanticSearch: false,
      temporalQuery: false,
      userModeling: false,
      writeSupported,
    },
    delete: sinon.stub(),
    estimateCost: sinon.stub().returns({estimatedCostCents: 0, estimatedLatencyMs: 50, estimatedTokens: 0}),
    healthCheck: sinon.stub().resolves({available: true}),
    id,
    query: sinon.stub().resolves([]),
    store: sinon.stub(),
    type: type as 'byterover',
    update: sinon.stub(),
  }
}

describe('SwarmWriteRouter', () => {
  afterEach(() => sinon.restore())

  describe('classifyWrite()', () => {
    it('classifies entity content', () => {
      expect(classifyWrite('Dario Amodei is CEO of Anthropic')).to.equal('entity')
      expect(classifyWrite('Sam Altman founded OpenAI')).to.equal('entity')
      expect(classifyWrite('She works at Google')).to.equal('entity')
    })

    it('classifies note content', () => {
      expect(classifyWrite('meeting notes: we decided to use JWT')).to.equal('note')
      expect(classifyWrite('TODO: fix the auth flow')).to.equal('note')
      expect(classifyWrite('draft idea for new feature')).to.equal('note')
    })

    it('defaults to general for ambiguous content', () => {
      expect(classifyWrite('JWT tokens use refresh rotation')).to.equal('general')
      expect(classifyWrite('The architecture uses a daemon pattern')).to.equal('general')
    })
  })

  describe('selectWriteTarget()', () => {
    it('selects GBrain for entity write type', () => {
      const gbrain = createMockProvider('gbrain', 'gbrain', true)
      const localMd = createMockProvider('local-markdown:notes', 'local-markdown', true)
      const health = new Map([['gbrain', true], ['local-markdown:notes', true]])

      const target = selectWriteTarget('entity', [gbrain, localMd], health)
      expect(target!.id).to.equal('gbrain')
    })

    it('selects local-markdown for note write type', () => {
      const gbrain = createMockProvider('gbrain', 'gbrain', true)
      const localMd = createMockProvider('local-markdown:notes', 'local-markdown', true)
      const health = new Map([['gbrain', true], ['local-markdown:notes', true]])

      const target = selectWriteTarget('note', [gbrain, localMd], health)
      expect(target!.id).to.equal('local-markdown:notes')
    })

    it('falls back to first writable provider for general', () => {
      const gbrain = createMockProvider('gbrain', 'gbrain', true)
      const localMd = createMockProvider('local-markdown:notes', 'local-markdown', true)
      const health = new Map([['gbrain', true], ['local-markdown:notes', true]])

      const target = selectWriteTarget('general', [gbrain, localMd], health)
      // GBrain comes first in the provider list
      expect(target!.id).to.equal('gbrain')
    })

    it('skips providers with writeSupported=false', () => {
      const obsidian = createMockProvider('obsidian', 'obsidian', false)
      const gbrain = createMockProvider('gbrain', 'gbrain', true)
      const health = new Map([['gbrain', true], ['obsidian', true]])

      const target = selectWriteTarget('entity', [obsidian, gbrain], health)
      expect(target!.id).to.equal('gbrain')
    })

    it('skips unhealthy providers', () => {
      const gbrain = createMockProvider('gbrain', 'gbrain', true)
      const localMd = createMockProvider('local-markdown:notes', 'local-markdown', true)
      const health = new Map([['gbrain', false], ['local-markdown:notes', true]])

      const target = selectWriteTarget('entity', [gbrain, localMd], health)
      // GBrain is unhealthy, falls back to local-markdown
      expect(target!.id).to.equal('local-markdown:notes')
    })

    it('returns null when no writable provider available', () => {
      const obsidian = createMockProvider('obsidian', 'obsidian', false)
      const health = new Map([['obsidian', true]])

      expect(selectWriteTarget('entity', [obsidian], health)).to.be.null
    })

    it('returns null when all writable providers are unhealthy', () => {
      const gbrain = createMockProvider('gbrain', 'gbrain', true)
      const health = new Map([['gbrain', false]])

      expect(selectWriteTarget('entity', [gbrain], health)).to.be.null
    })

    it('selects first local-markdown by config order with multiple folders', () => {
      const md1 = createMockProvider('local-markdown:notes', 'local-markdown', true)
      const md2 = createMockProvider('local-markdown:docs', 'local-markdown', true)
      const health = new Map([['local-markdown:docs', true], ['local-markdown:notes', true]])

      const target = selectWriteTarget('note', [md1, md2], health)
      expect(target!.id).to.equal('local-markdown:notes')
    })

    it('falls back to local-markdown when GBrain is unavailable for entity', () => {
      const localMd = createMockProvider('local-markdown:notes', 'local-markdown', true)
      const health = new Map([['local-markdown:notes', true]])

      const target = selectWriteTarget('entity', [localMd], health)
      expect(target!.id).to.equal('local-markdown:notes')
    })
  })
})
