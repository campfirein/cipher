import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import {
  HarnessModeCError,
  type HarnessModeCErrorCode,
} from '../../../../src/agent/infra/harness/harness-mode-c-errors.js'
import {MODE_C_OPS_CAP, OpsCounter} from '../../../../src/agent/infra/harness/ops-counter.js'
import {
  GLOBAL_RATE_LIMITER,
  RATE_CAP_DEFAULT,
  RATE_WINDOW_MS_DEFAULT,
  RateLimiter,
  TEST_ONLY_RESET,
} from '../../../../src/agent/infra/harness/rate-limiter.js'

function expectModeCError(
  fn: () => void,
  expectedCode: HarnessModeCErrorCode,
): HarnessModeCError {
  try {
    fn()
    throw new Error('expected HarnessModeCError to be thrown')
  } catch (error) {
    expect(error).to.be.instanceOf(HarnessModeCError)
    const err = error as HarnessModeCError
    expect(err.code).to.equal(expectedCode)
    return err
  }
}

describe('Mode C safety caps', () => {
  describe('OpsCounter', () => {
    it('1. cap default is 50 ops per outer invocation', () => {
      expect(MODE_C_OPS_CAP).to.equal(50)
    })

    it('2. 50 increments succeed', () => {
      const counter = new OpsCounter()
      for (let i = 0; i < 50; i++) counter.increment()
      // no throw
    })

    it('3. 51st increment throws HarnessModeCError(OPS_CAP_EXCEEDED)', () => {
      const counter = new OpsCounter()
      for (let i = 0; i < 50; i++) counter.increment()
      const err = expectModeCError(() => counter.increment(), 'OPS_CAP_EXCEEDED')
      expect(err.details).to.deep.equal({cap: 50, count: 51})
    })

    it('4. new OpsCounter instance has fresh state (reset per outer call)', () => {
      const first = new OpsCounter()
      for (let i = 0; i < 50; i++) first.increment()

      const second = new OpsCounter()
      // 50 fresh increments succeed — second instance is unaffected by first's state.
      for (let i = 0; i < 50; i++) second.increment()
    })

    it('5. error message mentions the cap and the actual count', () => {
      const counter = new OpsCounter()
      for (let i = 0; i < 50; i++) counter.increment()
      const err = expectModeCError(() => counter.increment(), 'OPS_CAP_EXCEEDED')
      expect(err.message).to.include('51')
      expect(err.message).to.include('50')
    })
  })

  describe('RateLimiter', () => {
    let sb: SinonSandbox
    let clock: ReturnType<SinonSandbox['useFakeTimers']>
    let limiter: RateLimiter

    beforeEach(() => {
      sb = createSandbox()
      clock = sb.useFakeTimers({now: 1_700_000_000_000})
      limiter = new RateLimiter()
    })

    afterEach(() => {
      sb.restore()
    })

    it('6. defaults are 30 calls per 60_000 ms', () => {
      expect(RATE_CAP_DEFAULT).to.equal(30)
      expect(RATE_WINDOW_MS_DEFAULT).to.equal(60_000)
    })

    it('7. 30 calls within the window succeed', () => {
      for (let i = 0; i < 30; i++) limiter.checkAndRecord()
      // no throw
    })

    it('8. 31st call within the window throws HarnessModeCError(RATE_CAP_THROTTLED)', () => {
      for (let i = 0; i < 30; i++) limiter.checkAndRecord()
      const err = expectModeCError(() => limiter.checkAndRecord(), 'RATE_CAP_THROTTLED')
      expect(err.details).to.deep.equal({cap: 30, count: 31, windowMs: 60_000})
    })

    it('9. window slides — calls older than windowMs expire', () => {
      // Fill the window at T = 0
      for (let i = 0; i < 30; i++) limiter.checkAndRecord()

      // Advance past the window. Every recorded timestamp is now stale.
      clock.tick(RATE_WINDOW_MS_DEFAULT + 1)

      // 30 fresh calls succeed at the new now()
      for (let i = 0; i < 30; i++) limiter.checkAndRecord()
    })

    it('10. error message mentions the cap, count, and window', () => {
      for (let i = 0; i < 30; i++) limiter.checkAndRecord()
      const err = expectModeCError(() => limiter.checkAndRecord(), 'RATE_CAP_THROTTLED')
      expect(err.message).to.include('31')
      expect(err.message).to.include('30')
      expect(err.message).to.include('60000')
    })

    it('11. GLOBAL_RATE_LIMITER is process-wide (shared across imports)', () => {
      // Two different "sessions" would both reach for GLOBAL_RATE_LIMITER.
      // Verify that hits against it accumulate rather than per-reference.
      // `try/finally` so a mid-test throw doesn't leak global state into
      // subsequent tests.
      GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
      try {
        for (let i = 0; i < 30; i++) GLOBAL_RATE_LIMITER.checkAndRecord()
        expectModeCError(
          () => GLOBAL_RATE_LIMITER.checkAndRecord(),
          'RATE_CAP_THROTTLED',
        )
      } finally {
        GLOBAL_RATE_LIMITER[TEST_ONLY_RESET]()
      }
    })
  })

  describe('HarnessModeCError shape', () => {
    it('12. carries code + details + preserves Error semantics', () => {
      const err = new HarnessModeCError('test', 'OPS_CAP_EXCEEDED', {a: 1})
      expect(err).to.be.instanceOf(Error)
      expect(err).to.be.instanceOf(HarnessModeCError)
      expect(err.name).to.equal('HarnessModeCError')
      expect(err.code).to.equal('OPS_CAP_EXCEEDED')
      expect(err.details).to.deep.equal({a: 1})
    })
  })
})
