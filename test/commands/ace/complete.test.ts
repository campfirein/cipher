import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import Complete from '../../../src/commands/ace/complete.js'
import {CuratorOutput} from '../../../src/core/domain/entities/curator-output.js'
import {DeltaBatch} from '../../../src/core/domain/entities/delta-batch.js'
import {ExecutorOutput} from '../../../src/core/domain/entities/executor-output.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {ReflectorOutput} from '../../../src/core/domain/entities/reflector-output.js'
import {ApplyDeltaUseCase} from '../../../src/core/usecases/apply-delta-use-case.js'
import {ApplyReflectionTagsUseCase} from '../../../src/core/usecases/apply-reflection-tags-use-case.js'
import {GenerateCurationUseCase} from '../../../src/core/usecases/generate-curation-use-case.js'
import {GenerateReflectionUseCase} from '../../../src/core/usecases/generate-reflection-use-case.js'
import {LoadPlaybookUseCase} from '../../../src/core/usecases/load-playbook-use-case.js'
import {ParseCuratorOutputUseCase} from '../../../src/core/usecases/parse-curator-output-use-case.js'
import {ParseReflectionUseCase} from '../../../src/core/usecases/parse-reflection-use-case.js'
import {SaveExecutorOutputUseCase} from '../../../src/core/usecases/save-executor-output-use-case.js'


