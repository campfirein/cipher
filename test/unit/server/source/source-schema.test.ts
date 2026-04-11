/**
 * Unit tests for source-schema.ts
 *
 * Tests: Zod schema validation, loadSources(), deriveOriginKey(),
 * getSourceStatuses(), and write-guard validateWriteTarget().
 */

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {validateWriteTarget} from '../../../../src/agent/infra/tools/write-guard.js'
import {
  deriveOriginKey,
  getSourceStatuses,
  loadSources,
  SourcesFileSchema,
} from '../../../../src/server/core/domain/source/source-schema.js'

// ============================================================================
// Helpers
// ============================================================================

function createProject(dir: string): void {
  mkdirSync(join(dir, '.brv'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
}

function createProjectWithContextTree(dir: string): void {
  createProject(dir)
  mkdirSync(join(dir, '.brv', 'context-tree'), {recursive: true})
}

function writeSourcesFile(projectRoot: string, data: unknown): void {
  writeFileSync(
    join(projectRoot, '.brv', 'sources.json'),
    JSON.stringify(data, null, 2),
  )
}

// ============================================================================
// Tests
// ============================================================================

describe('source-schema', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-source-test-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('SourcesFileSchema', () => {
    it('should validate a correct schema', () => {
      const data = {
        sources: [{addedAt: '2026-01-01', alias: 'shared-lib', projectRoot: '/path/to/lib', readOnly: true}],
        version: 1,
      }
      const result = SourcesFileSchema.safeParse(data)
      expect(result.success).to.be.true
    })

    it('should reject version !== 1', () => {
      const data = {sources: [], version: 2}
      const result = SourcesFileSchema.safeParse(data)
      expect(result.success).to.be.false
    })

    it('should reject readOnly !== true', () => {
      const data = {
        sources: [{addedAt: '2026-01-01', alias: 'lib', projectRoot: '/p', readOnly: false}],
        version: 1,
      }
      const result = SourcesFileSchema.safeParse(data)
      expect(result.success).to.be.false
    })

    it('should reject empty alias', () => {
      const data = {
        sources: [{addedAt: '2026-01-01', alias: '', projectRoot: '/p', readOnly: true}],
        version: 1,
      }
      const result = SourcesFileSchema.safeParse(data)
      expect(result.success).to.be.false
    })
  })

  describe('deriveOriginKey', () => {
    it('should return a 12-char hex string', () => {
      const key = deriveOriginKey('/some/path')
      expect(key).to.match(/^[0-9a-f]{12}$/)
    })

    it('should be deterministic', () => {
      const key1 = deriveOriginKey('/same/path')
      const key2 = deriveOriginKey('/same/path')
      expect(key1).to.equal(key2)
    })

    it('should differ for different paths', () => {
      const key1 = deriveOriginKey('/path/a')
      const key2 = deriveOriginKey('/path/b')
      expect(key1).to.not.equal(key2)
    })
  })

  describe('loadSources', () => {
    it('should return null when file does not exist', () => {
      createProject(testDir)
      const result = loadSources(testDir)
      expect(result).to.be.null
    })

    it('should load valid sources with origins for valid targets', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectA)
      createProjectWithContextTree(projectB)

      writeSourcesFile(projectA, {
        sources: [{addedAt: '2026-01-01', alias: 'project-b', projectRoot: projectB, readOnly: true}],
        version: 1,
      })

      const result = loadSources(projectA)
      expect(result).to.not.be.null
      expect(result!.sources).to.have.length(1)
      expect(result!.origins).to.have.length(1)
      expect(result!.origins[0].origin).to.equal('shared')
      expect(result!.origins[0].alias).to.equal('project-b')
      expect(result!.origins[0].contextTreeRoot).to.include('.brv/context-tree')
    })

    it('should exclude broken sources from origins but keep in sources', () => {
      const projectA = join(testDir, 'project-a')
      createProjectWithContextTree(projectA)

      writeSourcesFile(projectA, {
        sources: [{addedAt: '2026-01-01', alias: 'missing', projectRoot: '/nonexistent/path', readOnly: true}],
        version: 1,
      })

      const result = loadSources(projectA)
      expect(result).to.not.be.null
      expect(result!.sources).to.have.length(1)
      expect(result!.origins).to.have.length(0)
    })

    it('should handle malformed JSON gracefully', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)
      writeFileSync(join(projectA, '.brv', 'sources.json'), 'not json')

      const result = loadSources(projectA)
      expect(result).to.not.be.null
      expect(result!.sources).to.have.length(0)
      expect(result!.origins).to.have.length(0)
    })

    it('should have mtime for cache invalidation', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)
      writeSourcesFile(projectA, {sources: [], version: 1})

      const result = loadSources(projectA)
      expect(result).to.not.be.null
      expect(result!.mtime).to.be.a('number')
      expect(result!.mtime).to.be.greaterThan(0)
    })
  })

  describe('getSourceStatuses', () => {
    it('should report valid for existing project with context tree', () => {
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectB)

      const statuses = getSourceStatuses([
        {addedAt: '2026-01-01', alias: 'project-b', projectRoot: projectB, readOnly: true as const},
      ])

      expect(statuses).to.have.length(1)
      expect(statuses[0].valid).to.be.true
      expect(statuses[0].alias).to.equal('project-b')
      expect(statuses[0].contextTreeSize).to.be.a('number')
    })

    it('should report invalid for project without context tree', () => {
      const projectB = join(testDir, 'project-b')
      createProject(projectB) // has .brv/config.json but no context-tree/

      const statuses = getSourceStatuses([
        {addedAt: '2026-01-01', alias: 'project-b', projectRoot: projectB, readOnly: true as const},
      ])

      expect(statuses).to.have.length(1)
      expect(statuses[0].valid).to.be.false
    })

    it('should report invalid for missing project', () => {
      const statuses = getSourceStatuses([
        {addedAt: '2026-01-01', alias: 'gone', projectRoot: '/nonexistent', readOnly: true as const},
      ])

      expect(statuses).to.have.length(1)
      expect(statuses[0].valid).to.be.false
    })
  })

  describe('validateWriteTarget (write guard)', () => {
    it('should allow writes when no sources exist', () => {
      const projectA = join(testDir, 'project-a')
      createProjectWithContextTree(projectA)
      const target = join(projectA, '.brv', 'context-tree', 'auth', 'jwt.md')

      const error = validateWriteTarget(target, projectA)
      expect(error).to.be.null
    })

    it('should block writes to a shared source context tree', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectA)
      createProjectWithContextTree(projectB)

      writeSourcesFile(projectA, {
        sources: [{addedAt: '2026-01-01', alias: 'shared', projectRoot: projectB, readOnly: true}],
        version: 1,
      })

      const target = join(projectB, '.brv', 'context-tree', 'auth', 'jwt.md')
      const error = validateWriteTarget(target, projectA)
      expect(error).to.not.be.null
      expect(error).to.include('read-only')
      expect(error).to.include('shared')
    })

    it('should allow writes to local context tree even with sources', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectA)
      createProjectWithContextTree(projectB)

      writeSourcesFile(projectA, {
        sources: [{addedAt: '2026-01-01', alias: 'shared', projectRoot: projectB, readOnly: true}],
        version: 1,
      })

      const target = join(projectA, '.brv', 'context-tree', 'auth', 'jwt.md')
      const error = validateWriteTarget(target, projectA)
      expect(error).to.be.null
    })

    it('should block writes outside the local context tree', () => {
      const projectA = join(testDir, 'project-a')
      createProjectWithContextTree(projectA)

      const target = join(projectA, 'notes.md')
      const error = validateWriteTarget(target, projectA)

      expect(error).to.not.be.null
      expect(error).to.include('outside the local context tree')
    })
  })
})
