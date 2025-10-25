import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import ExecutorStart from '../../../../src/commands/ace/executor/start.js'
import {LoadPlaybookUseCase} from '../../../../src/core/usecases/load-playbook-use-case.js'

describe('ace:executor:start', () => {
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

  it('should display prompt without playbook knowledge by default', async () => {
    const command = new ExecutorStart(['Add authentication'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify summary displayed
    expect(logSpy.calledWith('✓ Executor task started')).to.be.true
    expect(logSpy.calledWith(sinon.match(/Task: Add authentication/))).to.be.true
    expect(logSpy.calledWith(sinon.match(/Playbook: not included/))).to.be.true

    // Verify prompt was displayed (find the log call with the full prompt)
    const promptCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('Executor Task')
    })

    expect(promptCall).to.exist
    const displayedPrompt = promptCall?.args[0] as string
    expect(displayedPrompt).to.include('Executor Task')
    expect(displayedPrompt).to.include('Add authentication')
    expect(displayedPrompt).to.not.include('## Playbook Knowledge')
    expect(displayedPrompt).to.include('Output Requirements')
    expect(displayedPrompt).to.include('"reasoning"')
    expect(displayedPrompt).to.include('"finalAnswer"')
    expect(displayedPrompt).to.include('"bulletIds"')
    expect(displayedPrompt).to.include('"toolUsage"')

    // Verify it includes save command instructions
    expect(displayedPrompt).to.include('br ace executor save')
    expect(displayedPrompt).to.include('After Completing the Task')
  })

  it('should include playbook knowledge when --with-playbook flag is used', async () => {
    const command = new ExecutorStart(['Fix bug', '--with-playbook'], config)
    const logSpy = sandbox.spy(command, 'log')

    // Stub LoadPlaybookUseCase
    const loadStub = sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbookPrompt: '# Test Playbook\n- Bullet 1\n- Bullet 2',
      success: true,
    })

    await command.run()

    // Verify playbook was loaded
    expect(loadStub.calledOnce).to.be.true

    // Verify summary shows playbook included
    expect(logSpy.calledWith(sinon.match(/Playbook: included/))).to.be.true

    // Verify prompt includes playbook knowledge
    const promptCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('Executor Task')
    })

    expect(promptCall).to.exist
    const displayedPrompt = promptCall?.args[0] as string
    expect(displayedPrompt).to.include('## Playbook Knowledge')
    expect(displayedPrompt).to.include('Test Playbook')
  })

  it('should use short flag -p for with-playbook', async () => {
    const command = new ExecutorStart(['Refactor code', '-p'], config)
    const logSpy = sandbox.spy(command, 'log')

    // Stub LoadPlaybookUseCase
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbookPrompt: '# Playbook content',
      success: true,
    })

    await command.run()

    // Verify prompt includes playbook knowledge
    const promptCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('Executor Task')
    })

    expect(promptCall).to.exist
    const displayedPrompt = promptCall?.args[0] as string
    expect(displayedPrompt).to.include('## Playbook Knowledge')
  })

  it('should include ExecutorOutput JSON template in prompt', async () => {
    const command = new ExecutorStart(['Implement feature'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify prompt includes JSON template
    const promptCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('Executor Task')
    })

    expect(promptCall).to.exist
    const displayedPrompt = promptCall?.args[0] as string
    expect(displayedPrompt).to.include('Output Requirements')
    expect(displayedPrompt).to.include('"reasoning"')
    expect(displayedPrompt).to.include('"finalAnswer"')
    expect(displayedPrompt).to.include('"bulletIds"')
    expect(displayedPrompt).to.include('"toolUsage"')
  })

  it('should error when playbook not found and --with-playbook is used', async () => {
    const command = new ExecutorStart(['Test task', '--with-playbook'], config)

    // Stub LoadPlaybookUseCase to fail
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

  it('should not load playbook when --with-playbook is not used', async () => {
    const command = new ExecutorStart(['Simple task'], config)

    // Spy on LoadPlaybookUseCase
    const loadSpy = sandbox.spy(LoadPlaybookUseCase.prototype, 'execute')

    await command.run()

    // Verify playbook was NOT loaded
    expect(loadSpy.called).to.be.false
  })

  it('should display different instructions without playbook', async () => {
    const command = new ExecutorStart(['Simple task'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify prompt has correct instructions
    const promptCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('Executor Task')
    })

    expect(promptCall).to.exist
    const displayedPrompt = promptCall?.args[0] as string
    expect(displayedPrompt).to.include('Complete the task description')
    expect(displayedPrompt).to.not.include('Review the playbook knowledge above')
  })

  it('should include save command example in prompt', async () => {
    const command = new ExecutorStart(['Test task'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify prompt includes save command instructions
    const promptCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.includes('Executor Task')
    })

    expect(promptCall).to.exist
    const displayedPrompt = promptCall?.args[0] as string
    expect(displayedPrompt).to.include('br ace executor save')
    expect(displayedPrompt).to.include('--bullet-ids')
    expect(displayedPrompt).to.include('--tool-usage')
    expect(displayedPrompt).to.include('Example:')
  })

  it('should not save prompt to file', async () => {
    const command = new ExecutorStart(['Test task'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify no mention of "saved to" in the output
    const savedToCall = logSpy.getCalls().find((call) => {
      const arg = call.args[0]
      return typeof arg === 'string' && arg.toLowerCase().includes('saved to')
    })

    expect(savedToCall).to.not.exist
  })
})
