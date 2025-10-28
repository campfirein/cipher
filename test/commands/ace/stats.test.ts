import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon, {createSandbox, match} from 'sinon'

import Stats from '../../../src/commands/ace/stats.js'
import {Playbook} from '../../../src/core/domain/entities/playbook.js'
import {LoadPlaybookUseCase} from '../../../src/core/usecases/load-playbook-use-case.js'

describe('ace:stats command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config

  beforeEach(async () => {
    sandbox = createSandbox()
    config = await Config.load()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should display statistics in table format by default', async () => {
    // Create playbook with sample data
    const playbook = new Playbook()
    playbook.addBullet('Common Errors', 'Validation error', 'error-00001', {
      relatedFiles: [],
      tags: ['validation', 'helpful'],
      timestamp: new Date().toISOString(),
    })
    playbook.addBullet('Best Practices', 'Use DI pattern', 'practices-00001', {
      relatedFiles: [],
      tags: ['architecture', 'helpful'],
      timestamp: new Date().toISOString(),
    })

    // Stub use case
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook,
      playbookPrompt: 'test',
      success: true,
    })

    const command = new Stats([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify table output
    expect(logSpy.calledWith(match(/Sections:\s+2/))).to.be.true
    expect(logSpy.calledWith(match(/Bullets:\s+2/))).to.be.true
    expect(logSpy.calledWith(match(/Tags:\s+3/))).to.be.true
    expect(logSpy.calledWith(match(/validation/))).to.be.true
    expect(logSpy.calledWith(match(/helpful/))).to.be.true
    expect(logSpy.calledWith(match(/architecture/))).to.be.true
  })

  it('should display statistics in JSON format when --format json is used', async () => {
    // Create playbook with sample data
    const playbook = new Playbook()
    playbook.addBullet('Common Errors', 'Error', 'error-00001', {
      relatedFiles: [],
      tags: ['validation'],
      timestamp: new Date().toISOString(),
    })

    // Stub use case
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook,
      playbookPrompt: 'test',
      success: true,
    })

    const command = new Stats(['--format', 'json'], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify JSON output
    const output = logSpy.firstCall.args[0] as string
    expect(() => JSON.parse(output)).to.not.throw()

    const stats = JSON.parse(output)
    expect(stats.sections).to.equal(1)
    expect(stats.bullets).to.equal(1)
    expect(stats.tags).to.deep.equal(['validation'])
  })

  it('should display empty statistics for empty playbook', async () => {
    // Empty playbook
    const playbook = new Playbook()

    // Stub use case
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      playbook,
      playbookPrompt: '(Empty playbook)',
      success: true,
    })

    const command = new Stats([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify zero statistics
    expect(logSpy.calledWith(match(/Sections:\s+0/))).to.be.true
    expect(logSpy.calledWith(match(/Bullets:\s+0/))).to.be.true
    expect(logSpy.calledWith(match(/Tags:\s+0/))).to.be.true
  })

  it('should handle error when playbook not found', async () => {
    // Stub use case to return error
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').resolves({
      error: 'Playbook not found',
      success: false,
    })

    const command = new Stats([], config)

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

    const command = new Stats(['/custom/path'], config)
    await command.run()

    // Verify custom directory was passed
    expect(executeStub.calledWith('/custom/path')).to.be.true
  })

  it('should handle unexpected errors gracefully', async () => {
    // Stub use case to throw error
    sandbox.stub(LoadPlaybookUseCase.prototype, 'execute').rejects(new Error('Unexpected error'))

    const command = new Stats([], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Unexpected error')
    }
  })
})
