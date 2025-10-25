import {Config} from '@oclif/core'
import {expect} from 'chai'
import {createSandbox, match, type SinonSandbox} from 'sinon'

import ApplyDelta from '../../../src/commands/ace/apply-delta.js'
import {DeltaBatch} from '../../../src/core/domain/entities/delta-batch.js'
import {DeltaOperation} from '../../../src/core/domain/entities/delta-operation.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {ApplyDeltaUseCase} from '../../../src/core/usecases/apply-delta-use-case.js'
import {LoadPlaybookUseCase} from '../../../src/core/usecases/load-playbook-use-case.js'

describe('ace:apply-delta', () => {
  let config: Config
  let sandbox: SinonSandbox

  before(async () => {
    config = await Config.load(import.meta.url)
  })

  beforeEach(() => {
    sandbox = createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('successful workflow', () => {
    it('should apply delta from latest file', async () => {
      const command = new ApplyDelta([], config)
      const logSpy = sandbox.spy(command, 'log')

      // Mock delta batch
      const operations = [
        new DeltaOperation('ADD', 'Best Practices', {
          content: 'Always validate user inputs',
          metadata: {
            codebasePath: '/src/validation',
            tags: ['validation', 'security'],
            timestamp: new Date().toISOString(),
          },
        }),
      ]
      const deltaBatch = new DeltaBatch('Adding validation best practice', operations)

      // Mock playbook
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).resolves('/path/to/delta.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).resolves(deltaBatch)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook content',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        operationsApplied: 1,
        playbook,
        success: true,
      })

      await command.run()

      // Verify workflow steps
      expect(logSpy.calledWith('📋 Loading delta file...')).to.be.true
      expect(logSpy.calledWith('  Using latest delta')).to.be.true
      expect(logSpy.calledWith('📚 Loading playbook...')).to.be.true
      expect(logSpy.calledWith('⚙️  Applying delta operations to playbook...')).to.be.true
      expect(logSpy.calledWith('✅ Delta operations applied successfully!')).to.be.true

      // Verify summary
      expect(logSpy.calledWith(match(/Total operations: 1/))).to.be.true
      expect(logSpy.calledWith(match(/ADD: 1/))).to.be.true
      expect(logSpy.calledWith(match(/Playbook has been updated!/))).to.be.true
    })

    it('should apply delta from specified file', async () => {
      const command = new ApplyDelta(['delta-test-hint-2025-10-25T04-59-00.902Z.json'], config)
      const logSpy = sandbox.spy(command, 'log')

      const operations = [
        new DeltaOperation('UPDATE', 'Best Practices', {
          bulletId: 'bullet-123',
          content: 'Updated content',
          metadata: {
            codebasePath: '/src',
            tags: ['updated'],
            timestamp: new Date().toISOString(),
          },
        }),
      ]
      const deltaBatch = new DeltaBatch('Updating content', operations)
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).resolves(deltaBatch)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      await command.run()

      // Verify specified file was used
      expect(logSpy.calledWith('  Using specified delta: delta-test-hint-2025-10-25T04-59-00.902Z.json')).to.be.true
      expect(logSpy.calledWith('✅ Delta operations applied successfully!')).to.be.true
    })

    it('should handle empty delta batch', async () => {
      const command = new ApplyDelta([], config)
      const logSpy = sandbox.spy(command, 'log')

      const emptyDelta = new DeltaBatch('No changes needed', [])
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).resolves('/path/to/delta.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).resolves(emptyDelta)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      await command.run()

      // Verify empty delta message
      expect(logSpy.calledWith('✅ Delta operations applied successfully!')).to.be.true
      expect(logSpy.calledWith(match(/Total operations: 0/))).to.be.true
      expect(logSpy.calledWith(match(/No operations/))).to.be.true
    })

    it('should display breakdown of multiple operation types', async () => {
      const command = new ApplyDelta([], config)
      const logSpy = sandbox.spy(command, 'log')

      const operations = [
        new DeltaOperation('ADD', 'Section1', {
          content: 'Content1',
          metadata: {
            codebasePath: '/src',
            tags: ['tag1'],
            timestamp: new Date().toISOString(),
          },
        }),
        new DeltaOperation('ADD', 'Section2', {
          content: 'Content2',
          metadata: {
            codebasePath: '/src',
            tags: ['tag2'],
            timestamp: new Date().toISOString(),
          },
        }),
        new DeltaOperation('UPDATE', 'Section3', {
          bulletId: 'bullet-123',
          content: 'Updated content',
          metadata: {
            codebasePath: '/src',
            tags: ['tag3'],
            timestamp: new Date().toISOString(),
          },
        }),
        new DeltaOperation('REMOVE', 'Section4', {
          bulletId: 'bullet-456',
        }),
      ]
      const deltaBatch = new DeltaBatch('Mixed operations', operations)
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).resolves('/path/to/delta.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).resolves(deltaBatch)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      await command.run()

      // Verify operation breakdown
      expect(logSpy.calledWith(match(/Total operations: 4/))).to.be.true
      expect(logSpy.calledWith(match(/ADD: 2/))).to.be.true
      expect(logSpy.calledWith(match(/UPDATE: 1/))).to.be.true
      expect(logSpy.calledWith(match(/REMOVE: 1/))).to.be.true
    })
  })

  describe('error handling', () => {
    it('should error when no delta files exist', async () => {
      const command = new ApplyDelta([], config)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).rejects(new Error('No files found in directory'))

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('No files found')
      }
    })

    it('should error when playbook not found', async () => {
      const command = new ApplyDelta([], config)

      const deltaBatch = new DeltaBatch('Test', [])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).resolves('/path/to/delta.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).resolves(deltaBatch)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        error: 'Playbook not found',
        success: false,
      })

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Playbook not found')
      }
    })

    it('should error when applying delta operations fails', async () => {
      const command = new ApplyDelta([], config)

      const deltaBatch = new DeltaBatch('Test', [])
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).resolves('/path/to/delta.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).resolves(deltaBatch)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        error: 'Failed to apply operations',
        success: false,
      })

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to apply')
      }
    })

    it('should error when delta file cannot be loaded', async () => {
      const command = new ApplyDelta([], config)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestDeltaFile' as any).resolves('/path/to/delta.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadDeltaBatchFile' as any).rejects(new Error('Invalid delta file format'))

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid delta file')
      }
    })
  })
})
