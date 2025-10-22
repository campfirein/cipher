import {expect} from 'chai'
import sinon, {restore, stub} from 'sinon'

import type {IConfigStore} from '../../../../src/core/interfaces/i-config-store.js'
import type {ISpaceService} from '../../../../src/core/interfaces/i-space-service.js'
import type {ITokenStore} from '../../../../src/core/interfaces/i-token-store.js'

import {AuthToken} from '../../../../src/core/domain/entities/auth-token.js'
import {BrConfig} from '../../../../src/core/domain/entities/br-config.js'
import {Space} from '../../../../src/core/domain/entities/space.js'
import {InitUseCase} from '../../../../src/core/usecases/init-use-case.js'

describe('InitUseCase', () => {
  let tokenStore: sinon.SinonStubbedInstance<ITokenStore>
  let spaceService: sinon.SinonStubbedInstance<ISpaceService>
  let configStore: sinon.SinonStubbedInstance<IConfigStore>
  let useCase: InitUseCase

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

    useCase = new InitUseCase(tokenStore, spaceService, configStore)
  })

  afterEach(() => {
    restore()
  })

  describe('checkIfInitialized', () => {
    it('should return true if config exists', async () => {
      configStore.exists.resolves(true)

      const result = await useCase.checkIfInitialized()

      expect(result).to.be.true
      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should return false if config does not exist', async () => {
      configStore.exists.resolves(false)

      const result = await useCase.checkIfInitialized()

      expect(result).to.be.false
      expect(configStore.exists.calledOnce).to.be.true
    })

    it('should pass directory parameter to configStore', async () => {
      configStore.exists.resolves(true)

      await useCase.checkIfInitialized('/custom/directory')

      expect(configStore.exists.calledWith('/custom/directory')).to.be.true
    })
  })

  describe('fetchSpaces', () => {
    it('should return error when no token exists', async () => {
      tokenStore.load.resolves()

      const result = await useCase.fetchSpaces()

      expect(result.success).to.be.false
      expect(result.error).to.equal('Not authenticated. Please run "br auth login" first.')
      expect(result.spaces).to.equal(undefined)
    })

    it('should return error when token is expired', async () => {
      const expiredToken = new AuthToken(
        'access-token',
        'refresh-token',
        new Date(Date.now() - 1000), // Expired 1 second ago
      )
      tokenStore.load.resolves(expiredToken)

      const result = await useCase.fetchSpaces()

      expect(result.success).to.be.false
      expect(result.error).to.equal('Authentication token expired. Please run "br auth login" again.')
      expect(result.spaces).to.equal(undefined)
    })

    it('should return error when no spaces are available', async () => {
      const validToken = new AuthToken(
        'access-token',
        'refresh-token',
        new Date(Date.now() + 3600 * 1000), // Expires in 1 hour
      )
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves([])

      const result = await useCase.fetchSpaces()

      expect(result.success).to.be.false
      expect(result.error).to.equal('No spaces found. Please create a space in the ByteRover dashboard first.')
      expect(result.spaces).to.equal(undefined)
    })

    it('should return spaces successfully', async () => {
      const validToken = new AuthToken(
        'access-token',
        'refresh-token',
        new Date(Date.now() + 3600 * 1000), // Expires in 1 hour
      )
      const spaces = [
        new Space('space-1', 'frontend-app', 'team-1', 'acme-corp'),
        new Space('space-2', 'backend-api', 'team-2', 'personal'),
      ]

      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.resolves(spaces)

      const result = await useCase.fetchSpaces()

      expect(result.success).to.be.true
      expect(result.spaces).to.deep.equal(spaces)
      expect(result.error).to.equal(undefined)
      expect(spaceService.getSpaces.calledWith('access-token')).to.be.true
    })

    it('should return error when space service throws', async () => {
      const validToken = new AuthToken('access-token', 'refresh-token', new Date(Date.now() + 3600 * 1000))
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.rejects(new Error('Network error'))

      const result = await useCase.fetchSpaces()

      expect(result.success).to.be.false
      expect(result.error).to.equal('Network error')
      expect(result.spaces).to.equal(undefined)
    })

    it('should handle errors with messages', async () => {
      const validToken = new AuthToken('access-token', 'refresh-token', new Date(Date.now() + 3600 * 1000))
      tokenStore.load.resolves(validToken)
      spaceService.getSpaces.rejects(new Error('Custom error message'))

      const result = await useCase.fetchSpaces()

      expect(result.success).to.be.false
      expect(result.error).to.equal('Custom error message')
      expect(result.spaces).to.equal(undefined)
    })
  })

  describe('saveConfig', () => {
    it('should save config to store', async () => {
      const config = new BrConfig(new Date().toISOString(), 'space-1', 'frontend-app', 'team-1', 'acme-corp')

      await useCase.saveConfig(config)

      expect(configStore.write.calledOnce).to.be.true
      expect(configStore.write.calledWith(config)).to.be.true
    })

    it('should pass directory parameter to configStore', async () => {
      const config = new BrConfig(new Date().toISOString(), 'space-1', 'frontend-app', 'team-1', 'acme-corp')

      await useCase.saveConfig(config, '/custom/directory')

      expect(configStore.write.calledWith(config, '/custom/directory')).to.be.true
    })
  })
})
