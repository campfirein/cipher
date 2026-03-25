 
import {expect} from 'chai'

import {decomposeQuery} from '../../../../../src/server/infra/harness/query/query-decomposer-template.js'

describe('decomposeQuery', () => {
  it('expands query with synonym matches', () => {
    const template = `
synonyms:
  auth:
    - authentication
    - authorization
  api:
    - endpoint
    - rest
domainHints: []
`
    const result = decomposeQuery('auth api', template)
    expect(result.originalQuery).to.equal('auth api')
    expect(result.expandedTerms).to.include('authentication')
    expect(result.expandedTerms).to.include('authorization')
    expect(result.expandedTerms).to.include('endpoint')
    expect(result.expandedTerms).to.include('rest')
  })

  it('returns original query unchanged when no synonyms match', () => {
    const template = `
synonyms:
  database:
    - db
    - sql
domainHints: []
`
    const result = decomposeQuery('auth api', template)
    expect(result.originalQuery).to.equal('auth api')
    expect(result.expandedTerms).to.deep.equal([])
    expect(result.domainHints).to.deep.equal([])
  })

  it('extracts domain hints from query patterns', () => {
    const template = `
synonyms: {}
domainHints:
  - queryPattern: "login"
    preferDomains:
      - auth
      - security
  - queryPattern: "deploy"
    preferDomains:
      - infrastructure
`
    const result = decomposeQuery('how to login', template)
    expect(result.domainHints).to.include('auth')
    expect(result.domainHints).to.include('security')
    expect(result.domainHints).to.not.include('infrastructure')
  })

  it('matches wildcard query patterns', () => {
    const template = `
synonyms: {}
domainHints:
  - queryPattern: "how does * work"
    preferDomains:
      - architecture
`
    const result = decomposeQuery('how does auth work', template)
    expect(result.domainHints).to.include('architecture')
  })

  it('does not match wildcard pattern against non-matching query', () => {
    const template = `
synonyms: {}
domainHints:
  - queryPattern: "how does * work"
    preferDomains:
      - architecture
`
    const result = decomposeQuery('what is auth', template)
    expect(result.domainHints).to.not.include('architecture')
  })

  it('handles empty/invalid YAML template gracefully', () => {
    const result = decomposeQuery('test query', ':::invalid yaml:::')
    expect(result.originalQuery).to.equal('test query')
    expect(result.expandedTerms).to.deep.equal([])
    expect(result.domainHints).to.deep.equal([])
  })

  it('handles empty query', () => {
    const template = `
synonyms:
  test:
    - exam
domainHints: []
`
    const result = decomposeQuery('', template)
    expect(result.originalQuery).to.equal('')
    expect(result.expandedTerms).to.deep.equal([])
    expect(result.domainHints).to.deep.equal([])
  })
})
