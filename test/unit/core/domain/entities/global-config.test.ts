import {expect} from 'chai'

import {GLOBAL_CONFIG_VERSION} from '../../../../../src/server/constants.js'
import {GlobalConfig} from '../../../../../src/server/core/domain/entities/global-config.js'

describe('GlobalConfig', () => {
  const validDeviceId = '550e8400-e29b-41d4-a716-446655440000'

  describe('create()', () => {
    it('should create a GlobalConfig with the given deviceId and current version', () => {
      const config = GlobalConfig.create(validDeviceId)

      expect(config.deviceId).to.equal(validDeviceId)
      expect(config.version).to.equal(GLOBAL_CONFIG_VERSION)
    })

    it('should throw an error when deviceId is empty', () => {
      expect(() => GlobalConfig.create('')).to.throw('Device ID cannot be empty')
    })

    it('should throw an error when deviceId is only whitespace', () => {
      expect(() => GlobalConfig.create('   ')).to.throw('Device ID cannot be empty')
    })
  })

  describe('fromJson()', () => {
    it('should deserialize valid JSON', () => {
      const json = {
        deviceId: validDeviceId,
        version: '0.0.1',
      }

      const config = GlobalConfig.fromJson(json)

      expect(config).to.not.be.undefined
      expect(config?.deviceId).to.equal(validDeviceId)
      expect(config?.version).to.equal('0.0.1')
    })

    it('should return undefined for null', () => {
      const config = GlobalConfig.fromJson(null)

      expect(config).to.be.undefined
    })

    it('should return undefined for non-object', () => {
      expect(GlobalConfig.fromJson('string')).to.be.undefined
      expect(GlobalConfig.fromJson(123)).to.be.undefined
      expect(GlobalConfig.fromJson(true)).to.be.undefined
      expect(GlobalConfig.fromJson([])).to.be.undefined
    })

    it('should return undefined when deviceId is missing', () => {
      const json = {version: '0.0.1'}

      const config = GlobalConfig.fromJson(json)

      expect(config).to.be.undefined
    })

    it('should return undefined when deviceId is empty', () => {
      const json = {
        deviceId: '',
        version: '0.0.1',
      }

      const config = GlobalConfig.fromJson(json)

      expect(config).to.be.undefined
    })

    it('should return undefined when deviceId is only whitespace', () => {
      const json = {
        deviceId: '   ',
        version: '0.0.1',
      }

      const config = GlobalConfig.fromJson(json)

      expect(config).to.be.undefined
    })

    it('should return undefined when version is missing', () => {
      const json = {deviceId: validDeviceId}

      const config = GlobalConfig.fromJson(json)

      expect(config).to.be.undefined
    })

    it('should return undefined when deviceId is not a string', () => {
      const json = {
        deviceId: 123,
        version: '0.0.1',
      }

      const config = GlobalConfig.fromJson(json)

      expect(config).to.be.undefined
    })

    it('should return undefined when version is not a string', () => {
      const json = {
        deviceId: validDeviceId,
        version: 1,
      }

      const config = GlobalConfig.fromJson(json)

      expect(config).to.be.undefined
    })
  })

  describe('toJson()', () => {
    it('should serialize to JSON correctly', () => {
      const config = GlobalConfig.create(validDeviceId)
      const json = config.toJson()

      expect(json).to.deep.equal({
        deviceId: validDeviceId,
        version: GLOBAL_CONFIG_VERSION,
      })
    })

    it('should roundtrip through fromJson', () => {
      const original = GlobalConfig.create(validDeviceId)
      const json = original.toJson()
      const restored = GlobalConfig.fromJson(json)

      expect(restored).to.not.be.undefined
      expect(restored?.deviceId).to.equal(original.deviceId)
      expect(restored?.version).to.equal(original.version)
    })
  })

  describe('immutability', () => {
    it('should have readonly properties', () => {
      const config = GlobalConfig.create(validDeviceId)

      // TypeScript prevents this at compile time, but we verify the values don't change
      expect(config.deviceId).to.equal(validDeviceId)
      expect(config.version).to.equal(GLOBAL_CONFIG_VERSION)
    })
  })
})
