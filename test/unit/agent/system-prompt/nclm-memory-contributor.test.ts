/* eslint-disable camelcase */
import {expect} from 'chai'

import type {ContributorContext} from '../../../../src/agent/core/domain/system-prompt/types.js'

import {MemoryStore} from '../../../../src/agent/infra/nclm/memory-store.js'
import {NCLMMemoryContributor} from '../../../../src/agent/infra/system-prompt/contributors/nclm-memory-contributor.js'

describe('NCLMMemoryContributor', () => {
  let store: MemoryStore
  let contributor: NCLMMemoryContributor
  const context: ContributorContext = {}

  beforeEach(() => {
    store = new MemoryStore()
    contributor = new NCLMMemoryContributor(store)
  })

  it('has id nclm-memory', () => {
    expect(contributor.id).to.equal('nclm-memory')
  })

  it('has priority 18', () => {
    expect(contributor.priority).to.equal(18)
  })

  it('returns empty string when memory is empty', async () => {
    const result = await contributor.getContent(context)
    expect(result).to.equal('')
  })

  it('returns injection string when entries exist', async () => {
    store.write({content: 'Token rotation every 24h', tags: ['auth'], title: 'JWT policy'})
    const result = await contributor.getContent(context)
    expect(result).to.be.a('string')
    expect(result.length).to.be.greaterThan(0)
    expect(result).to.include('JWT policy')
  })

  it('includes active entries in injection', async () => {
    store.write({content: 'Should appear in injection', title: 'Active entry'})
    const result = await contributor.getContent(context)
    expect(result).to.include('Active entry')
  })

  it('includes summary entries in injection', async () => {
    const entry = store.write({content: 'Condensed knowledge', title: 'Summary entry'})
    entry.entry_type = 'summary'
    const result = await contributor.getContent(context)
    expect(result).to.include('Summary entry')
  })

  it('includes archive stubs in injection', async () => {
    const entry = store.write({content: 'Old but searchable content', title: 'Archived note'})
    store.archive(entry.id)
    const result = await contributor.getContent(context)
    expect(result).to.include('Archived note')
  })

  it('includes stats footer in injection', async () => {
    store.write({content: 'Content', title: 'Stats test'})
    const result = await contributor.getContent(context)
    expect(result).to.include('1 active')
  })

  it('implements SystemPromptContributor with ContributorContext parameter', async () => {
    // Verify getContent accepts ContributorContext with various fields
    const richContext: ContributorContext = {
      availableTools: ['code_exec'],
      commandType: 'query',
    }

    // Should not throw regardless of context contents
    const result = await contributor.getContent(richContext)
    expect(result).to.be.a('string')
  })
})
