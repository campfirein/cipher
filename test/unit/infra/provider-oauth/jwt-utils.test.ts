/* eslint-disable camelcase -- JWT claims use snake_case per OAuth/OIDC spec */
import {expect} from 'chai'

import {parseAccountIdFromIdToken} from '../../../../src/server/infra/provider-oauth/jwt-utils.js'

// Helper to create a test JWT with the given payload (no signature verification needed)
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'JWT'})).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.fake-signature`
}

// ==================== Tests ====================

describe('parseAccountIdFromIdToken', () => {
  it('should extract chatgpt_account_id from top-level claim', () => {
    const token = makeJwt({chatgpt_account_id: 'acct_abc123', sub: 'user-123'})
    expect(parseAccountIdFromIdToken(token)).to.equal('acct_abc123')
  })

  it('should extract chatgpt_account_id from nested OpenAI auth namespace', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {chatgpt_account_id: 'acct_nested456'},
      sub: 'user-123',
    })
    expect(parseAccountIdFromIdToken(token)).to.equal('acct_nested456')
  })

  it('should extract organization ID as fallback', () => {
    const token = makeJwt({
      organizations: [{id: 'org-fallback789', name: 'My Org'}],
      sub: 'user-123',
    })
    expect(parseAccountIdFromIdToken(token)).to.equal('org-fallback789')
  })

  it('should prefer top-level claim over nested claim', () => {
    const token = makeJwt({
      chatgpt_account_id: 'acct_top',
      'https://api.openai.com/auth': {chatgpt_account_id: 'acct_nested'},
      organizations: [{id: 'org-fallback'}],
    })
    expect(parseAccountIdFromIdToken(token)).to.equal('acct_top')
  })

  it('should prefer nested claim over organizations fallback', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {chatgpt_account_id: 'acct_nested'},
      organizations: [{id: 'org-fallback'}],
    })
    expect(parseAccountIdFromIdToken(token)).to.equal('acct_nested')
  })

  it('should return undefined for JWT with no matching claims', () => {
    const token = makeJwt({email: 'test@example.com', sub: 'user-123'})
    expect(parseAccountIdFromIdToken(token)).to.be.undefined
  })

  it('should return undefined for empty organizations array', () => {
    const token = makeJwt({organizations: [], sub: 'user-123'})
    expect(parseAccountIdFromIdToken(token)).to.be.undefined
  })

  it('should return undefined for malformed JWT (missing parts)', () => {
    expect(parseAccountIdFromIdToken('not-a-jwt')).to.be.undefined
  })

  it('should return undefined for empty string', () => {
    expect(parseAccountIdFromIdToken('')).to.be.undefined
  })

  it('should return undefined for JWT with invalid base64 payload', () => {
    expect(parseAccountIdFromIdToken('header.!!!invalid!!!.signature')).to.be.undefined
  })

  it('should return undefined for JWT with non-object payload', () => {
    const header = Buffer.from('{}').toString('base64url')
    const body = Buffer.from('"just a string"').toString('base64url')
    expect(parseAccountIdFromIdToken(`${header}.${body}.sig`)).to.be.undefined
  })

  it('should skip empty string chatgpt_account_id at top level', () => {
    const token = makeJwt({
      chatgpt_account_id: '',
      'https://api.openai.com/auth': {chatgpt_account_id: 'acct_nested'},
    })
    expect(parseAccountIdFromIdToken(token)).to.equal('acct_nested')
  })

  it('should skip empty string chatgpt_account_id in nested namespace', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {chatgpt_account_id: ''},
      organizations: [{id: 'org-123'}],
    })
    expect(parseAccountIdFromIdToken(token)).to.equal('org-123')
  })

  it('should skip organization with empty id', () => {
    const token = makeJwt({organizations: [{id: '', name: 'Empty'}]})
    expect(parseAccountIdFromIdToken(token)).to.be.undefined
  })
})
