import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {createSandbox, stub} from 'sinon'

import type {IContextTreeService} from '../../src/core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../src/core/interfaces/i-context-tree-snapshot-service.js'

import Clear from '../../src/commands/clear.js'

/**
 * Testable Clear command that accepts mocked services
 */
class TestableClear extends Clear {
  public mockConfirmError: Error | undefined = undefined
  public mockConfirmResult = false

  constructor(
    private readonly mockContextTreeService: IContextTreeService,
    private readonly mockContextTreeSnapshotService: IContextTreeSnapshotService,
    args: string[],
    config: Config,
  ) {
    super(args, config)
  }

  protected async confirmClear(): Promise<boolean> {
    if (this.mockConfirmError) {
      throw this.mockConfirmError
    }

    return this.mockConfirmResult
  }

  protected createServices() {
    return {
      contextTreeService: this.mockContextTreeService,
      contextTreeSnapshotService: this.mockContextTreeSnapshotService,
    }
  }

  // Suppress output to prevent noisy test runs
  public error(input: Error | string): never {
    const errorMessage = typeof input === 'string' ? input : input.message
    throw new Error(errorMessage)
  }

  public log(): void {
    // Do nothing - suppress output
  }
}

describe('clear command', () => {
  let sandbox: sinon.SinonSandbox
  let config: Config
  let contextTreeService: sinon.SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: sinon.SinonStubbedInstance<IContextTreeSnapshotService>

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(async () => {
    sandbox = createSandbox()

    contextTreeService = {
      exists: stub(),
      initialize: stub<[directory?: string], Promise<string>>().resolves('/test/.brv/context-tree'),
    }

    contextTreeSnapshotService = {
      getChanges: stub(),
      getCurrentState: stub(),
      hasSnapshot: stub(),
      initEmptySnapshot: stub(),
      saveSnapshot: stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('should reset context tree when user confirms', async () => {
    contextTreeService.exists.resolves(true)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, [], config)
    command.mockConfirmResult = true

    await command.run()

    expect(contextTreeService.exists.calledOnce).to.be.true
    expect(contextTreeService.initialize.calledOnce).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
  })

  it('should not reset context tree when user cancels', async () => {
    contextTreeService.exists.resolves(true)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, [], config)
    command.mockConfirmResult = false

    await command.run()

    // Verify context tree was NOT reset
    expect(contextTreeService.initialize.called).to.be.false
    expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
  })

  it('should skip confirmation and reset when --yes flag is used', async () => {
    contextTreeService.exists.resolves(true)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, ['--yes'], config)

    await command.run()

    // Verify context tree was reset without calling confirmClear
    expect(contextTreeService.initialize.calledOnce).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
  })

  it('should display message when no context tree exists', async () => {
    contextTreeService.exists.resolves(false)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, [], config)

    await command.run()

    // Verify initialize was not attempted
    expect(contextTreeService.initialize.called).to.be.false
    expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
  })

  it('should accept custom directory parameter', async () => {
    contextTreeService.exists.resolves(true)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, ['/custom/path'], config)
    command.mockConfirmResult = true

    await command.run()

    // Verify custom directory was passed to exists, initialize, and initEmptySnapshot
    expect(contextTreeService.exists.calledWith('/custom/path')).to.be.true
    expect(contextTreeService.initialize.calledWith('/custom/path')).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledWith('/custom/path')).to.be.true
  })

  it('should handle errors gracefully', async () => {
    contextTreeService.exists.rejects(new Error('Disk error'))

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, ['--yes'], config)

    try {
      await command.run()
      expect.fail('Should have thrown error')
    } catch (error) {
      expect(error).to.be.an('error')
      expect((error as Error).message).to.include('Disk error')
    }
  })

  it('should use short flag -y for yes', async () => {
    contextTreeService.exists.resolves(true)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, ['-y'], config)

    await command.run()

    // Verify context tree was reset without confirmation
    expect(contextTreeService.initialize.calledOnce).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
  })

  it('should handle user force closing the prompt (Ctrl+C)', async () => {
    contextTreeService.exists.resolves(true)

    const command = new TestableClear(contextTreeService, contextTreeSnapshotService, [], config)
    command.mockConfirmError = new Error('User force closed the prompt')

    await command.run()

    // Verify context tree was NOT reset
    expect(contextTreeService.initialize.called).to.be.false
    expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
  })
})
