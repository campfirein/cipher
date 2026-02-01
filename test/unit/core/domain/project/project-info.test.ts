import {expect} from 'chai'

import {
  isValidProjectInfoJson,
  ProjectInfo,
  type ProjectInfoJson,
} from '../../../../../src/server/core/domain/project/project-info.js'

describe('ProjectInfo', () => {
  const validArgs = {
    projectPath: '/Users/john/app',
    registeredAt: 1_700_000_000_000,
    sanitizedPath: 'Users--john--app',
    storagePath: '/home/john/.local/share/brv/projects/Users--john--app',
  }

  describe('constructor', () => {
    it('should create a valid entity with all fields readonly', () => {
      const info = new ProjectInfo(
        validArgs.projectPath,
        validArgs.sanitizedPath,
        validArgs.storagePath,
        validArgs.registeredAt,
      )

      expect(info.projectPath).to.equal(validArgs.projectPath)
      expect(info.sanitizedPath).to.equal(validArgs.sanitizedPath)
      expect(info.storagePath).to.equal(validArgs.storagePath)
      expect(info.registeredAt).to.equal(validArgs.registeredAt)
    })

    it('should throw on empty projectPath', () => {
      expect(() => new ProjectInfo('', validArgs.sanitizedPath, validArgs.storagePath, validArgs.registeredAt))
        .to.throw('ProjectInfo projectPath cannot be empty')
    })

    it('should throw on whitespace-only projectPath', () => {
      expect(() => new ProjectInfo('   ', validArgs.sanitizedPath, validArgs.storagePath, validArgs.registeredAt))
        .to.throw('ProjectInfo projectPath cannot be empty')
    })

    it('should throw on empty sanitizedPath', () => {
      expect(() => new ProjectInfo(validArgs.projectPath, '', validArgs.storagePath, validArgs.registeredAt))
        .to.throw('ProjectInfo sanitizedPath cannot be empty')
    })

    it('should throw on empty storagePath', () => {
      expect(() => new ProjectInfo(validArgs.projectPath, validArgs.sanitizedPath, '', validArgs.registeredAt))
        .to.throw('ProjectInfo storagePath cannot be empty')
    })

    it('should throw on registeredAt <= 0', () => {
      expect(() => new ProjectInfo(validArgs.projectPath, validArgs.sanitizedPath, validArgs.storagePath, 0))
        .to.throw('ProjectInfo registeredAt must be a positive number')
    })

    it('should throw on negative registeredAt', () => {
      expect(() => new ProjectInfo(validArgs.projectPath, validArgs.sanitizedPath, validArgs.storagePath, -1))
        .to.throw('ProjectInfo registeredAt must be a positive number')
    })
  })

  describe('toJson()', () => {
    it('should return correct JSON shape', () => {
      const info = new ProjectInfo(
        validArgs.projectPath,
        validArgs.sanitizedPath,
        validArgs.storagePath,
        validArgs.registeredAt,
      )

      const json = info.toJson()

      expect(json).to.deep.equal({
        projectPath: validArgs.projectPath,
        registeredAt: validArgs.registeredAt,
        sanitizedPath: validArgs.sanitizedPath,
        storagePath: validArgs.storagePath,
      })
    })
  })

  describe('fromJson()', () => {
    it('should round-trip correctly: fromJson(info.toJson()) equals original', () => {
      const original = new ProjectInfo(
        validArgs.projectPath,
        validArgs.sanitizedPath,
        validArgs.storagePath,
        validArgs.registeredAt,
      )

      const restored = ProjectInfo.fromJson(original.toJson())

      expect(restored.projectPath).to.equal(original.projectPath)
      expect(restored.sanitizedPath).to.equal(original.sanitizedPath)
      expect(restored.storagePath).to.equal(original.storagePath)
      expect(restored.registeredAt).to.equal(original.registeredAt)
    })

    it('should create entity from valid JSON', () => {
      const json: ProjectInfoJson = {
        projectPath: '/Users/jane/project',
        registeredAt: 1_700_000_000_000,
        sanitizedPath: 'Users--jane--project',
        storagePath: '/home/jane/.local/share/brv/projects/Users--jane--project',
      }

      const info = ProjectInfo.fromJson(json)

      expect(info.projectPath).to.equal(json.projectPath)
      expect(info.registeredAt).to.equal(json.registeredAt)
    })

    it('should throw on invalid JSON (empty projectPath)', () => {
      const json: ProjectInfoJson = {
        projectPath: '',
        registeredAt: 1_700_000_000_000,
        sanitizedPath: 'foo',
        storagePath: '/bar',
      }

      expect(() => ProjectInfo.fromJson(json)).to.throw('projectPath cannot be empty')
    })
  })

  describe('isValidProjectInfoJson()', () => {
    it('should return true for valid ProjectInfoJson', () => {
      const json = {
        projectPath: '/Users/john/app',
        registeredAt: 1_700_000_000_000,
        sanitizedPath: 'Users--john--app',
        storagePath: '/home/john/.local/share/brv/projects/Users--john--app',
      }

      expect(isValidProjectInfoJson(json)).to.be.true
    })

    it('should return false for null', () => {
      expect(isValidProjectInfoJson(null)).to.be.false
    })

    it('should return false for non-object', () => {
      expect(isValidProjectInfoJson('string')).to.be.false
      expect(isValidProjectInfoJson(42)).to.be.false
    })

    it('should return false when projectPath is missing', () => {
      const json = {
        registeredAt: 1_700_000_000_000,
        sanitizedPath: 'foo',
        storagePath: '/bar',
      }

      expect(isValidProjectInfoJson(json)).to.be.false
    })

    it('should return false when projectPath is wrong type', () => {
      const json = {
        projectPath: 42,
        registeredAt: 1_700_000_000_000,
        sanitizedPath: 'foo',
        storagePath: '/bar',
      }

      expect(isValidProjectInfoJson(json)).to.be.false
    })

    it('should return false when registeredAt is missing', () => {
      const json = {
        projectPath: '/app',
        sanitizedPath: 'foo',
        storagePath: '/bar',
      }

      expect(isValidProjectInfoJson(json)).to.be.false
    })

    it('should return false when registeredAt is wrong type', () => {
      const json = {
        projectPath: '/app',
        registeredAt: 'not-a-number',
        sanitizedPath: 'foo',
        storagePath: '/bar',
      }

      expect(isValidProjectInfoJson(json)).to.be.false
    })

    it('should return false when sanitizedPath is missing', () => {
      const json = {
        projectPath: '/app',
        registeredAt: 1_700_000_000_000,
        storagePath: '/bar',
      }

      expect(isValidProjectInfoJson(json)).to.be.false
    })

    it('should return false when storagePath is missing', () => {
      const json = {
        projectPath: '/app',
        registeredAt: 1_700_000_000_000,
        sanitizedPath: 'foo',
      }

      expect(isValidProjectInfoJson(json)).to.be.false
    })
  })
})
