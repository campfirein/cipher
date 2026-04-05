/* eslint-disable camelcase */
import {expect} from 'chai'

import {Space} from '../../../../../src/server/core/domain/entities/space.js'

describe('Space', () => {
  const validSpaceParams = {
    id: 'space-123',
    isDefault: false,
    name: 'test-space',
    teamId: 'team-456',
    teamName: 'test-team',
  }

  describe('constructor', () => {
    it('should create a space with slug and teamSlug when provided', () => {
      const space = new Space({...validSpaceParams, slug: 'test-space-slug', teamSlug: 'team-slug'})

      expect(space.slug).to.equal('test-space-slug')
      expect(space.teamSlug).to.equal('team-slug')
    })

    it('should fall back slug to name and teamSlug to teamName when not provided', () => {
      const space = new Space(validSpaceParams)

      expect(space.slug).to.equal('test-space')
      expect(space.teamSlug).to.equal('test-team')
    })

    it('should throw error when id is empty', () => {
      expect(() => new Space({...validSpaceParams, id: ''}))
        .to.throw('Space ID cannot be empty')
    })

    it('should throw error when name is empty', () => {
      expect(() => new Space({...validSpaceParams, name: ''}))
        .to.throw('Space name cannot be empty')
    })

    it('should throw error when teamId is empty', () => {
      expect(() => new Space({...validSpaceParams, teamId: ''}))
        .to.throw('Team ID cannot be empty')
    })

    it('should throw error when teamName is empty', () => {
      expect(() => new Space({...validSpaceParams, teamName: ''}))
        .to.throw('Team name cannot be empty')
    })
  })

  describe('fromJson', () => {
    it('should deserialize slug and team_slug from JSON when present', () => {
      const json = {
        id: 'space-123',
        is_default: false,
        name: 'my-space-v2.0',
        slug: 'my-space-v2-0',
        team_id: 'team-456',
        team_name: 'Test Release 2.0.0',
        team_slug: 'test-release-2-0-0',
      }

      const space = Space.fromJson(json)

      expect(space.slug).to.equal('my-space-v2-0')
      expect(space.teamSlug).to.equal('test-release-2-0-0')
      expect(space.name).to.equal('my-space-v2.0')
      expect(space.teamName).to.equal('Test Release 2.0.0')
    })

    it('should fall back to name and teamName when slug fields are missing from JSON', () => {
      const json = {
        id: 'space-123',
        is_default: false,
        name: 'test-space',
        team_id: 'team-456',
        team_name: 'test-team',
      }

      const space = Space.fromJson(json)

      expect(space.slug).to.equal('test-space')
      expect(space.teamSlug).to.equal('test-team')
    })
  })

  describe('toJson', () => {
    it('should include slug and teamSlug in serialized JSON', () => {
      const space = new Space({...validSpaceParams, slug: 'sp-slug', teamSlug: 'tm-slug'})
      const json = space.toJson()

      expect(json).to.deep.equal({
        id: 'space-123',
        isDefault: false,
        name: 'test-space',
        slug: 'sp-slug',
        teamId: 'team-456',
        teamName: 'test-team',
        teamSlug: 'tm-slug',
      })
    })
  })

  describe('getDisplayName', () => {
    it('should return teamName/name format', () => {
      const space = new Space(validSpaceParams)

      expect(space.getDisplayName()).to.equal('test-team/test-space')
    })
  })
})
