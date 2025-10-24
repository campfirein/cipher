import {Config} from '@oclif/core'
import {expect} from 'chai'
import sinon, {createSandbox} from 'sinon'

import Clear from '../../../src/commands/ace/clear.js'
import {FilePlaybookStore} from '../../../src/infra/ace/file-playbook-store.js'

describe('ace:clear command', () => {
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
    // Stub playbook store methods
    const existsStub = sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const deleteStub = sandbox.stub(FilePlaybookStore.prototype, 'delete').resolves()

    const command = new Clear([], config)
    const logSpy = sandbox.spy(command, 'log')

    // Stub the confirmClear method to return true
    sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(true)

    await command.run()

    // Verify playbook was deleted
    expect(existsStub.called).to.be.true
    expect(deleteStub.called).to.be.true
    expect(logSpy.calledWith('✓ Playbook cleared successfully.')).to.be.true
  })

  it('should not clear playbook when user cancels', async () => {
    // Stub playbook store methods
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const deleteStub = sandbox.stub(FilePlaybookStore.prototype, 'delete').resolves()

    const command = new Clear([], config)
    const logSpy = sandbox.spy(command, 'log')

    // Stub the confirmClear method to return false
    sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(false)

    await command.run()

    // Verify playbook was NOT deleted
    expect(deleteStub.called).to.be.false
    expect(logSpy.calledWith('Cancelled. Playbook was not cleared.')).to.be.true
  })

  it('should skip confirmation and clear when --yes flag is used', async () => {
    // Stub playbook store methods
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const deleteStub = sandbox.stub(FilePlaybookStore.prototype, 'delete').resolves()

    const command = new Clear(['--yes'], config)
    const logSpy = sandbox.spy(command, 'log')

    // Stub confirmation prompt (should not be called)
    const confirmStub = sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(true)

    await command.run()

    // Verify confirmation was NOT prompted
    expect(confirmStub.called).to.be.false
    // Verify playbook was deleted
    expect(deleteStub.called).to.be.true
    expect(logSpy.calledWith('✓ Playbook cleared successfully.')).to.be.true
  })

  it('should display message when no playbook exists', async () => {
    // Stub playbook store to indicate no playbook exists
    sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(false)
    const deleteStub = sandbox.stub(FilePlaybookStore.prototype, 'delete').resolves()

    const command = new Clear([], config)
    const logSpy = sandbox.spy(command, 'log')

    await command.run()

    // Verify deletion was not attempted
    expect(deleteStub.called).to.be.false
    expect(logSpy.calledWith('No playbook found. Nothing to clear.')).to.be.true
  })

  it('should accept custom directory parameter', async () => {
    const existsStub = sandbox.stub(FilePlaybookStore.prototype, 'exists').resolves(true)
    const deleteStub = sandbox.stub(FilePlaybookStore.prototype, 'delete').resolves()

    const command = new Clear(['/custom/path'], config)
    sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(true)

    await command.run()

    // Verify custom directory was passed to both exists and delete
    expect(existsStub.calledWith('/custom/path')).to.be.true
    expect(deleteStub.calledWith('/custom/path')).to.be.true
  })

  it('should handle errors gracefully', async () => {
    // Stub playbook store to throw error
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
    const deleteStub = sandbox.stub(FilePlaybookStore.prototype, 'delete').resolves()

    const command = new Clear(['-y'], config)
    const confirmStub = sandbox.stub(command as unknown as {confirmClear: () => Promise<boolean>}, 'confirmClear').resolves(true)

    await command.run()

    // Verify confirmation was NOT prompted with short flag
    expect(confirmStub.called).to.be.false
    expect(deleteStub.called).to.be.true
  })
})
