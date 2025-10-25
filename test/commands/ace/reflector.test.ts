import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import Reflector from '../../../src/commands/ace/reflector.js'
import {ExecutorOutput} from '../../../src/core/domain/entities/executor-output.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {ReflectorOutput} from '../../../src/core/domain/entities/reflector-output.js'
import {ApplyReflectionTagsUseCase} from '../../../src/core/usecases/apply-reflection-tags-use-case.js'
import {GenerateReflectionUseCase} from '../../../src/core/usecases/generate-reflection-use-case.js'
import {LoadPlaybookUseCase} from '../../../src/core/usecases/load-playbook-use-case.js'
import {ParseReflectionUseCase} from '../../../src/core/usecases/parse-reflection-use-case.js'

describe('ace:reflector', () => {
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
    it('should complete full reflection workflow with stdin JSON', async () => {
      const command = new Reflector(['Tests passed successfully'], config)
      const logSpy = sandbox.spy(command, 'log')

      // Mock executor output
      const executorOutput = new ExecutorOutput({
        bulletIds: ['bullet-123'],
        finalAnswer: 'Successfully implemented authentication',
        hint: 'user-auth',
        reasoning: 'Used TypeScript strict mode',
        toolUsage: ['TypeScript', 'JWT'],
      })

      // Mock playbook
      const playbook = new Playbook()
      playbook.addBullet('Test Section', 'Test bullet', 'bullet-123', {
        codebasePath: '/test',
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      // Mock reflection
      const reflection = new ReflectorOutput({
        bulletTags: [{id: 'bullet-123', tag: 'helpful'}],
        correctApproach: 'Should validate inputs',
        errorIdentification: 'Missing validation',
        keyInsight: 'Always validate inputs',
        reasoning: 'Analysis complete',
        rootCauseAnalysis: 'Lack of validation framework',
      })

      // Stub protected methods on command
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor-output.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      // Stub use cases
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook content',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Reflection prompt for agent',
        success: true,
      })

      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/path/to/reflection.json',
        reflection,
        success: true,
      })

      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({
        playbook,
        success: true,
        tagsApplied: 1,
      })

      // Mock stdin with reflection JSON
      const reflectionJson = JSON.stringify(reflection.toJson())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readStdinStub = sandbox.stub(command as any, 'readStdin').resolves(reflectionJson)

      await command.run()

      // Verify workflow steps
      expect(logSpy.calledWith('📋 Loading latest executor output...')).to.be.true
      expect(logSpy.calledWith('📚 Loading playbook...')).to.be.true
      expect(logSpy.calledWith('🤔 Generating reflection prompt...')).to.be.true
      expect(logSpy.calledWith('💾 Parsing reflection JSON...')).to.be.true
      expect(logSpy.calledWith('🏷️  Applying tags to playbook...')).to.be.true
      expect(logSpy.calledWith('✅ Reflection completed successfully!')).to.be.true

      // Verify prompt was displayed
      const promptCall = logSpy.getCalls().find((call) => {
        const arg = call.args[0]
        return typeof arg === 'string' && arg.includes('Reflection prompt for agent')
      })
      expect(promptCall).to.exist

      // Verify summary displayed
      expect(logSpy.calledWith(sinon.match(/Tags applied: 1/))).to.be.true
      expect(logSpy.calledWith(sinon.match(/Key insight: Always validate inputs/))).to.be.true
      expect(logSpy.calledWith(sinon.match(/Next step: Run `br ace curator`/))).to.be.true

      // Verify stdin was read
      expect(readStdinStub.calledOnce).to.be.true
    })

    it('should display prompt and exit gracefully when no stdin provided', async () => {
      const command = new Reflector(['Build successful'], config)
      const logSpy = sandbox.spy(command, 'log')

      // Mock executor output and playbook
      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor-output.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Reflection prompt',
        success: true,
      })

      // Mock empty stdin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves('')

      await command.run()

      // Verify prompt was displayed
      expect(logSpy.calledWith('🤔 Generating reflection prompt...')).to.be.true
      expect(logSpy.calledWith(sinon.match(/No reflection JSON provided/))).to.be.true

      // Verify parsing was NOT attempted
      expect(logSpy.calledWith('💾 Parsing reflection JSON...')).to.be.false
    })
  })

  describe('error handling', () => {
    it('should error when no executor outputs exist', async () => {
      const command = new Reflector(['Feedback'], config)

      // Stub to throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).rejects(new Error('No files found in directory'))

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('No files found')
      }
    })

    it('should error when playbook not found', async () => {
      const command = new Reflector(['Feedback'], config)

      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

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

    it('should error when reflection prompt generation fails', async () => {
      const command = new Reflector(['Feedback'], config)

      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        error: 'Failed to generate prompt',
        success: false,
      })

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to generate')
      }
    })

    it('should error when reflection JSON parsing fails', async () => {
      const command = new Reflector(['Feedback'], config)

      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        error: 'Invalid JSON structure',
        success: false,
      })

      // Mock stdin with valid JSON
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves('{"reasoning": "test"}')

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid JSON')
      }
    })

    it('should error when applying tags to playbook fails', async () => {
      const command = new Reflector(['Feedback'], config)

      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })
      const playbook = new Playbook()
      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      sandbox.stub(ParseReflectionUseCase.prototype, 'execute').resolves({
        filePath: '/path/to/reflection.json',
        reflection,
        success: true,
      })

      sandbox.stub(ApplyReflectionTagsUseCase.prototype, 'execute').resolves({
        error: 'Failed to apply tags',
        success: false,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves(JSON.stringify(reflection.toJson()))

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to apply tags')
      }
    })

    it('should error when stdin contains invalid JSON', async () => {
      const command = new Reflector(['Feedback'], config)

      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      // Mock stdin with invalid JSON
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves('invalid json {')

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        // JSON.parse will throw SyntaxError
        expect((error as Error).message).to.include('JSON')
      }
    })
  })

  describe('argument validation', () => {
    it('should require feedback argument', async () => {
      const command = new Reflector([], config)

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        // oclif will throw missing required argument error
      }
    })

    it('should accept feedback as positional argument', async () => {
      const command = new Reflector(['Test feedback message'], config)
      const logSpy = sandbox.spy(command, 'log')

      // Mock all dependencies to succeed
      const executorOutput = new ExecutorOutput({
        bulletIds: [],
        finalAnswer: 'Answer',
        hint: '',
        reasoning: 'Reasoning',
        toolUsage: [],
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestExecutorFile' as any).resolves('/path/to/executor.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadExecutorOutputFile' as any).resolves(executorOutput)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateReflectionUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves('')

      await command.run()

      // Verify command executed (didn't throw argument error)
      expect(logSpy.calledWith('📋 Loading latest executor output...')).to.be.true
    })
  })
})
