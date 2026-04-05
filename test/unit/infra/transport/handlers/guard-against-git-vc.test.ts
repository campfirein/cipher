import {expect} from 'chai'
import {restore, stub} from 'sinon'

import type {IContextTreeService} from '../../../../../src/server/core/interfaces/context-tree/i-context-tree-service.js'

import {GitVcInitializedError} from '../../../../../src/server/core/domain/errors/task-error.js'
import {guardAgainstGitVc} from '../../../../../src/server/infra/transport/handlers/handler-types.js'

describe('guardAgainstGitVc', () => {
  let contextTreeService: {
    delete: ReturnType<typeof stub>
    exists: ReturnType<typeof stub>
    hasGitRepo: ReturnType<typeof stub>
    initialize: ReturnType<typeof stub>
    resolvePath: ReturnType<typeof stub>
  }

  beforeEach(() => {
    contextTreeService = {
      delete: stub(),
      exists: stub(),
      hasGitRepo: stub(),
      initialize: stub(),
      resolvePath: stub(),
    }
  })

  afterEach(() => {
    restore()
  })

  it('should throw GitVcInitializedError when .git exists in context tree', async () => {
    contextTreeService.hasGitRepo.resolves(true)

    try {
      await guardAgainstGitVc({
        contextTreeService: contextTreeService as unknown as IContextTreeService,
        projectPath: '/test/project',
      })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(GitVcInitializedError)
      expect((error as GitVcInitializedError).code).to.equal('ERR_VC_GIT_INITIALIZED')
    }
  })

  it('should not throw when .git does not exist', async () => {
    contextTreeService.hasGitRepo.resolves(false)

    await guardAgainstGitVc({
      contextTreeService: contextTreeService as unknown as IContextTreeService,
      projectPath: '/test/project',
    })

    expect(contextTreeService.hasGitRepo.calledOnce).to.be.true
    expect(contextTreeService.hasGitRepo.calledWith('/test/project')).to.be.true
  })
})
