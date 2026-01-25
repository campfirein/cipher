import type {SinonStubbedInstance} from 'sinon'

import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IContextTreeService} from '../../../src/core/interfaces/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../src/core/interfaces/i-context-tree-snapshot-service.js'
import type {ITerminal} from '../../../src/core/interfaces/i-terminal.js'

import {ResetUseCase, type ResetUseCaseOptions} from '../../../src/infra/usecase/reset-use-case.js'
import {createMockTerminal} from '../../helpers/mock-factories.js'

class TestableResetUseCase extends ResetUseCase {
  public deleteContextTreeCalled = false
  public deletedPath: string | undefined

  public constructor(options: ResetUseCaseOptions) {
    super(options)
  }

  protected async deleteContextTree(contextTreeDir: string): Promise<void> {
    this.deleteContextTreeCalled = true
    this.deletedPath = contextTreeDir
  }
}

describe('ResetUseCase', () => {
  let contextTreeService: SinonStubbedInstance<IContextTreeService>
  let contextTreeSnapshotService: SinonStubbedInstance<IContextTreeSnapshotService>
  let errorMessages: string[]
  let logMessages: string[]
  let terminal: ITerminal

  beforeEach(() => {
    logMessages = []
    errorMessages = []

    terminal = createMockTerminal({
      error: (msg) => errorMessages.push(msg),
      log: (msg) => msg !== undefined && logMessages.push(msg),
    })

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
    restore()
  })

  function createUseCase(): TestableResetUseCase {
    return new TestableResetUseCase({
      contextTreeService,
      contextTreeSnapshotService,
      terminal,
    })
  }

  it('should reset context tree when user confirms', async () => {
    contextTreeService.exists.resolves(true)
    stub(terminal, 'confirm').resolves(true)

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: false})

    expect(contextTreeService.exists.calledOnce).to.be.true
    expect(contextTreeService.initialize.calledOnce).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
  })

  it('should not reset context tree when user cancels', async () => {
    contextTreeService.exists.resolves(true)
    stub(terminal, 'confirm').resolves(false)

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: false})

    // Verify context tree was NOT reset
    expect(contextTreeService.initialize.called).to.be.false
    expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
    expect(logMessages).to.include('Cancelled. Context tree was not reset.')
  })

  it('should skip confirmation and reset when skipConfirmation is true', async () => {
    contextTreeService.exists.resolves(true)
    const confirmStub = stub(terminal, 'confirm').resolves(true)

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: true})

    // Verify context tree was reset without calling confirm
    expect(confirmStub.called).to.be.false
    expect(contextTreeService.initialize.calledOnce).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledOnce).to.be.true
  })

  it('should display message when no context tree exists', async () => {
    contextTreeService.exists.resolves(false)

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: false})

    // Verify initialize was not attempted
    expect(contextTreeService.initialize.called).to.be.false
    expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
    expect(logMessages).to.include('No context tree found. Nothing to reset.')
  })

  it('should accept custom directory parameter', async () => {
    contextTreeService.exists.resolves(true)
    stub(terminal, 'confirm').resolves(true)

    const useCase = createUseCase()

    await useCase.run({directory: '/custom/path', skipConfirmation: false})

    // Verify custom directory was passed to exists, initialize, and initEmptySnapshot
    expect(contextTreeService.exists.calledWith('/custom/path')).to.be.true
    expect(contextTreeService.initialize.calledWith('/custom/path')).to.be.true
    expect(contextTreeSnapshotService.initEmptySnapshot.calledWith('/custom/path')).to.be.true
  })

  it('should handle errors gracefully', async () => {
    contextTreeService.exists.rejects(new Error('Disk error'))

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: true})

    expect(errorMessages).to.have.lengthOf(1)
    expect(errorMessages[0]).to.include('Disk error')
  })

  it('should handle user force closing the prompt (Ctrl+C)', async () => {
    contextTreeService.exists.resolves(true)
    stub(terminal, 'confirm').rejects(new Error('User force closed the prompt'))

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: false})

    // Verify context tree was NOT reset
    expect(contextTreeService.initialize.called).to.be.false
    expect(contextTreeSnapshotService.initEmptySnapshot.called).to.be.false
    expect(logMessages).to.include('Cancelled. Context tree was not reset.')
  })

  it('should display success message after reset', async () => {
    contextTreeService.exists.resolves(true)
    stub(terminal, 'confirm').resolves(true)

    const useCase = createUseCase()

    await useCase.run({skipConfirmation: false})

    expect(logMessages).to.include('✓ Context tree reset successfully. Your context tree is now empty.')
  })
})
