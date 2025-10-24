import {expect} from 'chai'

import {User} from '../../../../../src/core/domain/entities/user.js'

describe('User', () => {
  describe('constructor', () => {
    it('should create a user with all properties', () => {
      const user = new User('test@example.com', '123', 'Test User')

      expect(user.id).to.equal('123')
      expect(user.email).to.equal('test@example.com')
      expect(user.name).to.equal('Test User')
    })
  })

  describe('toJSON', () => {
    it('should serialize user to JSON', () => {
      const user = new User('test@example.com', '123', 'Test User')
      const json = user.toJson()

      expect(json).to.deep.equal({
        email: 'test@example.com',
        id: '123',
        name: 'Test User',
      })
    })
  })

  describe('fromJSON', () => {
    it('should deserialize user from JSON', () => {
      const json = {
        email: 'test@example.com',
        id: '123',
        name: 'Test User',
      }

      const user = User.fromJson(json)

      expect(user.id).to.equal('123')
      expect(user.email).to.equal('test@example.com')
      expect(user.name).to.equal('Test User')
    })
  })
})
