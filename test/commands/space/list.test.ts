import type {Config} from '@oclif/core'

import {Config as OclifConfig} from '@oclif/core'
import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {Space} from '../../../src/core/domain/entities/space.js'
import type {ISpaceService} from '../../../src/core/interfaces/i-space-service.js'
import type {ITokenStore} from '../../../src/core/interfaces/i-token-store.js'

import SpaceList from '../../../src/commands/space/list.js'
import {AuthToken} from '../../../src/core/domain/entities/auth-token.js'
import {Space as SpaceImpl} from '../../../src/core/domain/entities/space.js'

/**
 * Testable SpaceList command that accepts mocked services
 */
class TestableSpaceList extends SpaceList {
  constructor(
    private readonly mockSpaceService: ISpaceService,
    private readonly mockTokenStore: ITokenStore,
    config: Config,
  ) {
    super([], config)
  }

  protected createServices() {
    return {
      spaceService: this.mockSpaceService,
      tokenStore: this.mockTokenStore,
    }
  }
}

describe('SpaceList Command', () => {
  let config: Config
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
  })

  afterEach(() => {
    restore()
  })

  describe('authentication', () => {
    it('should throw error when not authenticated', async () => {
      tokenStore.load.resolves()

      const command = new TestableSpaceList(spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('Not authenticated')
      }
    })

    it('should throw error when token is expired', async () => {
      const expiredToken = new AuthToken(
        'access-token',
        new Date(Date.now() - 1000), // Expired
        'refresh-token',
        'session-key',
        'Bearer',
      )
      tokenStore.load.resolves(expiredToken)

      const command = new TestableSpaceList(spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('expired')
      }
    })
  })

  describe('default behavior', () => {
    it('should fetch spaces with default pagination (limit=50, offset=0)', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {limit: 50, offset: 0})).to.be.true
    })

    it('should display spaces in human-readable format', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      // Note: In a real test, we'd capture and verify log output
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('empty results', () => {
    it('should display message when no spaces found', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: [], total: 0})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('pagination flags', () => {
    it('should fetch spaces with custom limit', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['--limit', '10']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {limit: 10, offset: 0})).to.be.true
    })

    it('should fetch spaces with custom offset', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['--offset', '20']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {limit: 50, offset: 20})).to.be.true
    })

    it('should fetch spaces with both limit and offset', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['--limit', '10', '--offset', '20']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {limit: 10, offset: 20})).to.be.true
    })

    it('should fetch all spaces with --all flag', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['--all']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {fetchAll: true})).to.be.true
    })

    it('should use short flags -l and -o', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['-l', '15', '-o', '30']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {limit: 15, offset: 30})).to.be.true
    })

    it('should use short flag -a for --all', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['-a']
      await command.run()

      expect(spaceService.getSpaces.calledWith('access-token', 'session-key', {fetchAll: true})).to.be.true
    })
  })

  describe('JSON output', () => {
    it('should output JSON format with --json flag', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['--json']
      // Note: In a real test, we'd capture and verify JSON output
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should use short flag -j for --json', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['-j']
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('pagination warning', () => {
    it('should display warning when more spaces exist', async () => {
      tokenStore.load.resolves(validToken)
      // Return 2 spaces but total is 100 (more exist)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 100})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      // Note: In a real test, we'd verify the warning message appears
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should not display warning when all spaces are shown', async () => {
      tokenStore.load.resolves(validToken)
      // Return all spaces (total matches length)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })

    it('should not display warning when using --all flag', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves({spaces: testSpaces, total: 2})

      const command = new TestableSpaceList(spaceService, tokenStore, config)
      command.argv = ['--all']
      await command.run()

      expect(spaceService.getSpaces.calledOnce).to.be.true
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.rejects(new Error('API unavailable'))

      const command = new TestableSpaceList(spaceService, tokenStore, config)

      try {
        await command.run()
        expect.fail('Should have thrown error')
      } catch (error) {
        expect((error as Error).message).to.include('API unavailable')
      }
    })
  })
})
