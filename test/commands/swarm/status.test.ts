import {expect} from 'chai'

import SwarmStatus, {findSwarmStatusSuggestions, formatEnrichmentEdges} from '../../../src/oclif/commands/swarm/status.js'

describe('SwarmStatus command', () => {
  it('has correct description', () => {
    expect(SwarmStatus.description).to.include('memory swarm')
    expect(SwarmStatus.description).to.include('health')
  })

  it('supports text and json format flags', () => {
    expect(SwarmStatus.flags.format).to.exist
  })

  it('can be instantiated', () => {
    expect(SwarmStatus).to.have.property('description')
    expect(SwarmStatus.prototype).to.have.property('run')
  })

  it('suggests additional detected obsidian vaults that are not in config', () => {
    const suggestions = findSwarmStatusSuggestions({
      providers: {
        byterover: {enabled: true},
        obsidian: {enabled: true, vaultPath: '/vaults/alpha'},
      },
    } as never, [
      {detected: true, id: 'byterover', type: 'local'},
      {detected: true, id: 'obsidian', path: '/vaults/alpha', type: 'local'},
      {detected: true, id: 'obsidian', path: '/vaults/beta', type: 'local'},
    ])

    expect(suggestions).to.have.length(1)
    expect(suggestions[0]).to.include('/vaults/beta')
  })

  it('suggests additional detected markdown folders that are not in config', () => {
    const suggestions = findSwarmStatusSuggestions({
      providers: {
        byterover: {enabled: true},
        localMarkdown: {
          enabled: true,
          folders: [{followWikilinks: true, name: 'notes', path: '/notes/alpha', readOnly: true}],
        },
      },
    } as never, [
      {detected: true, id: 'local-markdown', path: '/notes/alpha', type: 'local'},
      {detected: true, id: 'local-markdown', path: '/notes/beta', type: 'local'},
    ])

    expect(suggestions).to.have.length(1)
    expect(suggestions[0]).to.include('/notes/beta')
  })

  describe('formatEnrichmentEdges', () => {
    it('returns empty array when no edges configured', () => {
      expect(formatEnrichmentEdges([])).to.deep.equal([])
    })

    it('formats edges as "from → to" lines', () => {
      const lines = formatEnrichmentEdges([
        {from: 'byterover', to: 'obsidian'},
        {from: 'byterover', to: 'local-markdown'},
      ])
      expect(lines).to.have.length(2)
      expect(lines[0]).to.include('byterover')
      expect(lines[0]).to.include('obsidian')
      expect(lines[1]).to.include('local-markdown')
    })
  })
})
