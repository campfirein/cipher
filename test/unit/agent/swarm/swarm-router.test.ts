import {expect} from 'chai'

import {classifyQuery, selectProviders} from '../../../../src/agent/infra/swarm/swarm-router.js'

describe('SwarmRouter', () => {
  describe('classifyQuery', () => {
    it('classifies temporal queries', () => {
      expect(classifyQuery('what happened yesterday')).to.equal('temporal')
      expect(classifyQuery('changes from last week')).to.equal('temporal')
      expect(classifyQuery('recently updated files')).to.equal('temporal')
      expect(classifyQuery('since March')).to.equal('temporal')
    })

    it('classifies personal queries', () => {
      expect(classifyQuery('I prefer functional style')).to.equal('personal')
      expect(classifyQuery('how do I usually handle errors')).to.equal('personal')
      expect(classifyQuery('my opinion on REST vs GraphQL')).to.equal('personal')
    })

    it('classifies relational queries', () => {
      expect(classifyQuery('what is related to auth tokens')).to.equal('relational')
      expect(classifyQuery('modules that depend on the logger')).to.equal('relational')
      expect(classifyQuery('concepts connected to caching')).to.equal('relational')
    })

    it('defaults to factual', () => {
      expect(classifyQuery('what is JWT')).to.equal('factual')
      expect(classifyQuery('how does the API work')).to.equal('factual')
      expect(classifyQuery('explain the config schema')).to.equal('factual')
    })
  })

  describe('selectProviders', () => {
    const allProviders = ['byterover', 'obsidian', 'local-markdown:notes', 'honcho', 'hindsight', 'gbrain']

    it('always includes byterover', () => {
      for (const type of ['factual', 'temporal', 'personal', 'relational'] as const) {
        const selected = selectProviders(type, allProviders)
        expect(selected).to.include('byterover')
      }
    })

    it('includes local providers for factual queries', () => {
      const selected = selectProviders('factual', allProviders)
      expect(selected).to.include('byterover')
      expect(selected).to.include('obsidian')
      expect(selected).to.include('local-markdown:notes')
    })

    it('includes hindsight for temporal queries', () => {
      const selected = selectProviders('temporal', allProviders)
      expect(selected).to.include('hindsight')
    })

    it('includes honcho for personal queries', () => {
      const selected = selectProviders('personal', allProviders)
      expect(selected).to.include('honcho')
    })

    it('includes obsidian and hindsight for relational queries', () => {
      const selected = selectProviders('relational', allProviders)
      expect(selected).to.include('obsidian')
    })

    it('only returns providers that are in the available list', () => {
      const selected = selectProviders('temporal', ['byterover', 'obsidian'])
      expect(selected).to.not.include('hindsight')
    })
  })
})
