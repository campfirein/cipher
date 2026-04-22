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
      expect(user.avatarUrl).to.equal(undefined)
    })

    it('should accept an optional avatarUrl', () => {
      const user = new User({...validUserParams, avatarUrl: 'https://cdn.example.com/a.png'})
      expect(user.avatarUrl).to.equal('https://cdn.example.com/a.png')
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

    it('should include avatarUrl when present', () => {
      const user = new User({...validUserParams, avatarUrl: 'https://cdn.example.com/a.png'})
      expect(user.toJson()).to.deep.equal({
        avatarUrl: 'https://cdn.example.com/a.png',
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
      expect(user.avatarUrl).to.equal(undefined)
    })

    it('should deserialize avatar_url into avatarUrl', () => {
      const json = {
        avatar_url: 'https://cdn.example.com/a.png',
        email: 'test@example.com',
        has_onboarded_cli: false,
        id: '123',
        name: 'Test User',
      }

      const user = User.fromJson(json)

      expect(user.avatarUrl).to.equal('https://cdn.example.com/a.png')
    })

    it('should leave avatarUrl undefined when avatar_url is not a string', () => {
      const json = {
        avatar_url: 42,
        email: 'test@example.com',
        has_onboarded_cli: false,
        id: '123',
        name: 'Test User',
      }

      const user = User.fromJson(json)

      expect(user.avatarUrl).to.equal(undefined)
    })
  })
})
