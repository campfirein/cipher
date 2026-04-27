import {expect} from 'chai'

import {BRV_CONFIG_VERSION} from '../../../../../src/server/constants.js'
import {BrvConfig, BrvConfigParams} from '../../../../../src/server/core/domain/entities/brv-config.js'
import {Space} from '../../../../../src/server/core/domain/entities/space.js'

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

    it('should return config with empty version when version is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {version: _, ...jsonWithoutVersion} = validConstructorArgs
      const config = BrvConfig.fromJson(jsonWithoutVersion)

      expect(config.version).to.equal('')
      expect(config.spaceId).to.equal('space-123')
      expect(config.teamId).to.equal('team-456')
    })

    it('should preserve original version when mismatched', () => {
      const jsonWithOldVersion = {...validConstructorArgs, version: '0.0.0'}
      const config = BrvConfig.fromJson(jsonWithOldVersion)

      expect(config.version).to.equal('0.0.0')
      expect(config.spaceId).to.equal('space-123')
      expect(config.teamId).to.equal('team-456')
    })

    it('should throw Error when JSON structure is invalid (missing createdAt)', () => {
      const invalidJson = {spaceId: 'space-123', version: BRV_CONFIG_VERSION}

      expect(() => BrvConfig.fromJson(invalidJson)).to.throw('Invalid BrvConfig JSON structure')
    })

    it('should throw Error when JSON is not an object', () => {
      expect(() => BrvConfig.fromJson(null)).to.throw('BrvConfig JSON must be an object')
      expect(() => BrvConfig.fromJson('string')).to.throw('BrvConfig JSON must be an object')
      expect(() => BrvConfig.fromJson(123)).to.throw('BrvConfig JSON must be an object')
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

    it('should deserialize local-only config from JSON', () => {
      const json = {
        createdAt: '2025-01-01T00:00:00.000Z',
        cwd: '/path/to/project',
        version: BRV_CONFIG_VERSION,
      }
      const config = BrvConfig.fromJson(json)

      expect(config.version).to.equal(BRV_CONFIG_VERSION)
      expect(config.cwd).to.equal('/path/to/project')
      expect(config.spaceId).to.be.undefined
      expect(config.isCloudConnected()).to.be.false
    })
  })

  describe('createLocal', () => {
    it('should create local-only config with cwd and version', () => {
      const config = BrvConfig.createLocal({cwd: '/my/project'})

      expect(config.cwd).to.equal('/my/project')
      expect(config.version).to.equal(BRV_CONFIG_VERSION)
      expect(config.createdAt).to.be.a('string')
      expect(config.spaceId).to.be.undefined
      expect(config.spaceName).to.be.undefined
      expect(config.teamId).to.be.undefined
      expect(config.teamName).to.be.undefined
      expect(config.ide).to.be.undefined
      expect(config.chatLogPath).to.be.undefined
    })
  })

  describe('isCloudConnected', () => {
    it('should return true when all cloud fields are set', () => {
      const config = new BrvConfig(validConstructorArgs)
      expect(config.isCloudConnected()).to.be.true
    })

    it('should return false for local-only config', () => {
      const config = BrvConfig.createLocal({cwd: '/my/project'})
      expect(config.isCloudConnected()).to.be.false
    })

    it('should return false when some cloud fields are missing', () => {
      const config = new BrvConfig({
        createdAt: '2025-01-01T00:00:00.000Z',
        cwd: '/path/to/project',
        spaceId: 'space-123',
        version: BRV_CONFIG_VERSION,
      })
      expect(config.isCloudConnected()).to.be.false
    })
  })

  describe('withVersion', () => {
    it('should create new config with updated version preserving all fields', () => {
      const original = new BrvConfig(validConstructorArgs)
      const migrated = original.withVersion('9.9.9')

      expect(migrated.version).to.equal('9.9.9')
      expect(migrated.spaceId).to.equal(original.spaceId)
      expect(migrated.spaceName).to.equal(original.spaceName)
      expect(migrated.teamId).to.equal(original.teamId)
      expect(migrated.teamName).to.equal(original.teamName)
      expect(migrated.chatLogPath).to.equal(original.chatLogPath)
      expect(migrated.cwd).to.equal(original.cwd)
      expect(migrated.ide).to.equal(original.ide)
      expect(migrated.createdAt).to.equal(original.createdAt)
    })

    it('should not mutate the original config', () => {
      const original = new BrvConfig(validConstructorArgs)
      original.withVersion('9.9.9')

      expect(original.version).to.equal(BRV_CONFIG_VERSION)
    })
  })

  describe('withoutSpace', () => {
    it('should create new config with space fields cleared, preserving all other fields', () => {
      const original = new BrvConfig(validConstructorArgs)
      const cleared = original.withoutSpace()

      expect(cleared.spaceId).to.be.undefined
      expect(cleared.spaceName).to.be.undefined
      expect(cleared.teamId).to.be.undefined
      expect(cleared.teamName).to.be.undefined
      expect(cleared.chatLogPath).to.equal(original.chatLogPath)
      expect(cleared.cwd).to.equal(original.cwd)
      expect(cleared.ide).to.equal(original.ide)
      expect(cleared.createdAt).to.equal(original.createdAt)
      expect(cleared.version).to.equal(original.version)
    })

    it('should not mutate the original config', () => {
      const original = new BrvConfig(validConstructorArgs)
      original.withoutSpace()

      expect(original.spaceId).to.equal(validConstructorArgs.spaceId)
      expect(original.teamId).to.equal(validConstructorArgs.teamId)
    })

    it('should produce a config that is not cloud-connected', () => {
      const original = new BrvConfig(validConstructorArgs)
      expect(original.isCloudConnected()).to.be.true
      expect(original.withoutSpace().isCloudConnected()).to.be.false
    })

    it('should preserve non-space fields (cipherAgent fields) through withoutSpace', () => {
      const original = new BrvConfig({
        ...validConstructorArgs,
        cipherAgentContext: 'context-payload',
        cipherAgentModes: ['mode-a', 'mode-b'],
        cipherAgentSystemPrompt: 'system-prompt-text',
      })
      const cleared = original.withoutSpace()

      expect(cleared.cipherAgentContext).to.equal('context-payload')
      expect(cleared.cipherAgentModes).to.deep.equal(['mode-a', 'mode-b'])
      expect(cleared.cipherAgentSystemPrompt).to.equal('system-prompt-text')
    })
  })

  describe('fromSpace', () => {
    it('should create config from Space entity with current version', () => {
      const space = new Space({
        id: 'space-789',
        isDefault: false,
        name: 'my-space',
        teamId: 'team-abc',
        teamName: 'my-team',
      })

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
