import type {Config} from '@oclif/core'

import {Config as OclifConfig, ux} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {DeltaBatch} from '../../src/core/domain/entities/delta-batch.js'
import type {ExecutorOutput} from '../../src/core/domain/entities/executor-output.js'
import type {Playbook} from '../../src/core/domain/entities/playbook.js'
import type {ReflectorOutput} from '../../src/core/domain/entities/reflector-output.js'
import type {IAcePromptBuilder} from '../../src/core/interfaces/i-ace-prompt-builder.js'
import type {IDeltaStore} from '../../src/core/interfaces/i-delta-store.js'
import type {IExecutorOutputStore} from '../../src/core/interfaces/i-executor-output-store.js'
import type {IPlaybookService} from '../../src/core/interfaces/i-playbook-service.js'
import type {IReflectionStore} from '../../src/core/interfaces/i-reflection-store.js'

import Complete from '../../src/commands/complete.js'
import {Bullet} from '../../src/core/domain/entities/bullet.js'
import {Playbook as PlaybookImpl} from '../../src/core/domain/entities/playbook.js'
import {FilePlaybookStore} from '../../src/infra/ace/file-playbook-store.js'

/**
 * Testable Complete command that accepts mocked services
 */
class TestableAce extends Complete {
  // eslint-disable-next-line max-params
  public constructor(
    private readonly mockDeltaStore: IDeltaStore,
    private readonly mockExecutorOutputStore: IExecutorOutputStore,
    private readonly mockPlaybookService: IPlaybookService,
    private readonly mockPromptBuilder: IAcePromptBuilder,
    private readonly mockReflectionStore: IReflectionStore,
    config: Config,
    argv: string[] = [],
  ) {
    super(argv, config)
  }

  protected createServices() {
    return {
      deltaStore: this.mockDeltaStore,
      executorOutputStore: this.mockExecutorOutputStore,
      playbookService: this.mockPlaybookService,
      promptBuilder: this.mockPromptBuilder,
      reflectionStore: this.mockReflectionStore,
    }
  }

  // Suppress all output to prevent noisy test runs
  public error(input: Error | string): never {
    // Throw error to maintain behavior but suppress output
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }

  public warn(input: Error | string): Error | string {
    // Do nothing - suppress output, but return input to match base signature
    return input
  }
}

