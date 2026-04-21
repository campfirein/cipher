import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub, useFakeTimers} from 'sinon'

import QueryLogView from '../../../src/oclif/commands/query-log/view.js'
import {QueryLogUseCase} from '../../../src/server/infra/usecase/query-log-use-case.js'

// ==================== TestableQueryLogView ====================

type MockUseCase = {run: SinonStub}

class TestableQueryLogView extends QueryLogView {
  private readonly mockUseCase: MockUseCase

  constructor(argv: string[], mockUseCase: MockUseCase, config: Config) {
    super(argv, config)
    this.mockUseCase = mockUseCase
  }

  protected override createDependencies(_baseDir: string) {
    return {useCase: this.mockUseCase as unknown as ReturnType<QueryLogView['createDependencies']>['useCase']}
  }
}

// ==================== Tests ====================

describe('QueryLogView Command', () => {
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

  function createCommand(...argv: string[]): TestableQueryLogView {
    const command = new TestableQueryLogView(argv, mockUseCase, config)
    sandbox.stub(command, 'log').callsFake((msg?: string) => {
      loggedMessages.push(msg ?? '')
    })
    return command
  }

  // ==================== Default flags ====================

  describe('default flags', () => {
    it('should call useCase.run with defaults when no flags provided', async () => {
      await createCommand().run()

      expect(mockUseCase.run.calledOnce).to.be.true
      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.limit).to.equal(10)
      expect(opts.format).to.equal('text')
      expect(opts.detail).to.equal(false)
      expect(opts.id).to.be.undefined
      expect(opts.status).to.be.undefined
      expect(opts.tier).to.be.undefined
      expect(opts.after).to.be.undefined
      expect(opts.before).to.be.undefined
    })
  })

  // ==================== Flag parsing ====================

  describe('flag parsing', () => {
    it('should pass --limit to useCase', async () => {
      await createCommand('--limit', '20').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.limit).to.equal(20)
    })

    it('should pass --format json to useCase', async () => {
      await createCommand('--format', 'json').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.format).to.equal('json')
    })

    it('should pass --detail to useCase', async () => {
      await createCommand('--detail').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.detail).to.equal(true)
    })

    it('should pass single --status to useCase', async () => {
      await createCommand('--status', 'completed').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.status).to.deep.equal(['completed'])
    })

    it('should pass multiple --status to useCase', async () => {
      await createCommand('--status', 'completed', '--status', 'error').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.status).to.deep.equal(['completed', 'error'])
    })

    it('should pass single --tier to useCase', async () => {
      await createCommand('--tier', '0').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.tier).to.deep.equal([0])
    })

    it('should pass multiple --tier to useCase', async () => {
      await createCommand('--tier', '0', '--tier', '1').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.tier).to.deep.equal([0, 1])
    })

    it('should parse --since as after timestamp', async () => {
      const clock = useFakeTimers({now: 1_700_000_000_000, toFake: ['Date']})
      try {
        await createCommand('--since', '1h').run()

        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.after).to.equal(1_700_000_000_000 - 3_600_000)
      } finally {
        clock.restore()
      }
    })

    it('should parse --before as before timestamp', async () => {
      await createCommand('--before', '2024-01-15').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.before).to.equal(new Date('2024-01-15').getTime())
    })
  })

  // ==================== Positional arg ====================

  describe('positional id arg', () => {
    it('should pass id to useCase when provided', async () => {
      await createCommand('qry-1712345678901').run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.id).to.equal('qry-1712345678901')
    })

    it('should not pass id when not provided', async () => {
      await createCommand().run()

      const opts = mockUseCase.run.firstCall.args[0]
      expect(opts.id).to.be.undefined
    })
  })

  // ==================== Error handling ====================

  describe('error handling', () => {
    it('should exit with code 2 for invalid --since value', async () => {
      try {
        await createCommand('--since', 'invalid').run()
        expect.fail('Expected command to throw')
      } catch (error: unknown) {
        const err = error as {code: string; oclif: {exit: number}}
        expect(err.oclif.exit).to.equal(2)
      }
    })

    it('should exit with code 2 for invalid --before value', async () => {
      try {
        await createCommand('--before', 'not-a-date').run()
        expect.fail('Expected command to throw')
      } catch (error: unknown) {
        const err = error as {code: string; oclif: {exit: number}}
        expect(err.oclif.exit).to.equal(2)
      }
    })
  })

  // ==================== Store instantiation ====================

  describe('store instantiation', () => {
    // Subclass that exposes the real createDependencies (no mock override)
    class RealDepsQueryLogView extends QueryLogView {
      public exposedCreateDependencies(baseDir: string) {
        return this.createDependencies(baseDir)
      }
    }

    it('should create QueryLogUseCase from FileQueryLogStore and terminal', () => {
      const command = new RealDepsQueryLogView([], config)
      sandbox.stub(command, 'log')
      const {useCase} = command.exposedCreateDependencies('/test/project/.brv')

      expect(useCase).to.be.instanceOf(QueryLogUseCase)
    })
  })

  // ==================== Delegation ====================

  describe('use-case delegation', () => {
    it('should forward all flags and args together', async () => {
      const clock = useFakeTimers({now: 1_700_000_000_000, toFake: ['Date']})
      try {
        await createCommand(
          'qry-123',
          '--limit',
          '5',
          '--format',
          'json',
          '--detail',
          '--status',
          'completed',
          '--tier',
          '2',
          '--since',
          '24h',
          '--before',
          '2024-12-31',
        ).run()

        expect(mockUseCase.run.calledOnce).to.be.true
        const opts = mockUseCase.run.firstCall.args[0]
        expect(opts.id).to.equal('qry-123')
        expect(opts.limit).to.equal(5)
        expect(opts.format).to.equal('json')
        expect(opts.detail).to.equal(true)
        expect(opts.status).to.deep.equal(['completed'])
        expect(opts.tier).to.deep.equal([2])
        expect(opts.after).to.equal(1_700_000_000_000 - 24 * 3_600_000)
        expect(opts.before).to.equal(new Date('2024-12-31').getTime())
      } finally {
        clock.restore()
      }
    })
  })
})
