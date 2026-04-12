import {expect} from 'chai'

import type {SearchKnowledgeResult} from '../../../../src/agent/infra/sandbox/tools-sdk.js'

import {formatSearchTextOutput} from '../../../../src/oclif/lib/search-format.js'

// ---------------------------------------------------------------------------
// formatSearchTextOutput
// ---------------------------------------------------------------------------

describe('formatSearchTextOutput', () => {
  it('returns "No results found" for empty results', () => {
    const result: SearchKnowledgeResult = {message: '', results: [], totalFound: 0}
    const lines = formatSearchTextOutput(result)
    expect(lines.some((l) => l.includes('No results found'))).to.be.true
  })

  it('shows "Found N results" when all displayed', () => {
    const result: SearchKnowledgeResult = {
      message: '',
      results: [
        {excerpt: 'JWT tokens', path: 'auth/jwt.md', score: 0.91, title: 'JWT'},
        {excerpt: 'OAuth flow', path: 'auth/oauth.md', score: 0.85, title: 'OAuth'},
      ],
      totalFound: 2,
    }
    const lines = formatSearchTextOutput(result)
    expect(lines.some((l) => l.includes('Found 2 results'))).to.be.true
  })

  it('shows "Showing X of Y results" when limited', () => {
    const result: SearchKnowledgeResult = {
      message: '',
      results: [{excerpt: 'JWT tokens', path: 'auth/jwt.md', score: 0.91, title: 'JWT'}],
      totalFound: 15,
    }
    const lines = formatSearchTextOutput(result)
    expect(lines.some((l) => l.includes('Showing 1 of 15 results'))).to.be.true
  })

  it('displays title, path, score, and excerpt for each result', () => {
    const result: SearchKnowledgeResult = {
      message: '',
      results: [{excerpt: 'Tokens stored in httpOnly cookies', path: 'auth/jwt.md', score: 0.91, title: 'JWT Auth'}],
      totalFound: 1,
    }
    const lines = formatSearchTextOutput(result)
    const text = lines.join('\n')
    expect(text).to.include('JWT Auth')
    expect(text).to.include('auth/jwt.md')
    expect(text).to.include('91%')
    expect(text).to.include('Tokens stored in httpOnly cookies')
  })

  it('truncates long excerpts at 120 chars', () => {
    const longExcerpt = 'A'.repeat(200)
    const result: SearchKnowledgeResult = {
      message: '',
      results: [{excerpt: longExcerpt, path: 'test.md', score: 0.5, title: 'Test'}],
      totalFound: 1,
    }
    const lines = formatSearchTextOutput(result)
    const excerptLine = lines.find((l) => l.includes('AAA'))
    expect(excerptLine).to.exist
    expect(excerptLine?.length ?? 0).to.be.lessThan(200)
    expect(excerptLine).to.include('...')
  })

  it('displays backlink count when present', () => {
    const result: SearchKnowledgeResult = {
      message: '',
      results: [{backlinkCount: 7, excerpt: 'test', path: 'test.md', score: 0.5, title: 'Test'}],
      totalFound: 1,
    }
    const lines = formatSearchTextOutput(result)
    expect(lines.some((l) => l.includes('Backlinks: 7'))).to.be.true
  })

  it('omits backlinks line when count is 0 or absent', () => {
    const result: SearchKnowledgeResult = {
      message: '',
      results: [{excerpt: 'test', path: 'test.md', score: 0.5, title: 'Test'}],
      totalFound: 1,
    }
    const lines = formatSearchTextOutput(result)
    expect(lines.some((l) => l.includes('Backlinks'))).to.be.false
  })

  it('handles singular "Found 1 result"', () => {
    const result: SearchKnowledgeResult = {
      message: '',
      results: [{excerpt: 'test', path: 'test.md', score: 0.5, title: 'Test'}],
      totalFound: 1,
    }
    const lines = formatSearchTextOutput(result)
    expect(lines.some((l) => l.includes('Found 1 result:'))).to.be.true
    expect(lines.some((l) => l.includes('results'))).to.be.false
  })
})
