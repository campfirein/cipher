import {expect} from 'chai'

import {BRV_CONFIG_VERSION} from '../../../../../src/constants.js'
import {BrvConfig, BrvConfigParams} from '../../../../../src/core/domain/entities/brv-config.js'
import {Space} from '../../../../../src/core/domain/entities/space.js'
import {BrvConfigVersionError} from '../../../../../src/core/domain/errors/brv-config-version-error.js'

describe('BrvConfig', () => {
  const validConstructorArgs: BrvConfigParams = {
    chatLogPath: '/path/to/chat.log',
    createdAt: '2025-01-01T00:00:00.000Z',
    cwd: '/path/to/project',
    ide: 'Claude Code',
    spaceId: 'space-123',
    spaceName: 'test-space',
    teamId: 'team-456',
    teamName: 'test-team',
    version: BRV_CONFIG_VERSION,
  }

  describe('constructor', () => {
    it('should create config with all required fields including version', () => {
      const config = new BrvConfig(validConstructorArgs)

      expect(config.chatLogPath).to.equal(validConstructorArgs.chatLogPath)
      expect(config.createdAt).to.equal(validConstructorArgs.createdAt)
      expect(config.cwd).to.equal(validConstructorArgs.cwd)
      expect(config.ide).to.equal(validConstructorArgs.ide)
      expect(config.spaceId).to.equal(validConstructorArgs.spaceId)
      expect(config.spaceName).to.equal(validConstructorArgs.spaceName)
      expect(config.teamId).to.equal(validConstructorArgs.teamId)
      expect(config.teamName).to.equal(validConstructorArgs.teamName)
      expect(config.version).to.equal(BRV_CONFIG_VERSION)
    })
  })

  describe('toJson', () => {
    it('should serialize config to JSON including version', () => {
      const config = new BrvConfig(validConstructorArgs)
      const json = config.toJson()

      expect(json).to.deep.include({
        chatLogPath: validConstructorArgs.chatLogPath,
        createdAt: validConstructorArgs.createdAt,
        cwd: validConstructorArgs.cwd,
        ide: validConstructorArgs.ide,
        spaceId: validConstructorArgs.spaceId,
        spaceName: validConstructorArgs.spaceName,
        teamId: validConstructorArgs.teamId,
        teamName: validConstructorArgs.teamName,
        version: BRV_CONFIG_VERSION,
      })
    })
  })

  describe('fromJson', () => {
    it('should deserialize config from JSON with valid version', () => {
      const json = {...validConstructorArgs}
      const config = BrvConfig.fromJson(json)

      expect(config.version).to.equal(BRV_CONFIG_VERSION)
      expect(config.spaceId).to.equal(validConstructorArgs.spaceId)
    })

    it('should throw BrvConfigVersionError when version is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {version: _, ...jsonWithoutVersion} = validConstructorArgs
      expect(() => BrvConfig.fromJson(jsonWithoutVersion)).to.throw(BrvConfigVersionError)
    })

    it('should throw BrvConfigVersionError with correct properties when version is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {version: _, ...jsonWithoutVersion} = validConstructorArgs

      try {
        BrvConfig.fromJson(jsonWithoutVersion)
        expect.fail('Expected BrvConfigVersionError to be thrown')
      } catch (error) {
        expect(error).to.be.instanceof(BrvConfigVersionError)
        const versionError = error as BrvConfigVersionError
        expect(versionError.currentVersion).to.be.undefined
        expect(versionError.expectedVersion).to.equal(BRV_CONFIG_VERSION)
      }
    })

    it('should throw BrvConfigVersionError when version is mismatched', () => {
      const jsonWithWrongVersion = {...validConstructorArgs, version: '0.0.0'}

      expect(() => BrvConfig.fromJson(jsonWithWrongVersion)).to.throw(BrvConfigVersionError)
    })

    it('should throw BrvConfigVersionError with correct properties when version is mismatched', () => {
      const jsonWithWrongVersion = {...validConstructorArgs, version: '0.0.0'}

      try {
        BrvConfig.fromJson(jsonWithWrongVersion)
        expect.fail('Expected BrvConfigVersionError to be thrown')
      } catch (error) {
        expect(error).to.be.instanceof(BrvConfigVersionError)
        const versionError = error as BrvConfigVersionError
        expect(versionError.currentVersion).to.equal('0.0.0')
        expect(versionError.expectedVersion).to.equal(BRV_CONFIG_VERSION)
      }
    })

    it('should throw Error when JSON structure is invalid', () => {
      const invalidJson = {spaceId: 'space-123'}

      expect(() => BrvConfig.fromJson(invalidJson)).to.throw('Invalid BrvConfig JSON structure')
    })

    it('should round-trip serialize and deserialize correctly', () => {
      const originalConfig = new BrvConfig(validConstructorArgs)
      const json = originalConfig.toJson()
      const deserializedConfig = BrvConfig.fromJson(json)

      expect(deserializedConfig.chatLogPath).to.equal(originalConfig.chatLogPath)
      expect(deserializedConfig.createdAt).to.equal(originalConfig.createdAt)
      expect(deserializedConfig.cwd).to.equal(originalConfig.cwd)
      expect(deserializedConfig.ide).to.equal(originalConfig.ide)
      expect(deserializedConfig.spaceId).to.equal(originalConfig.spaceId)
      expect(deserializedConfig.spaceName).to.equal(originalConfig.spaceName)
      expect(deserializedConfig.teamId).to.equal(originalConfig.teamId)
      expect(deserializedConfig.teamName).to.equal(originalConfig.teamName)
      expect(deserializedConfig.version).to.equal(originalConfig.version)
    })
  })

  describe('fromSpace', () => {
    it('should create config from Space entity with current version', () => {
      const space = new Space('space-789', 'my-space', 'team-abc', 'my-team')

      const config = BrvConfig.fromSpace({
        chatLogPath: '/path/to/logs',
        cwd: '/path/to/cwd',
        ide: 'Cursor',
        space,
      })

      expect(config.version).to.equal(BRV_CONFIG_VERSION)
      expect(config.spaceId).to.equal('space-789')
      expect(config.spaceName).to.equal('my-space')
      expect(config.teamId).to.equal('team-abc')
      expect(config.teamName).to.equal('my-team')
      expect(config.createdAt).to.be.a('string')
    })
  })
})
