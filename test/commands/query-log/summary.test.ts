import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub, useFakeTimers} from 'sinon'

import QueryLogSummary from '../../../src/oclif/commands/query-log/summary.js'
import {QueryLogSummaryUseCase} from '../../../src/server/infra/usecase/query-log-summary-use-case.js'

// ============================================================================
// TestableQueryLogSummary
// ============================================================================

type MockUseCase = {run: SinonStub}

class TestableQueryLogSummary extends QueryLogSummary {
  private readonly mockUseCase: MockUseCase

  constructor(argv: string[], mockUseCase: MockUseCase, config: Config) {
    super(argv, config)
    this.mockUseCase = mockUseCase
  }

  protected override createDependencies(_baseDir: string) {
    return {
      useCase: this.mockUseCase as unknown as ReturnType<QueryLogSummary['createDependencies']>['useCase'],
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

const NOW = 1_700_000_000_000
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

describe('QueryLogSummary Command', () => {
  let config: Config
  let loggedMessages: string[]
  let mockUseCase: MockUseCase
  let sandbox: SinonSandbox

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    sandbox = createSandbox()
    loggedMessages = []
    mockUseCase = {run: sandbox.stub().resolves()}
  })

  afterEach(() => {
    sandbox.restore()
  })

  function createCommand(...argv: string[]): TestableQueryLogSummary {
    const command = new TestableQueryLogSummary(argv, mockUseCase, config)
    sandbox.stub(command, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    return command
  }

  // ==========================================================================
  // Default flags
  // ==========================================================================

  describe('default flags', () => {
    it('should default to last 24h when no time flags provided', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand().run()

        expect(mockUseCase.run.calledOnce).to.be.true
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - DAY_MS)
        expect(opts.before).to.be.undefined
        expect(opts.format).to.equal('text')
      } finally {
        clock.restore()
      }
    })
  })

  // ==========================================================================
  // --last flag
  // ==========================================================================

  describe('--last flag', () => {
    it('should parse --last 24h', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--last', '24h').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - DAY_MS)
      } finally {
        clock.restore()
      }
    })

    it('should parse --last 7d', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--last', '7d').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - 7 * DAY_MS)
      } finally {
        clock.restore()
      }
    })

    it('should parse --last 30d', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--last', '30d').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - 30 * DAY_MS)
      } finally {
        clock.restore()
      }
    })

    it('should parse --last 1h', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--last', '1h').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - HOUR_MS)
      } finally {
        clock.restore()
      }
    })
  })

  // ==========================================================================
  // --last precedence over --since
  // ==========================================================================

  describe('--last precedence over --since', () => {
    it('should use --last when both --last and --since are provided', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--last', '7d', '--since', '2024-01-01').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - 7 * DAY_MS)
        // And NOT the --since value
        expect(opts.after).to.not.equal(new Date('2024-01-01').getTime())
      } finally {
        clock.restore()
      }
    })
  })

  // ==========================================================================
  // --since and --before flags
  // ==========================================================================

  describe('--since flag', () => {
    it('should parse relative --since 1h', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--since', '1h').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - HOUR_MS)
      } finally {
        clock.restore()
      }
    })

    it('should parse absolute --since date', async () => {
      await createCommand('--since', '2026-04-01').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.after).to.equal(new Date('2026-04-01').getTime())
    })
  })

  describe('--before flag', () => {
    it('should parse --before as before timestamp', async () => {
      await createCommand('--before', '2026-04-03').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.before).to.equal(new Date('2026-04-03').getTime())
    })

    it('should leave after undefined when only --before is provided', async () => {
      await createCommand('--before', '2026-04-03').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.after).to.be.undefined
    })

    it('should accept --since and --before together', async () => {
      await createCommand('--since', '2026-04-01', '--before', '2026-04-03').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.after).to.equal(new Date('2026-04-01').getTime())
      expect(opts.before).to.equal(new Date('2026-04-03').getTime())
    })
  })

  // ==========================================================================
  // --format flag
  // ==========================================================================

  describe('--format flag', () => {
    it('should pass --format json to useCase', async () => {
      await createCommand('--format', 'json').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.format).to.equal('json')
    })

    it('should pass --format narrative to useCase', async () => {
      await createCommand('--format', 'narrative').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.format).to.equal('narrative')
    })

    it('should pass --format text to useCase', async () => {
      await createCommand('--format', 'text').run()
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.format).to.equal('text')
    })

    it('should reject unknown --format value', async () => {
      try {
        await createCommand('--format', 'invalid').run()
        expect.fail('Expected command to throw on invalid format')
      } catch (error: unknown) {
        const err = error as {oclif: {exit: number}}
        expect(err.oclif.exit).to.equal(2)
      }
    })
  })

  // ==========================================================================
  // Error handling
  // ==========================================================================

  describe('error handling', () => {
    it('should exit with code 2 for invalid --since value', async () => {
      try {
        await createCommand('--since', 'not-a-date').run()
        expect.fail('Expected command to throw')
      } catch (error: unknown) {
        const err = error as {oclif: {exit: number}}
        expect(err.oclif.exit).to.equal(2)
      }
    })

    it('should exit with code 2 for invalid --before value', async () => {
      try {
        await createCommand('--before', 'not-a-date').run()
        expect.fail('Expected command to throw')
      } catch (error: unknown) {
        const err = error as {oclif: {exit: number}}
        expect(err.oclif.exit).to.equal(2)
      }
    })

    it('should exit with code 2 for invalid --last value', async () => {
      try {
        await createCommand('--last', 'foo').run()
        expect.fail('Expected command to throw')
      } catch (error: unknown) {
        const err = error as {oclif: {exit: number}}
        expect(err.oclif.exit).to.equal(2)
      }
    })
  })

  // ==========================================================================
  // Full flag forwarding
  // ==========================================================================

  describe('full flag forwarding', () => {
    it('should forward all flags together', async () => {
      const clock = useFakeTimers({now: NOW, toFake: ['Date']})
      try {
        await createCommand('--last', '7d', '--format', 'json').run()
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(NOW - 7 * DAY_MS)
        expect(opts.before).to.be.undefined
        expect(opts.format).to.equal('json')
      } finally {
        clock.restore()
      }
    })
  })

  // ==========================================================================
  // Store instantiation
  // ==========================================================================

  describe('store instantiation', () => {
    class RealDepsQueryLogSummary extends QueryLogSummary {
      public exposedCreateDependencies(baseDir: string) {
        return this.createDependencies(baseDir)
      }
    }

    it('should create QueryLogSummaryUseCase from FileQueryLogStore and terminal', () => {
      const command = new RealDepsQueryLogSummary([], config)
      sandbox.stub(command, 'log')
      const {useCase} = command.exposedCreateDependencies('/test/project/.brv')

      expect(useCase).to.be.instanceOf(QueryLogSummaryUseCase)
    })
  })
})
