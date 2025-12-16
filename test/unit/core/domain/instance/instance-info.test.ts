import {expect} from 'chai'

import {InstanceInfo} from '../../../../../src/core/domain/instance/types.js'

describe('InstanceInfo', () => {
  describe('create', () => {
    it('should create an instance with required fields', () => {
      const instance = InstanceInfo.create({
        pid: 12_345,
        port: 9847,
      })

      expect(instance.pid).to.equal(12_345)
      expect(instance.port).to.equal(9847)
      expect(instance.currentSessionId).to.be.null
      expect(instance.startedAt).to.be.instanceOf(Date)
    })

    it('should create an instance with optional sessionId', () => {
      const instance = InstanceInfo.create({
        currentSessionId: 'session-123',
        pid: 12_345,
        port: 9847,
      })

      expect(instance.currentSessionId).to.equal('session-123')
    })
  })

  describe('fromJson / toJson', () => {
    it('should roundtrip correctly', () => {
      const original = InstanceInfo.create({
        currentSessionId: 'session-456',
        pid: 12_345,
        port: 9847,
      })

      const json = original.toJson()
      const restored = InstanceInfo.fromJson(json)

      expect(restored.pid).to.equal(original.pid)
      expect(restored.port).to.equal(original.port)
      expect(restored.currentSessionId).to.equal(original.currentSessionId)
      expect(restored.startedAt.getTime()).to.equal(original.startedAt.getTime())
    })

    it('should produce correct JSON structure', () => {
      const instance = InstanceInfo.create({
        currentSessionId: 'session-789',
        pid: 12_345,
        port: 9847,
      })

      const json = instance.toJson()

      expect(json).to.have.property('pid', 12_345)
      expect(json).to.have.property('port', 9847)
      expect(json).to.have.property('currentSessionId', 'session-789')
      expect(json).to.have.property('startedAt').that.is.a('number')
    })
  })

  describe('withSessionId', () => {
    it('should create instance with new session ID', () => {
      const instance = InstanceInfo.create({
        pid: 12_345,
        port: 9847,
      })

      const updated = instance.withSessionId('new-session')

      expect(updated.currentSessionId).to.equal('new-session')
      expect(updated.pid).to.equal(instance.pid)
      expect(updated.port).to.equal(instance.port)
      expect(updated.startedAt.getTime()).to.equal(instance.startedAt.getTime())
    })
  })

  describe('getTransportUrl', () => {
    it('should return correct URL', () => {
      const instance = InstanceInfo.create({
        pid: 12_345,
        port: 9847,
      })

      expect(instance.getTransportUrl()).to.equal('http://127.0.0.1:9847')
    })

    it('should work with different ports', () => {
      const instance = InstanceInfo.create({
        pid: 12_345,
        port: 55_555,
      })

      expect(instance.getTransportUrl()).to.equal('http://127.0.0.1:55555')
    })
  })
})
