import {Config} from '@oclif/core'
import {expect} from 'chai'
import * as sinon from 'sinon'

import type {IPullUseCase} from '../../src/core/interfaces/usecase/i-pull-use-case.js'

import Pull from '../../src/commands/pull.js'

class TestablePull extends Pull {
  public constructor(
    private readonly mockUseCase: IPullUseCase,
    argv: string[],
    config: Config,
  ) {
    super(argv, config)
  }

  protected createUseCase(): IPullUseCase {
    return this.mockUseCase
  }
}

describe('Pull Command', () => {
  let config: Config
  let useCase: sinon.SinonStubbedInstance<IPullUseCase>

  before(async () => {
    config = await Config.load(import.meta.url)
  })

  beforeEach(() => {
    useCase = {
      run: sinon.stub<[{branch: string}], Promise<void>>().resolves(),
    }
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('flag parsing', () => {
    it('should pass default branch to use case when no flag provided', async () => {
      const command = new TestablePull(useCase, [], config)

      await command.run()

      expect(useCase.run.calledOnce).to.be.true
      expect(useCase.run.firstCall.args[0].branch).to.equal('main')
    })

    it('should pass custom branch to use case when --branch flag provided', async () => {
      const command = new TestablePull(useCase, ['--branch', 'develop'], config)

      await command.run()

      expect(useCase.run.calledOnce).to.be.true
      expect(useCase.run.firstCall.args[0].branch).to.equal('develop')
    })

    it('should pass custom branch to use case when -b flag provided', async () => {
      const command = new TestablePull(useCase, ['-b', 'feature-auth'], config)

      await command.run()

      expect(useCase.run.calledOnce).to.be.true
      expect(useCase.run.firstCall.args[0].branch).to.equal('feature-auth')
    })
  })

  describe('use case delegation', () => {
    it('should delegate to use case run method', async () => {
      const command = new TestablePull(useCase, [], config)

      await command.run()

      expect(useCase.run.calledOnce).to.be.true
    })

    it('should propagate errors from use case', async () => {
      useCase.run.rejects(new Error('Use case error'))

      const command = new TestablePull(useCase, [], config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.equal('Use case error')
      }
    })
  })
})
