import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon from 'sinon'

import Show from '../../../src/commands/ace/show.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {LoadPlaybookUseCase} from '../../../src/core/usecases/load-playbook-use-case.js'

describe('ace:show command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config

  beforeEach(async () => {
    sandbox = sinon.createSandbox()
    config = await Config.load()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should display playbook in markdown format by default', async () => {
    const playbook = new Playbook()
    playbook.addBullet('Common Errors', 'Always validate inputs', undefined, {
      codebasePath: '/src',
      tags: ['validation'],
      timestamp: new Date().toISOString(),
    })

    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook,
      playbookPrompt: playbook.asPrompt(),
      success: true,
    })

    const command = new Show([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    expect(logSpy.calledWith(sinon.match(/ACE Playbook/))).to.be.true
    expect(logSpy.calledWith(sinon.match(/Common Errors/))).to.be.true
    expect(logSpy.calledWith(sinon.match(/Always validate inputs/))).to.be.true
  })

  it('should display playbook in JSON format when --format json is used', async () => {
    const playbook = new Playbook()
    playbook.addBullet('Best Practices', 'Use dependency injection', undefined, {
      codebasePath: '/src',
      tags: ['architecture'],
      timestamp: new Date().toISOString(),
    })

    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook,
      playbookPrompt: playbook.asPrompt(),
      success: true,
    })

    const command = new Show(['--format', 'json'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Should output valid JSON
    const output = logSpy.firstCall.args[0] as string
    expect(() => JSON.parse(output)).to.not.throw()

    const parsed = JSON.parse(output)
    expect(parsed).to.have.property('bullets')
    expect(parsed).to.have.property('sections')
  })

  it('should display message when playbook is empty', async () => {
    const emptyPlaybook = new Playbook()

    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook: emptyPlaybook,
      playbookPrompt: '(Empty playbook)',
      success: true,
    })

    const command = new Show([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    expect(logSpy.calledWith(sinon.match(/empty/i))).to.be.true
  })

  it('should display error when playbook not found', async () => {
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      error: 'Playbook not found',
      success: false,
    })

    const command = new Show([], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Playbook not found')
    }
  })

  it('should accept custom directory parameter', async () => {
    const playbook = new Playbook()
    const executeStub = sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook,
      playbookPrompt: '(Empty playbook)',
      success: true,
    })

    const command = new Show(['/custom/path'], config)
    await command.run()

    // Verify directory was passed to use case
    expect(executeStub.calledWith('/custom/path')).to.be.true
  })

  it('should handle unexpected errors gracefully', async () => {
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').rejects(new Error('Disk error'))

    const command = new Show([], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Disk error')
    }
  })
})
