/* eslint-disable camelcase */
import {expect} from 'chai'

import {Team} from '../../../../../src/server/core/domain/entities/team.js'

describe('Team', () => {
  const validTeamParams = {
    avatarUrl: 'https://example.com/avatar.png',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    description: 'A test team',
    displayName: 'Test Team',
    id: '123e4567-e89b-12d3-a456-426614174000',
    isActive: true,
    name: 'test-team',
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  }

  describe('constructor', () => {
    it('should create a team with all properties', () => {
      const team = new Team(validTeamParams)

      expect(team.id).to.equal(validTeamParams.id)
      expect(team.name).to.equal(validTeamParams.name)
      expect(team.displayName).to.equal(validTeamParams.displayName)
      expect(team.description).to.equal(validTeamParams.description)
      expect(team.avatarUrl).to.equal(validTeamParams.avatarUrl)
      expect(team.isActive).to.equal(validTeamParams.isActive)
      expect(team.createdAt).to.deep.equal(validTeamParams.createdAt)
      expect(team.updatedAt).to.deep.equal(validTeamParams.updatedAt)
    })

    it('should throw error when id is empty', () => {
      expect(() => new Team({...validTeamParams, id: ''}))
        .to.throw('Team ID cannot be empty')
    })

    it('should throw error when id is whitespace only', () => {
      expect(() => new Team({...validTeamParams, id: '   '}))
        .to.throw('Team ID cannot be empty')
    })

    it('should throw error when name is empty', () => {
      expect(() => new Team({...validTeamParams, name: ''}))
        .to.throw('Team name cannot be empty')
    })

    it('should throw error when name is whitespace only', () => {
      expect(() => new Team({...validTeamParams, name: '   '}))
        .to.throw('Team name cannot be empty')
    })

    it('should throw error when displayName is empty', () => {
      expect(() => new Team({...validTeamParams, displayName: ''}))
        .to.throw('Team display name cannot be empty')
    })

    it('should throw error when displayName is whitespace only', () => {
      expect(() => new Team({...validTeamParams, displayName: '   '}))
        .to.throw('Team display name cannot be empty')
    })
  })

  describe('fromJson', () => {
    it('should deserialize team from JSON with snake_case fields', () => {
      const json = {
        avatar_url: 'https://example.com/avatar.png',
        created_at: '2024-01-01T00:00:00Z',
        description: 'A test team',
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      const team = Team.fromJson(json)

      expect(team.id).to.equal(json.id)
      expect(team.name).to.equal(json.name)
      expect(team.displayName).to.equal(json.display_name)
      expect(team.description).to.equal(json.description)
      expect(team.avatarUrl).to.equal(json.avatar_url)
      expect(team.isActive).to.equal(json.is_active)
      expect(team.createdAt).to.deep.equal(new Date(json.created_at))
      expect(team.updatedAt).to.deep.equal(new Date(json.updated_at))
    })

    it('should handle optional description field', () => {
      const json = {
        avatar_url: 'https://example.com/avatar.png',
        created_at: '2024-01-01T00:00:00Z',
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      const team = Team.fromJson(json)

      expect(team.description).to.equal('')
    })

    it('should handle optional avatarUrl field', () => {
      const json = {
        created_at: '2024-01-01T00:00:00Z',
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      const team = Team.fromJson(json)

      expect(team.avatarUrl).to.equal('')
    })

    it('should throw TypeError when id is not a string', () => {
      const json = {
        created_at: '2024-01-01T00:00:00Z',
        display_name: 'Test Team',
        id: 123,
        is_active: true,
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      expect(() => Team.fromJson(json))
        .to.throw(TypeError, 'Team JSON must have a string id field')
    })

    it('should throw TypeError when name is not a string', () => {
      const json = {
        created_at: '2024-01-01T00:00:00Z',
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 123,
        updated_at: '2024-01-02T00:00:00Z',
      }

      expect(() => Team.fromJson(json))
        .to.throw(TypeError, 'Team JSON must have a string name field')
    })

    it('should throw TypeError when display_name is not a string', () => {
      const json = {
        created_at: '2024-01-01T00:00:00Z',
        display_name: 123,
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      expect(() => Team.fromJson(json))
        .to.throw(TypeError, 'Team JSON must have a string display_name field')
    })

    it('should throw TypeError when is_active is not a boolean', () => {
      const json = {
        created_at: '2024-01-01T00:00:00Z',
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: 'true',
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      expect(() => Team.fromJson(json))
        .to.throw(TypeError, 'Team JSON must have a boolean is_active field')
    })

    it('should throw TypeError when created_at is not a string', () => {
      const json = {
        created_at: 123,
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 'test-team',
        updated_at: '2024-01-02T00:00:00Z',
      }

      expect(() => Team.fromJson(json))
        .to.throw(TypeError, 'Team JSON must have a string created_at field')
    })

    it('should throw TypeError when updated_at is not a string', () => {
      const json = {
        created_at: '2024-01-01T00:00:00Z',
        display_name: 'Test Team',
        id: '123e4567-e89b-12d3-a456-426614174000',
        is_active: true,
        name: 'test-team',
        updated_at: 123,
      }

      expect(() => Team.fromJson(json))
        .to.throw(TypeError, 'Team JSON must have a string updated_at field')
    })
  })

  describe('toJson', () => {
    it('should serialize team to JSON with camelCase fields', () => {
      const team = new Team(validTeamParams)
      const json = team.toJson()

      expect(json).to.deep.equal({
        avatarUrl: validTeamParams.avatarUrl,
        createdAt: validTeamParams.createdAt.toISOString(),
        description: validTeamParams.description,
        displayName: validTeamParams.displayName,
        id: validTeamParams.id,
        isActive: validTeamParams.isActive,
        name: validTeamParams.name,
        updatedAt: validTeamParams.updatedAt.toISOString(),
      })
    })

    it('should serialize dates as ISO strings', () => {
      const team = new Team(validTeamParams)
      const json = team.toJson()

      expect(json.createdAt).to.equal('2024-01-01T00:00:00.000Z')
      expect(json.updatedAt).to.equal('2024-01-02T00:00:00.000Z')
    })
  })

  describe('getDisplayName', () => {
    it('should return the display name', () => {
      const team = new Team(validTeamParams)

      expect(team.getDisplayName()).to.equal('Test Team')
    })
  })
})
