import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Space} from '../../src/core/domain/entities/space.js'
import type {IProjectConfigStore} from '../../src/core/interfaces/i-project-config-store.js'
import type {ISpaceService} from '../../src/core/interfaces/i-space-service.js'
import type {ITokenStore} from '../../src/core/interfaces/i-token-store.js'

import Init from '../../src/commands/init.js'
import {AuthToken} from '../../src/core/domain/entities/auth-token.js'
import {Space as SpaceImpl} from '../../src/core/domain/entities/space.js'
import {InitializePlaybookUseCase} from '../../src/core/usecases/initialize-playbook-use-case.js'

/**
 * Testable Init command that accepts mocked services
 */
class TestableInit extends Init {
  // eslint-disable-next-line max-params
  constructor(
    private readonly mockConfigStore: IProjectConfigStore,
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTokenStore: ITokenStore,
    private readonly mockPromptResponse: string,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      projectConfigStore: this.mockConfigStore,
      spaceService: this.mockSpaceService,
      tokenStore: this.mockTokenStore,
    }
  }

  protected async promptUser(_question: string): Promise<string> {
    return this.mockPromptResponse
  }
}

describe('Init Command', () => {
  let config: Config
  let configStore: sinon.SinonStubbedInstance<IProjectConfigStore>
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let testSpaces: Space[]
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let validToken: AuthToken

  before(async () => {
    config = await OclifConfig.load(import.meta.url)
  })

  beforeEach(() => {
    tokenStore = {
      clear: stub(),
      load: stub(),
      save: stub(),
    }

    spaceService = {
      getSpaces: stub(),
    }

    configStore = {
      exists: stub(),
      read: stub(),
      write: stub(),
    }

    validToken = new AuthToken(
      'access-token',
      new Date(Date.now() + 3600 * 1000),
      'refresh-token',
      'session-key',
      'Bearer',
    )

    testSpaces = [
      new SpaceImpl('space-1', 'frontend-app', 'team-1', 'acme-corp'),
      new SpaceImpl('space-2', 'backend-api', 'team-1', 'acme-corp'),
    ]

    // Stub ACE initialization to always succeed
    stub(InitializePlaybookUseCase.prototype, 'execute').resolves({
      playbookPath: '/test/.br/ace/playbook.json',
      success: true,
    })
  })

  afterEach(() => {
    restore()
  })

  describe('execute()', () => {
    it('should exit early if project is already initialized', async () => {
      configStore.exists.resolves(true)

      const command = new TestableInit(configStore, spaceService, tokenStore, '1', config)

      await command.run()

      expect(configStore.exists.calledOnce).to.be.true
      expect(tokenStore.load.called).to.be.false // Should not proceed
    })

    it('should throw error when not authenticated', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves()

      const command = new TestableInit(configStore, spaceService, tokenStore, '1', config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Not authenticated')
      }
    })

    it('should throw error when token is expired', async () => {
      const expiredToken = new AuthToken(
        'access-token',
        new Date(Date.now() - 1000),
        'refresh-token',
        'session-key',
        'Bearer',
      )

      configStore.exists.resolves(false)
      tokenStore.load.resolves(expiredToken)

      const command = new TestableInit(configStore, spaceService, tokenStore, '1', config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('expired')
      }
    })

    it('should throw error when no spaces are available', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const command = new TestableInit(configStore, spaceService, tokenStore, '1', config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('No spaces found')
      }
    })

    it('should throw error when selection is empty', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        configStore,
        spaceService,
        tokenStore,
        '', // Empty input
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('required')
      }
    })

    it('should throw error when selection is not a number', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        configStore,
        spaceService,
        tokenStore,
        'invalid', // Non-numeric input
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid selection')
      }
    })

    it('should throw error when selection is negative', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})

      const command = new TestableInit(
        configStore,
        spaceService,
        tokenStore,
        '0', // Maps to -1 after conversion
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid selection')
      }
    })

    it('should throw error when selection exceeds available spaces', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length}) // 2 spaces

      const command = new TestableInit(
        configStore,
        spaceService,
        tokenStore,
        '99', // Way out of bounds
        config,
      )

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Invalid selection')
      }
    })

    it('should successfully initialize with first space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        spaceService,
        tokenStore,
        '1', // Select first space
        config,
      )

      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {fetchAll: true})).to.be.true
      expect(configStore.write.calledOnce).to.be.true

      const writtenConfig = configStore.write.getCall(0).args[0]
      expect(writtenConfig.spaceId).to.equal('space-1')
      expect(writtenConfig.spaceName).to.equal('frontend-app')
      expect(writtenConfig.teamId).to.equal('team-1')
      expect(writtenConfig.teamName).to.equal('acme-corp')
    })

    it('should successfully initialize with second space', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.resolves()

      const command = new TestableInit(
        configStore,
        spaceService,
        tokenStore,
        '2', // Select second space
        config,
      )

      await command.run()

      const writtenConfig = configStore.write.getCall(0).args[0]
      expect(writtenConfig.spaceId).to.equal('space-2')
      expect(writtenConfig.spaceName).to.equal('backend-api')
    })

    it('should propagate errors from space service', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.rejects(new Error('Network timeout'))

      const command = new TestableInit(configStore, spaceService, tokenStore, '1', config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Network timeout')
      }
    })

    it('should propagate errors from config store', async () => {
      configStore.exists.resolves(false)
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: testSpaces.length})
      configStore.write.rejects(new Error('Permission denied'))

      const command = new TestableInit(configStore, spaceService, tokenStore, '1', config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Permission denied')
      }
    })
  })
})
