import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon, {createSandbox, match} from 'sinon'

import Init from '../../../src/commands/ace/init.js'
import {InitializePlaybookUseCase} from '../../../src/core/usecases/initialize-playbook-use-case.js'

describe('ace:init command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config

  beforeEach(async () => {
    sandbox = createSandbox()
    config = await Config.load()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should display success message on successful initialization', async () => {
    // Stub use case
    sandbox.stub(InitializePlaybookUseCase.prototype, 'execute').resolves({
      playbookPath: '/test/path/.br/ace/playbook.json',
      success: true,
    })

    const command = new Init([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    expect(logSpy.calledWith(match(/ACE playbook initialized/))).to.be.true
    expect(logSpy.calledWith(match(/playbook.json/))).to.be.true
  })

  it('should display error message when initialization fails', async () => {
    // Stub use case to return error
    sandbox.stub(InitializePlaybookUseCase.prototype, 'execute').resolves({
      error: 'Playbook already exists',
      success: false,
    })

    const command = new Init([], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Playbook already exists')
    }
  })

  it('should handle unexpected errors gracefully', async () => {
    // Stub use case to throw error
    sandbox.stub(InitializePlaybookUseCase.prototype, 'execute').rejects(new Error('Unexpected error'))

    const command = new Init([], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Unexpected error')
    }
  })

  it('should create proper directory structure', async () => {
    sandbox.stub(InitializePlaybookUseCase.prototype, 'execute').resolves({
      playbookPath: '/test/.br/ace/playbook.json',
      success: true,
    })

    const command = new Init([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify directory structure is displayed
    expect(logSpy.calledWith(match(/reflections/))).to.be.true
    expect(logSpy.calledWith(match(/executor-outputs/))).to.be.true
    expect(logSpy.calledWith(match(/deltas/))).to.be.true
    expect(logSpy.calledWith(match(/prompts/))).to.be.true
  })
})