describe('ace:complete', () => {
  let config: Config
  let sandbox: sinon.SinonSandbox

  before(async () => {
    config = await Config.load(import.meta.url)
  })

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('successful workflow', () => {
    it('should complete full ACE workflow', async () => {
      const command = new Complete(
        ['test-hint', 'test reasoning', 'test answer', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      // Mock all use cases
      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor-output.json',
        success: true,
      })

      const playbook = new Playbook()
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Reflection prompt',
        success: true,
      })

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct approach',
        errorIdentification: 'No errors',
        hint: 'test-hint',
        keyInsight: 'Key insight',
        reasoning: 'Reflection reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })

      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({
        success: true,
        tagsApplied: 0,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Curation prompt',
        success: true,
      })

      const deltaBatch = new DeltaBatch('Curator reasoning', [])
      const curatorOutput = new CuratorOutput(deltaBatch)
      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput,
        filePath: '/test/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      const logSpy = sandbox.spy(command, 'log')

      await command.run()

      // Verify log contains summary
      expect(logSpy.calledWith(sinon.match(/Hint: test-hint/))).to.be.true
      expect(logSpy.calledWith(sinon.match(/ACE WORKFLOW COMPLETED SUCCESSFULLY/))).to.be.true
    })

    it('should parse comma-separated tool-usage flag', async () => {
      const command = new Complete(
        [
          'test-hint',
          'test reasoning',
          'test answer',
          '--tool-usage',
          'Read:test.ts,Edit:test.ts,Bash:npm test',
          '--feedback',
          'Tests passed',
        ],
        config,
      )

      const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor-output.json',
        success: true,
      })

      const playbook = new Playbook()
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({playbook, success: true})
      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({prompt: 'Prompt', success: true})
      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct',
        errorIdentification: 'None',
        hint: 'test-hint',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root',
      })
      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })
      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({success: true, tagsApplied: 0})
      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({prompt: 'Curation', success: true})
      const deltaBatch1 = new DeltaBatch('Reasoning', [])
      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(deltaBatch1),
        filePath: '/test/delta.json',
        success: true,
      })
      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({success: true})

      await command.run()

      // Verify executor output contains parsed tool usage
      const executorOutput = saveStub.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.toolUsage).to.deep.equal(['Read:test.ts', 'Edit:test.ts', 'Bash:npm test'])
    })

    it('should parse comma-separated bullet-ids flag', async () => {
      const command = new Complete(
        [
          'test-hint',
          'test reasoning',
          'test answer',
          '--tool-usage',
          'Read:test.ts',
          '--feedback',
          'Tests passed',
          '--bullet-ids',
          'bullet-123,bullet-456',
        ],
        config,
      )

      const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor-output.json',
        success: true,
      })

      const playbook = new Playbook()
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({playbook, success: true})
      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({prompt: 'Prompt', success: true})
      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct',
        errorIdentification: 'None',
        hint: 'test-hint',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root',
      })
      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })
      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({success: true, tagsApplied: 0})
      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({prompt: 'Curation', success: true})
      const deltaBatch1 = new DeltaBatch('Reasoning', [])
      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(deltaBatch1),
        filePath: '/test/delta.json',
        success: true,
      })
      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({success: true})

      await command.run()

      // Verify executor output contains parsed bullet IDs
      const executorOutput = saveStub.firstCall.args[0] as ExecutorOutput
      expect(executorOutput.bulletIds).to.deep.equal(['bullet-123', 'bullet-456'])
    })
  })

  describe('validation', () => {
    it('should fail if reasoning is empty', async () => {
      const command = new Complete(
        ['test-hint', '', 'test answer', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown validation error')
      } catch (error) {
        expect((error as Error).message).to.include('Executor reasoning cannot be empty')
      }
    })

    it('should fail if finalAnswer is empty', async () => {
      const command = new Complete(
        ['test-hint', 'test reasoning', '', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown validation error')
      } catch (error) {
        expect((error as Error).message).to.include('Executor final answer cannot be empty')
      }
    })
  })

  describe('UPDATE mode', () => {
    it('should update existing bullet when --update-bullet flag is provided', async () => {
      // Create playbook with existing bullet first to get the ID
      const playbook = new Playbook()
      playbook.addBullet('Lessons Learned', 'Original content', undefined, {
        relatedFiles: [],
        tags: ['old-tag'],
        timestamp: new Date().toISOString(),
      })
      const bulletId = playbook.getBulletsInSection('Lessons Learned')[0].id

      const command = new Complete(
        [
          'test-hint',
          'test reasoning',
          'test answer',
          '--tool-usage',
          'Read:test.ts',
          '--feedback',
          'Tests passed',
          '--update-bullet',
          bulletId,
        ],
        config,
      )

      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor-output.json',
        success: true,
      })

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({playbook, success: true})
      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({prompt: 'Prompt', success: true})

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct',
        errorIdentification: 'None',
        hint: 'test-hint',
        keyInsight: 'Updated insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root',
      })
      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })

      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({success: true, tagsApplied: 0})
      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({prompt: 'Curation', success: true})

      const parseCuratorStub = sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute')
      const deltaBatch2 = new DeltaBatch('Reasoning', [])
      parseCuratorStub.resolves({
        curatorOutput: new CuratorOutput(deltaBatch2),
        filePath: '/test/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({success: true})

      const logSpy = sandbox.spy(command, 'log')

      await command.run()

      // Verify UPDATE operation was created
      const curatorJson = parseCuratorStub.firstCall.args[0]
      expect(curatorJson.operations[0].type).to.equal('UPDATE')
      expect(curatorJson.operations[0].bulletId).to.equal(bulletId)

      // Verify log message
      expect(logSpy.calledWith(sinon.match(/Updating existing bullet/))).to.be.true
    })

    it('should fail if --update-bullet references non-existent bullet', async () => {
      const command = new Complete(
        [
          'test-hint',
          'test reasoning',
          'test answer',
          '--tool-usage',
          'Read:test.ts',
          '--feedback',
          'Tests passed',
          '--update-bullet',
          'non-existent-bullet',
        ],
        config,
      )

      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor-output.json',
        success: true,
      })

      const playbook = new Playbook()
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({playbook, success: true})
      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({prompt: 'Prompt', success: true})

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct',
        errorIdentification: 'None',
        hint: 'test-hint',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root',
      })
      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })

      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({success: true, tagsApplied: 0})
      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({prompt: 'Curation', success: true})

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('not found in playbook')
        expect((error as Error).message).to.include('non-existent-bullet')
      }
    })

    it('should use ADD mode by default when --update-bullet is not provided', async () => {
      const command = new Complete(
        ['test-hint', 'test reasoning', 'test answer', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor-output.json',
        success: true,
      })

      const playbook = new Playbook()
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({playbook, success: true})
      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({prompt: 'Prompt', success: true})

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct',
        errorIdentification: 'None',
        hint: 'test-hint',
        keyInsight: 'New insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root',
      })
      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })

      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({success: true, tagsApplied: 0})
      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({prompt: 'Curation', success: true})

      const parseCuratorStub = sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute')
      const deltaBatch3 = new DeltaBatch('Reasoning', [])
      parseCuratorStub.resolves({
        curatorOutput: new CuratorOutput(deltaBatch3),
        filePath: '/test/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({success: true})

      const logSpy = sandbox.spy(command, 'log')

      await command.run()

      // Verify ADD operation was created
      const curatorJson = parseCuratorStub.firstCall.args[0]
      expect(curatorJson.operations[0].type).to.equal('ADD')
      expect(curatorJson.operations[0].bulletId).to.be.undefined

      // Verify log message
      expect(logSpy.calledWith(sinon.match(/Adding new bullet/))).to.be.true
    })
  })

  describe('error handling', () => {
    it('should fail if executor save fails', async () => {
      const command = new Complete(
        ['test-hint', 'test reasoning', 'test answer', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        error: 'Failed to save executor output',
        success: false,
      })

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Failed to save executor output')
      }
    })

    it('should fail if playbook cannot be loaded', async () => {
      const command = new Complete(
        ['test-hint', 'test reasoning', 'test answer', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor.json',
        success: true,
      })

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        error: 'Playbook not found',
        success: false,
      })

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Playbook not found')
      }
    })


    it('should fail if delta application fails', async () => {
      const command = new Complete(
        ['test-hint', 'test reasoning', 'test answer', '--tool-usage', 'Read:test.ts', '--feedback', 'Tests passed'],
        config,
      )

      sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
        filePath: '/test/executor.json',
        success: true,
      })

      const playbook = new Playbook()
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({playbook, success: true})
      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({prompt: 'Prompt', success: true})
      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Correct',
        errorIdentification: 'None',
        hint: 'test-hint',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root',
      })
      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/test/reflection.json',
        reflection,
        success: true,
      })
      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({success: true, tagsApplied: 0})
      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({prompt: 'Curation', success: true})
      const deltaBatch4 = new DeltaBatch('Reasoning', [])
      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(deltaBatch4),
        filePath: '/test/delta.json',
        success: true,
      })
      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        error: 'Failed to apply delta',
        success: false,
      })

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Failed to apply delta')
      }
    })
  })
})