describe('Complete Command', () => {
  let config: Config
  let deltaStore: sinon.SinonStubbedInstance<IDeltaStore>
  let executorOutputStore: sinon.SinonStubbedInstance<IExecutorOutputStore>
  let filePlaybookStoreLoadStub: sinon.SinonStub
  let playbookService: sinon.SinonStubbedInstance<IPlaybookService>
  let promptBuilder: sinon.SinonStubbedInstance<IAcePromptBuilder>
  let reflectionStore: sinon.SinonStubbedInstance<IReflectionStore>
  let testPlaybook: Playbook
  let uxActionStartStub: sinon.SinonStub
  let uxActionStopStub: sinon.SinonStub

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    uxActionStartStub = stub(ux.action, 'start')
    uxActionStopStub = stub(ux.action, 'stop')

    executorOutputStore = {
      save: stub(),
    }

    reflectionStore = {
      loadRecent: stub(),
      save: stub(),
    }

    deltaStore = {
      save: stub(),
    }

    playbookService = {
      addOrUpdateBullet: stub(),
      applyDelta: stub(),
      applyReflectionTags: stub(),
      initialize: stub(),
    }

    promptBuilder = {
      buildCuratorPrompt: stub(),
      buildExecutorPrompt: stub(),
      buildReflectorPrompt: stub(),
    }

    // Create test playbook with a bullet for update tests
    const testBullet = new Bullet('bullet-5', 'Lessons Learned', 'Existing bullet content', {
      relatedFiles: ['test/file.ts'],
      tags: ['test'],
      timestamp: new Date().toISOString(),
    })
    const bulletsMap = new Map<string, Bullet>()
    bulletsMap.set('bullet-5', testBullet)
    testPlaybook = new PlaybookImpl(bulletsMap)

    // Stub FilePlaybookStore.prototype.load - default to success
    filePlaybookStoreLoadStub = stub(FilePlaybookStore.prototype, 'load').resolves(testPlaybook)
  })

  afterEach(() => {
    uxActionStartStub.restore()
    uxActionStopStub.restore()
    filePlaybookStoreLoadStub.restore()
    restore()
  })

  describe('Successful execution', () => {
    it('should complete all 3 phases successfully with ADD operation', async () => {
      const argv = [
        'user-auth',
        'Implemented OAuth2 flow',
        'Auth works',
        '--tool-usage',
        'Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test',
        '--feedback',
        'All tests passed',
        '--bullet-ids',
        'bullet-1,bullet-2',
      ]

      // Mock successful flow
      executorOutputStore.save.resolves('executor-outputs/2024-01-01-user-auth.json')
      reflectionStore.save.resolves('reflections/2024-01-01-user-auth.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 2})
      deltaStore.save.resolves('deltas/2024-01-01-user-auth.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      // Verify Phase 1: Executor
      expect(executorOutputStore.save.calledOnce).to.be.true
      const executorOutput = executorOutputStore.save.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.hint).to.equal('user-auth')
      expect(executorOutput.reasoning).to.equal('Implemented OAuth2 flow')
      expect(executorOutput.finalAnswer).to.equal('Auth works')
      expect(executorOutput.bulletIds).to.deep.equal(['bullet-1', 'bullet-2'])
      expect(executorOutput.toolUsage).to.deep.equal(['Read:src/auth.ts', 'Edit:src/auth.ts', 'Bash:npm test'])

      // Verify Phase 2: Reflection
      expect(filePlaybookStoreLoadStub.calledOnce).to.be.true
      expect(reflectionStore.save.calledOnce).to.be.true
      const reflection = reflectionStore.save.firstCall.args[0] as ReflectorOutput
      expect(reflection.hint).to.equal('user-auth')
      expect(reflection.keyInsight).to.equal('Auth works')
      expect(playbookService.applyReflectionTags.calledOnce).to.be.true

      // Verify Phase 3: Curation
      expect(deltaStore.save.calledOnce).to.be.true
      const deltaBatch = deltaStore.save.firstCall.args[0] as DeltaBatch
      expect(deltaBatch.operations).to.have.lengthOf(1)
      expect(deltaBatch.operations[0].type).to.equal('ADD')
      expect(deltaBatch.operations[0].content).to.equal('Auth works')
      expect(deltaBatch.operations[0].section).to.equal('Lessons Learned')
      expect(deltaBatch.operations[0].metadata?.tags).to.include('auto-generated')
      expect(playbookService.applyDelta.calledOnce).to.be.true
    })

    it('should complete successfully with UPDATE operation when --update-bullet is provided', async () => {
      const argv = [
        'auth-update',
        'Improved error handling',
        'Better errors',
        '--tool-usage',
        'Edit:src/auth.ts',
        '--feedback',
        'Tests passed',
        '--update-bullet',
        'bullet-5',
      ]

      // Mock successful flow
      executorOutputStore.save.resolves('executor-outputs/2024-01-01-auth-update.json')
      reflectionStore.save.resolves('reflections/2024-01-01-auth-update.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/2024-01-01-auth-update.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      // Verify Phase 3: UPDATE operation
      expect(deltaStore.save.calledOnce).to.be.true
      const deltaBatch = deltaStore.save.firstCall.args[0] as DeltaBatch
      expect(deltaBatch.operations).to.have.lengthOf(1)
      expect(deltaBatch.operations[0].type).to.equal('UPDATE')
      expect(deltaBatch.operations[0].bulletId).to.equal('bullet-5')
      expect(deltaBatch.operations[0].content).to.equal('Better errors')
    })

    it('should handle empty bullet-ids (default empty string)', async () => {
      const argv = [
        'simple-task',
        'Simple reasoning',
        'Simple answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'Success',
      ]

      // Mock successful flow
      executorOutputStore.save.resolves('executor-outputs/2024-01-01-simple-task.json')
      reflectionStore.save.resolves('reflections/2024-01-01-simple-task.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/2024-01-01-simple-task.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      // Verify empty bulletIds array
      const executorOutput = executorOutputStore.save.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.bulletIds).to.deep.equal([])
    })
  })

  describe('Error handling - Phase 1 (Executor)', () => {
    it('should fail when executor output save fails', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:file.ts', '--feedback', 'Success']

      executorOutputStore.save.rejects(new Error('Failed to save executor output'))

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to save executor output')
      }

      // Verify subsequent phases were not executed
      expect(reflectionStore.save.called).to.be.false
      expect(deltaStore.save.called).to.be.false
    })
  })

  describe('Error handling - Phase 2 (Reflection)', () => {
    it('should fail when playbook service fails during tag application', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:file.ts', '--feedback', 'Success']

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.rejects(new Error('Failed to apply reflection tags'))

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to apply reflection tags')
      }

      // Verify Phase 1 completed, reflection saved, but delta not saved
      expect(executorOutputStore.save.calledOnce).to.be.true
      expect(reflectionStore.save.calledOnce).to.be.true
      expect(deltaStore.save.called).to.be.false
    })

    it('should fail when reflection save fails', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:file.ts', '--feedback', 'Success']

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.rejects(new Error('Failed to save reflection'))

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to save reflection')
      }

      // Verify Phase 3 was not executed
      expect(deltaStore.save.called).to.be.false
    })
  })

  describe('Error handling - Phase 3 (Curation)', () => {
    it('should fail when playbook load fails in phase 3', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:file.ts', '--feedback', 'Success']

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      // Phase 3 loads playbook for validation - make it fail
      filePlaybookStoreLoadStub.resetBehavior()
      filePlaybookStoreLoadStub.rejects(new Error('Playbook not found'))

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Playbook not found')
      }

      // Verify Phase 1 and 2 completed
      expect(executorOutputStore.save.calledOnce).to.be.true
      expect(reflectionStore.save.calledOnce).to.be.true
      // Verify Phase 3 did not complete
      expect(deltaStore.save.called).to.be.false
    })

    it('should fail when update-bullet references non-existent bullet', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'Success',
        '--update-bullet',
        'non-existent-bullet',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('not found in playbook')
      }

      // Verify delta was not saved
      expect(deltaStore.save.called).to.be.false
    })

    it('should fail when delta save fails', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:file.ts', '--feedback', 'Success']

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.rejects(new Error('Failed to save delta'))

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to save delta')
      }

      // Verify applyDelta was not called
      expect(playbookService.applyDelta.called).to.be.false
    })

    it('should fail when applyDelta fails', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:file.ts', '--feedback', 'Success']

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.rejects(new Error('Failed to apply delta'))

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to apply delta')
      }
    })
  })

  describe('Reflection generation with feedback analysis', () => {
    it('should identify errors when feedback contains "fail"', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'Build failed with errors',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const reflection = reflectionStore.save.firstCall.args[0] as ReflectorOutput
      expect(reflection.errorIdentification).to.include('Issues identified')
      expect(reflection.errorIdentification).to.include('Build failed with errors')
      expect(reflection.rootCauseAnalysis).to.include('Root cause requires investigation')
    })

    it('should identify errors when feedback contains "error"', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'Type error in authentication',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const reflection = reflectionStore.save.firstCall.args[0] as ReflectorOutput
      expect(reflection.errorIdentification).to.include('Issues identified')
      expect(reflection.rootCauseAnalysis).to.include('Root cause requires investigation')
    })

    it('should indicate success when feedback has no error keywords', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'All tests passed successfully',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const reflection = reflectionStore.save.firstCall.args[0] as ReflectorOutput
      expect(reflection.errorIdentification).to.include('No critical errors identified')
      expect(reflection.rootCauseAnalysis).to.include('Successful execution without errors')
    })
  })

  describe('File path extraction from tool usage', () => {
    it('should extract file paths from tool usage and prefix with project name', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:src/auth.ts,Edit:src/user.ts,Bash:npm test',
        '--feedback',
        'Success',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const deltaBatch = deltaStore.save.firstCall.args[0] as DeltaBatch
      const relatedFiles = deltaBatch.operations[0].metadata?.relatedFiles || []
      expect(relatedFiles).to.have.lengthOf(2)
      expect(relatedFiles[0]).to.match(/\/src\/auth\.ts$/)
      expect(relatedFiles[1]).to.match(/\/src\/user\.ts$/)
      // Bash:npm test should not create a file path
    })

    it('should handle tool usage with leading ./ in paths', async () => {
      const argv = ['task', 'reasoning', 'answer', '--tool-usage', 'Read:./src/file.ts', '--feedback', 'Success']

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const deltaBatch = deltaStore.save.firstCall.args[0] as DeltaBatch
      const relatedFiles = deltaBatch.operations[0].metadata?.relatedFiles || []
      expect(relatedFiles).to.have.lengthOf(1)
      // Should remove leading ./
      expect(relatedFiles[0]).to.match(/\/src\/file\.ts$/)
      expect(relatedFiles[0]).to.not.include('./')
    })
  })

  describe('Parsing comma-separated inputs', () => {
    it('should parse comma-separated bullet IDs correctly', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'Success',
        '--bullet-ids',
        'bullet-1, bullet-2 ,bullet-3',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const executorOutput = executorOutputStore.save.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.bulletIds).to.deep.equal(['bullet-1', 'bullet-2', 'bullet-3'])
    })

    it('should parse comma-separated tool usage correctly', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file1.ts, Edit:file2.ts ,Bash:npm test',
        '--feedback',
        'Success',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const executorOutput = executorOutputStore.save.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.toolUsage).to.deep.equal(['Read:file1.ts', 'Edit:file2.ts', 'Bash:npm test'])
    })

    it('should filter out empty strings from bullet IDs', async () => {
      const argv = [
        'task',
        'reasoning',
        'answer',
        '--tool-usage',
        'Read:file.ts',
        '--feedback',
        'Success',
        '--bullet-ids',
        'bullet-1,,bullet-2, ,bullet-3',
      ]

      executorOutputStore.save.resolves('executor-outputs/test.json')
      reflectionStore.save.resolves('reflections/test.json')
      playbookService.applyReflectionTags.resolves({playbook: testPlaybook, tagsApplied: 0})
      deltaStore.save.resolves('deltas/test.json')
      playbookService.applyDelta.resolves({operationsApplied: 1, playbook: testPlaybook})

      const command = new TestableAce(
        deltaStore,
        executorOutputStore,
        playbookService,
        promptBuilder,
        reflectionStore,
        config,
        argv,
      )

      await command.run()

      const executorOutput = executorOutputStore.save.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.bulletIds).to.deep.equal(['bullet-1', 'bullet-2', 'bullet-3'])
    })
  })
})
