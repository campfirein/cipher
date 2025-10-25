import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import ExecutorSave from '../../../../src/commands/ace/executor/save.js'
import {SaveExecutorOutputUseCase} from '../../../../src/core/usecases/save-executor-output-use-case.js'

describe('ace:executor:save', () => {
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

  it('should save executor output with hint, reasoning and final answer', async () => {
    const command = new ExecutorSave(
      ['user-auth', 'Used clean architecture principles', 'Successfully implemented authentication feature'],
      config,
    )
    const logSpy = sandbox.spy(command, 'log')

    // Stub SaveExecutorOutputUseCase
    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-user-auth-2025-01-01T00-00-00.json',
      success: true,
    })

    await command.run()

    // Verify use case was called with correct data
    expect(saveStub.calledOnce).to.be.true
    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('user-auth')
    expect(executorOutput.reasoning).to.equal('Used clean architecture principles')
    expect(executorOutput.finalAnswer).to.equal('Successfully implemented authentication feature')
    expect(executorOutput.bulletIds).to.deep.equal([])
    expect(executorOutput.toolUsage).to.deep.equal([])

    // Verify success message
    expect(logSpy.calledWith('✓ Executor output saved successfully')).to.be.true
    expect(logSpy.calledWith(sinon.match(/Saved to:/))).to.be.true
  })

  it('should save with bullet IDs when provided', async () => {
    const command = new ExecutorSave(
      [
        'validation-fix',
        'Analyzed the codebase',
        'Fixed validation bug',
        '--bullet-ids',
        'bullet-123,bullet-456,bullet-789',
      ],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-validation-fix-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('validation-fix')
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-123', 'bullet-456', 'bullet-789'])
  })

  it('should save with tool usage when provided', async () => {
    const command = new ExecutorSave(
      [
        'search-feature',
        'Followed best practices',
        'Implemented search functionality',
        '--tool-usage',
        'Read:src/search.ts,Grep:pattern:"search",Edit:src/search.ts',
      ],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-search-feature-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('search-feature')
    expect(executorOutput.toolUsage).to.deep.equal(['Read:src/search.ts', 'Grep:pattern:"search"', 'Edit:src/search.ts'])
  })

  it('should save with both bullet IDs and tool usage', async () => {
    const command = new ExecutorSave(
      [
        'refactor-user-service',
        'Applied clean code principles',
        'Refactored user service',
        '--bullet-ids',
        'bullet-001,bullet-002',
        '--tool-usage',
        'Read:src/user-service.ts,Edit:src/user-service.ts,Bash:npm test',
      ],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-refactor-user-service-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('refactor-user-service')
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-001', 'bullet-002'])
    expect(executorOutput.toolUsage).to.deep.equal(['Read:src/user-service.ts', 'Edit:src/user-service.ts', 'Bash:npm test'])
  })

  it('should use short flags -b and -t', async () => {
    const command = new ExecutorSave(
      ['test-hint', 'Reasoning text', 'Final answer text', '-b', 'bullet-111', '-t', 'Read:src/file.ts,Bash:npm test'],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test-hint-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('test-hint')
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-111'])
    expect(executorOutput.toolUsage).to.deep.equal(['Read:src/file.ts', 'Bash:npm test'])
  })

  it('should handle empty bullet IDs list', async () => {
    const command = new ExecutorSave(['hint', 'Reasoning', 'Answer', '--bullet-ids', ''], config)

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('hint')
    expect(executorOutput.bulletIds).to.deep.equal([])
  })

  it('should handle empty tool usage list', async () => {
    const command = new ExecutorSave(['hint', 'Reasoning', 'Answer', '--tool-usage', ''], config)

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('hint')
    expect(executorOutput.toolUsage).to.deep.equal([])
  })

  it('should trim whitespace from bullet IDs', async () => {
    const command = new ExecutorSave(
      ['hint', 'Reasoning', 'Answer', '--bullet-ids', ' bullet-1 , bullet-2 , bullet-3 '],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('hint')
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-1', 'bullet-2', 'bullet-3'])
  })

  it('should trim whitespace from tool usage', async () => {
    const command = new ExecutorSave(
      ['hint', 'Reasoning', 'Answer', '--tool-usage', ' Read:src/file.ts , Grep:pattern:"test" , Edit:src/file.ts '],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.hint).to.equal('hint')
    expect(executorOutput.toolUsage).to.deep.equal(['Read:src/file.ts', 'Grep:pattern:"test"', 'Edit:src/file.ts'])
  })

  it('should error when save use case fails', async () => {
    const command = new ExecutorSave(['hint', 'Reasoning', 'Answer'], config)

    // Stub SaveExecutorOutputUseCase to fail
    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      error: 'Disk full',
      success: false,
    })

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Disk full')
    }
  })

  it('should error when reasoning is empty', async () => {
    const command = new ExecutorSave(['hint', '', 'Valid answer'], config)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('reasoning cannot be empty')
    }
  })

  it('should error when final answer is empty', async () => {
    const command = new ExecutorSave(['hint', 'Valid reasoning', ''], config)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('final answer cannot be empty')
    }
  })

  it('should display summary with truncated reasoning when too long', async () => {
    const longReasoning = 'A'.repeat(100)
    const command = new ExecutorSave(['hint', longReasoning, 'Answer'], config)
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    // Should truncate reasoning to 80 chars + "..."
    const summaryCall = logSpy
      .getCalls()
      .find((call) => call.args[0] && call.args[0].toString().includes('Reasoning:'))
    expect(summaryCall).to.exist
    expect(summaryCall?.args[0]).to.include('...')
  })

  it('should display summary with truncated final answer when too long', async () => {
    const longAnswer = 'B'.repeat(100)
    const command = new ExecutorSave(['hint', 'Reasoning', longAnswer], config)
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    // Should truncate final answer to 80 chars + "..."
    const summaryCall = logSpy
      .getCalls()
      .find((call) => call.args[0] && call.args[0].toString().includes('Final Answer:'))
    expect(summaryCall).to.exist
    expect(summaryCall?.args[0]).to.include('...')
  })

  it('should display referenced bullets in summary', async () => {
    const command = new ExecutorSave(
      ['hint', 'Reasoning', 'Answer', '--bullet-ids', 'bullet-123,bullet-456'],
      config,
    )
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    expect(logSpy.calledWith(sinon.match(/Referenced Bullets: bullet-123, bullet-456/))).to.be.true
  })

  it('should display tools used in summary', async () => {
    const command = new ExecutorSave(['hint', 'Reasoning', 'Answer', '--tool-usage', 'Read:src/main.ts,Grep:pattern:"import",WebSearch:query:"best practices"'], config)
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-hint-test.json',
      success: true,
    })

    await command.run()

    expect(logSpy.calledWith(sinon.match(/Tools Used: Read:src\/main\.ts, Grep:pattern:"import", WebSearch:query:"best practices"/))).to.be.true
  })
})
