/**
 * RecordAnswerExecutor tests (Phase 5 Task 5.4).
 *
 * Closes the cache loop after agent-side synthesis. Tier-0 hits on the
 * SAME query+fingerprint must work after recording.
 *
 * Critical invariant: when the daemon was started without cache, this
 * executor still resolves successfully (recorded: false) — never throws.
 * Skill/hook agents shouldn't blow up just because cache is disabled.
 */

import {expect} from 'chai'
import {stub} from 'sinon'

import {QueryResultCache} from '../../../../src/server/infra/executor/query-result-cache.js'
import {RecordAnswerExecutor} from '../../../../src/server/infra/executor/record-answer-executor.js'

const QUERY = 'how does authentication work'
const ANSWER = 'Auth uses JWTs with 24h expiry. Tokens stored in httpOnly cookies.'
const FINGERPRINT = 'fp-test-001'

describe('RecordAnswerExecutor', () => {
  describe('with cache configured', () => {
    it('writes the answer into the cache and returns recorded: true', async () => {
      const cache = new QueryResultCache()
      const executor = new RecordAnswerExecutor({cache})

      const result = await executor.execute({answer: ANSWER, fingerprint: FINGERPRINT, query: QUERY})

      expect(result.recorded).to.equal(true)
      expect(result.fingerprint).to.equal(FINGERPRINT)
      // Cache should now have a tier-0 hit for the same query+fingerprint
      expect(cache.get(QUERY, FINGERPRINT)).to.equal(ANSWER)
    })

    it('overwrites a prior cache entry (idempotent refresh per §8 Q2)', async () => {
      const cache = new QueryResultCache()
      cache.set(QUERY, 'STALE-ANSWER', FINGERPRINT)
      const executor = new RecordAnswerExecutor({cache})

      await executor.execute({answer: ANSWER, fingerprint: FINGERPRINT, query: QUERY})

      expect(cache.get(QUERY, FINGERPRINT)).to.equal(ANSWER)
    })

    it('isolates cache entries by fingerprint (different fingerprint → no shadow)', async () => {
      const cache = new QueryResultCache()
      const executor = new RecordAnswerExecutor({cache})

      await executor.execute({answer: ANSWER, fingerprint: FINGERPRINT, query: QUERY})

      expect(cache.get(QUERY, 'different-fingerprint')).to.be.undefined
    })

    it('returns recorded: true even when cache.set throws (graceful — telemetry left to caller)', async () => {
      const cache = new QueryResultCache()
      stub(cache, 'set').throws(new Error('cache full'))
      const executor = new RecordAnswerExecutor({cache})

      const result = await executor.execute({answer: ANSWER, fingerprint: FINGERPRINT, query: QUERY})

      expect(result.recorded).to.equal(false)
      expect(result.fingerprint).to.equal(FINGERPRINT)
    })
  })

  describe('without cache configured', () => {
    it('returns recorded: false but does not throw', async () => {
      const executor = new RecordAnswerExecutor({})

      const result = await executor.execute({answer: ANSWER, fingerprint: FINGERPRINT, query: QUERY})

      expect(result.recorded).to.equal(false)
      expect(result.fingerprint).to.equal(FINGERPRINT)
    })
  })
})
