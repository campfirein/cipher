/* eslint-disable camelcase */
import {expect} from 'chai'

import {User} from '../../../../../src/server/core/domain/entities/user.js'

describe('User', () => {
  const validUserParams = {
    email: 'test@example.com',
    hasOnboardedCli: false,
    id: '123',
    name: 'Test User',
  }

  describe('constructor', () => {
    it('should create a user with all properties', () => {
      const user = new User(validUserParams)

      expect(user.id).to.equal('123')
      expect(user.email).to.equal('test@example.com')
      expect(user.name).to.equal('Test User')
      expect(user.hasOnboardedCli).to.equal(false)
    })
  })

  describe('toJson', () => {
    it('should serialize user to JSON', () => {
      const user = new User(validUserParams)
      const json = user.toJson()

      expect(json).to.deep.equal({
        email: 'test@example.com',
        hasOnboardedCli: false,
        id: '123',
        name: 'Test User',
      })
    })
  })

  describe('fromJson', () => {
    it('should deserialize user from JSON', () => {
      const json = {
        email: 'test@example.com',
        has_onboarded_cli: false,
        id: '123',
        name: 'Test User',
      }

      const user = User.fromJson(json)

      expect(user.id).to.equal('123')
      expect(user.email).to.equal('test@example.com')
      expect(user.name).to.equal('Test User')
      expect(user.hasOnboardedCli).to.equal(false)
    })
  })
})
