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

  it('should save executor output with reasoning and final answer', async () => {
    const command = new ExecutorSave(
      ['Used clean architecture principles', 'Successfully implemented authentication feature'],
      config,
    )
    const logSpy = sandbox.spy(command, 'log')

    // Stub SaveExecutorOutputUseCase
    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-2025-01-01T00-00-00.json',
      success: true,
    })

    await command.run()

    // Verify use case was called with correct data
    expect(saveStub.calledOnce).to.be.true
    const executorOutput = saveStub.firstCall.args[0]
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
        'Analyzed the codebase',
        'Fixed validation bug',
        '--bullet-ids',
        'bullet-123,bullet-456,bullet-789',
      ],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-123', 'bullet-456', 'bullet-789'])
  })

  it('should save with tool usage when provided', async () => {
    const command = new ExecutorSave(
      [
        'Followed best practices',
        'Implemented search functionality',
        '--tool-usage',
        'TypeScript,Jest,ESLint',
      ],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.toolUsage).to.deep.equal(['TypeScript', 'Jest', 'ESLint'])
  })

  it('should save with both bullet IDs and tool usage', async () => {
    const command = new ExecutorSave(
      [
        'Applied clean code principles',
        'Refactored user service',
        '--bullet-ids',
        'bullet-001,bullet-002',
        '--tool-usage',
        'TypeScript,Mocha,Sinon',
      ],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-001', 'bullet-002'])
    expect(executorOutput.toolUsage).to.deep.equal(['TypeScript', 'Mocha', 'Sinon'])
  })

  it('should use short flags -b and -t', async () => {
    const command = new ExecutorSave(
      ['Reasoning text', 'Final answer text', '-b', 'bullet-111', '-t', 'Git,npm'],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-111'])
    expect(executorOutput.toolUsage).to.deep.equal(['Git', 'npm'])
  })

  it('should handle empty bullet IDs list', async () => {
    const command = new ExecutorSave(['Reasoning', 'Answer', '--bullet-ids', ''], config)

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.bulletIds).to.deep.equal([])
  })

  it('should handle empty tool usage list', async () => {
    const command = new ExecutorSave(['Reasoning', 'Answer', '--tool-usage', ''], config)

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.toolUsage).to.deep.equal([])
  })

  it('should trim whitespace from bullet IDs', async () => {
    const command = new ExecutorSave(
      ['Reasoning', 'Answer', '--bullet-ids', ' bullet-1 , bullet-2 , bullet-3 '],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.bulletIds).to.deep.equal(['bullet-1', 'bullet-2', 'bullet-3'])
  })

  it('should trim whitespace from tool usage', async () => {
    const command = new ExecutorSave(
      ['Reasoning', 'Answer', '--tool-usage', ' TypeScript , Jest , ESLint '],
      config,
    )

    const saveStub = sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    const executorOutput = saveStub.firstCall.args[0]
    expect(executorOutput.toolUsage).to.deep.equal(['TypeScript', 'Jest', 'ESLint'])
  })

  it('should error when save use case fails', async () => {
    const command = new ExecutorSave(['Reasoning', 'Answer'], config)

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
    const command = new ExecutorSave(['', 'Valid answer'], config)

    try {
      await command.run()
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('reasoning cannot be empty')
    }
  })

  it('should error when final answer is empty', async () => {
    const command = new ExecutorSave(['Valid reasoning', ''], config)

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
    const command = new ExecutorSave([longReasoning, 'Answer'], config)
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
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
    const command = new ExecutorSave(['Reasoning', longAnswer], config)
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
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
      ['Reasoning', 'Answer', '--bullet-ids', 'bullet-123,bullet-456'],
      config,
    )
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    expect(logSpy.calledWith(sinon.match(/Referenced Bullets: bullet-123, bullet-456/))).to.be.true
  })

  it('should display tools used in summary', async () => {
    const command = new ExecutorSave(['Reasoning', 'Answer', '--tool-usage', 'Git,npm,TypeScript'], config)
    const logSpy = sandbox.spy(command, 'log')

    sandbox.stub(SaveExecutorOutputUseCase.prototype, 'execute').resolves({
      filePath: '.br/ace/executor-outputs/executor-test.json',
      success: true,
    })

    await command.run()

    expect(logSpy.calledWith(sinon.match(/Tools Used: Git, npm, TypeScript/))).to.be.true
  })
})
