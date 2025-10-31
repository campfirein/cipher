import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon, {createSandbox} from 'sinon'

import Clear from '../../src/commands/clear'
import {FilePlaybookStore} from '../../src/infra/ace/file-playbook-store'

describe('clear command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config

  beforeEach(async () => {
    sandbox = createSandbox()
    config = await Config.load()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should clear playbook when user confirms', async () => {
    const existsStub = sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const saveStub = sandbox.stub(FilePlaybookStore.prototype, 'save').resolves()

    const command = new Clear([], config)
    const logStub = sandbox.stub(command, 'log')
    // Note: not very happy with this cast, but needed to stub protected method.
    // Maybe create a TestableClear class is better in the future.
    sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(true)

    await command.run()

    expect(existsStub.called).to.be.true
    expect(saveStub.called).to.be.true
    expect(logStub.calledWith('✓ Playbook cleared successfully.')).to.be.true
  })

  it('should not clear playbook when user cancels', async () => {
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const saveStub = sandbox.stub(FilePlaybookStore.prototype, 'save').resolves()

    const command = new Clear([], config)
    const logStub = sandbox.stub(command, 'log')

    // User cancels confirmation
    sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(false)

    await command.run()

    // Verify playbook was NOT reset
    expect(saveStub.called).to.be.false
    expect(logStub.calledWith('Cancelled. Playbook was not cleared.')).to.be.true
  })

  it('should skip confirmation and clear when --yes flag is used', async () => {
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const saveStub = sandbox.stub(FilePlaybookStore.prototype, 'save').resolves()

    // Pass --yes flag
    const command = new Clear(['--yes'], config)
    const logStub = sandbox.stub(command, 'log')

    const confirmStub = sandbox
      .stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear')
      // Resolved value of stubbed confirmClear should not matter here
      .resolves(true)

    await command.run()

    // Verify confirmation was NOT prompted
    expect(confirmStub.called).to.be.false
    // Verify playbook was reset
    expect(saveStub.called).to.be.true
    expect(logStub.calledWith('✓ Playbook cleared successfully.')).to.be.true
  })

  it('should display message when no playbook exists', async () => {
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(false)
    const saveStub = sandbox.stub(FilePlaybookStore.prototype, 'save').resolves()

    const command = new Clear([], config)
    const logStub = sandbox.stub(command, 'log')

    await command.run()

    // Verify save was not attempted
    expect(saveStub.called).to.be.false
    expect(logStub.calledWith('No playbook found. Nothing to clear.')).to.be.true
  })

  it('should accept custom directory parameter', async () => {
    const existsStub = sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const saveStub = sandbox.stub(FilePlaybookStore.prototype, 'save').resolves()

    const command = new Clear(['/custom/path'], config)
    sandbox.stub(command, 'log')
    sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(true)

    await command.run()

    // Verify custom directory was passed to both exists and save
    expect(existsStub.calledWith('/custom/path')).to.be.true
    expect(saveStub.called).to.be.true
    // Verify save was called with empty playbook and custom directory
    const saveCall = saveStub.getCall(0)
    expect(saveCall.args[1]).to.equal('/custom/path')
  })

  it('should handle errors gracefully', async () => {
    sandbox.stub(FilePlaybookStore.prototype, 'exists').rejects(new Error('Disk error'))

    const command = new Clear(['--yes'], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Disk error')
    }
  })

  it('should use short flag -y for yes', async () => {
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const saveStub = sandbox.stub(FilePlaybookStore.prototype, 'save').resolves()

    const command = new Clear(['-y'], config)
    sandbox.stub(command, 'log')
    const confirmStub = sandbox
      .stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear')
      .resolves(true)

    await command.run()

    // Verify confirmation was NOT prompted with short flag
    expect(confirmStub.called).to.be.false
    expect(saveStub.called).to.be.true
  })
})
