import {expect} from 'chai'

import {isProviderTaskError} from '../../../../../../src/webui/features/tasks/utils/is-provider-task-error'

describe('isProviderTaskError', () => {
  it('returns false for undefined error and no llmservice:error flag', () => {
    expect(isProviderTaskError({error: undefined, hadLlmServiceError: false})).to.be.false
  })

  it('matches on provider-class task error codes', () => {
    const codes = [
      'ERR_PROVIDER_NOT_CONFIGURED',
      'ERR_LLM_ERROR',
      'ERR_LLM_RATE_LIMIT',
      'ERR_OAUTH_REFRESH_FAILED',
      'ERR_OAUTH_TOKEN_EXPIRED',
    ]
    for (const code of codes) {
      expect(
        isProviderTaskError({error: {code, message: 'x'}, hadLlmServiceError: false}),
        `code=${code}`,
      ).to.be.true
    }
  })

  it('returns false for unrelated codes without llmservice:error', () => {
    expect(isProviderTaskError({error: {code: 'ERR_TASK_TIMEOUT', message: 'x'}, hadLlmServiceError: false})).to.be
      .false
    expect(isProviderTaskError({error: {code: 'ERR_AGENT_DISCONNECTED', message: 'x'}, hadLlmServiceError: false})).to
      .be.false
  })

  it('returns true when hadLlmServiceError is set, regardless of code or message', () => {
    expect(isProviderTaskError({error: {message: 'anything at all'}, hadLlmServiceError: true})).to.be.true
    expect(isProviderTaskError({error: undefined, hadLlmServiceError: true})).to.be.true
  })

  it('does not match on message text alone (no pattern heuristics)', () => {
    expect(
      isProviderTaskError({
        error: {message: 'Generation failed: rate limit — provider refused'},
        hadLlmServiceError: false,
      }),
    ).to.be.false
  })
})
