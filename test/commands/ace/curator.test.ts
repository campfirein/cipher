import {Config} from '@oclif/core'
import {expect} from 'chai'
import {createSandbox, match, type SinonSandbox} from 'sinon'

import Curator from '../../../src/commands/ace/curator.js'
import {CuratorOutput} from '../../../src/core/domain/entities/curator-output.js'
import {DeltaBatch} from '../../../src/core/domain/entities/delta-batch.js'
import {DeltaOperation} from '../../../src/core/domain/entities/delta-operation.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {ReflectorOutput} from '../../../src/core/domain/entities/reflector-output.js'
import {ApplyDeltaUseCase} from '../../../src/core/usecases/apply-delta-use-case.js'
import {GenerateCurationUseCase} from '../../../src/core/usecases/generate-curation-use-case.js'
import {LoadPlaybookUseCase} from '../../../src/core/usecases/load-playbook-use-case.js'
import {ParseCuratorOutputUseCase} from '../../../src/core/usecases/parse-curator-output-use-case.js'

describe('ace:curator', () => {
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
    it('should complete full curation workflow with stdin JSON', async () => {
      const command = new Curator([], config)
      const logSpy = sandbox.spy(command, 'log')

      // Mock reflection
      const reflection = new ReflectorOutput({
        bulletTags: [{id: 'bullet-123', tag: 'helpful'}],
        correctApproach: 'Should validate inputs',
        errorIdentification: 'Missing validation',
        hint: 'test-hint',
        keyInsight: 'Always validate inputs',
        reasoning: 'Analysis complete',
        rootCauseAnalysis: 'Lack of validation framework',
      })

      // Mock playbook
      const playbook = new Playbook()

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      // Stub use cases
      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook content',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Curation prompt for agent',
        success: true,
      })

      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(deltaBatch),
        filePath: '/path/to/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      // Mock stdin with curator JSON
      const curatorJson = JSON.stringify(deltaBatch.toJson())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves(curatorJson)

      await command.run()

      // Verify workflow steps
      expect(logSpy.calledWith('📋 Loading reflection...')).to.be.true
      expect(logSpy.calledWith('📚 Loading playbook...')).to.be.true
      expect(logSpy.calledWith('🎨 Generating curation prompt...')).to.be.true
      expect(logSpy.calledWith('💾 Parsing curator output...')).to.be.true
      expect(logSpy.calledWith('⚙️  Applying delta operations to playbook...')).to.be.true
      expect(logSpy.calledWith('✅ Curation completed successfully!')).to.be.true

      // Verify prompt was displayed
      const promptCall = logSpy.getCalls().find((call) => {
        const arg = call.args[0]
        return typeof arg === 'string' && arg.includes('Curation prompt for agent')
      })
      expect(promptCall).to.exist

      // Verify summary displayed
      expect(logSpy.calledWith(match(/Total operations: 1/))).to.be.true
      expect(logSpy.calledWith(match(/ADD: 1/))).to.be.true
      expect(logSpy.calledWith(match(/Playbook has been updated/))).to.be.true
    })

    it('should display prompt and exit gracefully when no stdin provided', async () => {
      const command = new Curator([], config)
      const logSpy = sandbox.spy(command, 'log')

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Curation prompt',
        success: true,
      })

      // Mock empty stdin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves('')

      await command.run()

      // Verify prompt was displayed
      expect(logSpy.calledWith('🎨 Generating curation prompt...')).to.be.true
      expect(logSpy.calledWith(match(/No curator JSON provided/))).to.be.true

      // Verify parsing was NOT attempted
      expect(logSpy.calledWith('💾 Parsing curator output...')).to.be.false
    })

    it('should handle empty delta batch', async () => {
      const command = new Curator([], config)
      const logSpy = sandbox.spy(command, 'log')

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()
      const emptyDelta = new DeltaBatch('No changes needed', [])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(emptyDelta),
        filePath: '/path/to/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves(JSON.stringify(emptyDelta.toJson()))

      await command.run()

      // Verify empty delta message
      expect(logSpy.calledWith('✅ Curation completed successfully!')).to.be.true
      expect(logSpy.calledWith(match(/Total operations: 0/))).to.be.true
      expect(logSpy.calledWith(match(/No operations/))).to.be.true
    })
  })

  describe('error handling', () => {
    it('should error when no reflections exist', async () => {
      const command = new Curator([], config)

      // Stub to throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).rejects(new Error('No files found in directory'))

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('No files found')
      }
    })

    it('should error when playbook not found', async () => {
      const command = new Curator([], config)

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

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

    it('should error when curation prompt generation fails', async () => {
      const command = new Curator([], config)

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
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

    it('should error when curator JSON parsing fails', async () => {
      const command = new Curator([], config)

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        error: 'Invalid JSON structure',
        success: false,
      })

      // Mock stdin with valid JSON
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves('{"reasoning": "test", "operations": []}')

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid JSON')
      }
    })

    it('should error when applying delta operations fails', async () => {
      const command = new Curator([], config)

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()
      const deltaBatch = new DeltaBatch('Test', [])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(deltaBatch),
        filePath: '/path/to/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        error: 'Failed to apply operations',
        success: false,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves(JSON.stringify(deltaBatch.toJson()))

      try {
        await command.run()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to apply')
      }
    })

    it('should error when stdin contains invalid JSON', async () => {
      const command = new Curator([], config)

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
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

  describe('operation breakdown', () => {
    it('should display breakdown of multiple operation types', async () => {
      const command = new Curator([], config)
      const logSpy = sandbox.spy(command, 'log')

      const reflection = new ReflectorOutput({
        bulletTags: [],
        correctApproach: 'Approach',
        errorIdentification: 'Error',
        hint: '',
        keyInsight: 'Insight',
        reasoning: 'Reasoning',
        rootCauseAnalysis: 'Root cause',
      })
      const playbook = new Playbook()

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'findLatestReflectionFile' as any).resolves('/path/to/reflection.json')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command, 'loadReflectionOutputFile' as any).resolves(reflection)

      sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
        playbook,
        playbookPrompt: 'Playbook',
        success: true,
      })

      sandbox.stub(GenerateCurationUseCase.prototype, 'execute').resolves({
        prompt: 'Prompt',
        success: true,
      })

      sandbox.stub(ParseCuratorOutputUseCase.prototype, 'execute').resolves({
        curatorOutput: new CuratorOutput(deltaBatch),
        filePath: '/path/to/delta.json',
        success: true,
      })

      sandbox.stub(ApplyDeltaUseCase.prototype, 'execute').resolves({
        success: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sandbox.stub(command as any, 'readStdin').resolves(JSON.stringify(deltaBatch.toJson()))

      await command.run()

      // Verify operation breakdown
      expect(logSpy.calledWith(match(/Total operations: 4/))).to.be.true
      expect(logSpy.calledWith(match(/ADD: 2/))).to.be.true
      expect(logSpy.calledWith(match(/UPDATE: 1/))).to.be.true
      expect(logSpy.calledWith(match(/REMOVE: 1/))).to.be.true
    })
  })
})
