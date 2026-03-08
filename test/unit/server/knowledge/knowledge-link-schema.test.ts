/**
 * Unit tests for knowledge-link-schema.ts
 *
 * Tests: Zod schema validation, loadKnowledgeLinks(), deriveSourceKey(),
 * getKnowledgeLinkStatuses(), and write-guard validateWriteTarget().
 */

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {validateWriteTarget} from '../../../../src/agent/infra/tools/write-guard.js'
import {
  deriveSourceKey,
  getKnowledgeLinkStatuses,
  KnowledgeLinksFileSchema,
  loadKnowledgeLinks,
} from '../../../../src/server/core/domain/knowledge/knowledge-link-schema.js'

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

function writeKnowledgeLinks(projectRoot: string, links: unknown): void {
  writeFileSync(
    join(projectRoot, '.brv', 'knowledge-links.json'),
    JSON.stringify(links, null, 2),
  )
}

// ============================================================================
// Tests
// ============================================================================

describe('knowledge-link-schema', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-kl-test-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  describe('KnowledgeLinksFileSchema', () => {
    it('should validate a correct schema', () => {
      const data = {
        links: [{addedAt: '2026-01-01', alias: 'shared-lib', projectRoot: '/path/to/lib', readOnly: true}],
        version: 1,
      }
      const result = KnowledgeLinksFileSchema.safeParse(data)
      expect(result.success).to.be.true
    })

    it('should reject version !== 1', () => {
      const data = {links: [], version: 2}
      const result = KnowledgeLinksFileSchema.safeParse(data)
      expect(result.success).to.be.false
    })

    it('should reject readOnly !== true', () => {
      const data = {
        links: [{addedAt: '2026-01-01', alias: 'lib', projectRoot: '/p', readOnly: false}],
        version: 1,
      }
      const result = KnowledgeLinksFileSchema.safeParse(data)
      expect(result.success).to.be.false
    })

    it('should reject empty alias', () => {
      const data = {
        links: [{addedAt: '2026-01-01', alias: '', projectRoot: '/p', readOnly: true}],
        version: 1,
      }
      const result = KnowledgeLinksFileSchema.safeParse(data)
      expect(result.success).to.be.false
    })
  })

  describe('deriveSourceKey', () => {
    it('should return a 12-char hex string', () => {
      const key = deriveSourceKey('/some/path')
      expect(key).to.match(/^[0-9a-f]{12}$/)
    })

    it('should be deterministic', () => {
      const key1 = deriveSourceKey('/same/path')
      const key2 = deriveSourceKey('/same/path')
      expect(key1).to.equal(key2)
    })

    it('should differ for different paths', () => {
      const key1 = deriveSourceKey('/path/a')
      const key2 = deriveSourceKey('/path/b')
      expect(key1).to.not.equal(key2)
    })
  })

  describe('loadKnowledgeLinks', () => {
    it('should return null when file does not exist', () => {
      createProject(testDir)
      const result = loadKnowledgeLinks(testDir)
      expect(result).to.be.null
    })

    it('should load valid links with sources for valid targets', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectA)
      createProjectWithContextTree(projectB)

      writeKnowledgeLinks(projectA, {
        links: [{addedAt: '2026-01-01', alias: 'project-b', projectRoot: projectB, readOnly: true}],
        version: 1,
      })

      const result = loadKnowledgeLinks(projectA)
      expect(result).to.not.be.null
      expect(result!.links).to.have.length(1)
      expect(result!.sources).to.have.length(1)
      expect(result!.sources[0].type).to.equal('linked')
      expect(result!.sources[0].alias).to.equal('project-b')
      expect(result!.sources[0].contextTreeRoot).to.include('.brv/context-tree')
    })

    it('should exclude broken links from sources but keep in links', () => {
      const projectA = join(testDir, 'project-a')
      createProjectWithContextTree(projectA)

      writeKnowledgeLinks(projectA, {
        links: [{addedAt: '2026-01-01', alias: 'missing', projectRoot: '/nonexistent/path', readOnly: true}],
        version: 1,
      })

      const result = loadKnowledgeLinks(projectA)
      expect(result).to.not.be.null
      expect(result!.links).to.have.length(1)
      expect(result!.sources).to.have.length(0)
    })

    it('should handle malformed JSON gracefully', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)
      writeFileSync(join(projectA, '.brv', 'knowledge-links.json'), 'not json')

      const result = loadKnowledgeLinks(projectA)
      expect(result).to.not.be.null
      expect(result!.links).to.have.length(0)
      expect(result!.sources).to.have.length(0)
    })

    it('should have mtime for cache invalidation', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)
      writeKnowledgeLinks(projectA, {links: [], version: 1})

      const result = loadKnowledgeLinks(projectA)
      expect(result).to.not.be.null
      expect(result!.mtime).to.be.a('number')
      expect(result!.mtime).to.be.greaterThan(0)
    })
  })

  describe('getKnowledgeLinkStatuses', () => {
    it('should report valid for existing project', () => {
      const projectB = join(testDir, 'project-b')
      createProject(projectB)

      const statuses = getKnowledgeLinkStatuses([
        {addedAt: '2026-01-01', alias: 'project-b', projectRoot: projectB, readOnly: true as const},
      ])

      expect(statuses).to.have.length(1)
      expect(statuses[0].valid).to.be.true
      expect(statuses[0].alias).to.equal('project-b')
    })

    it('should report invalid for missing project', () => {
      const statuses = getKnowledgeLinkStatuses([
        {addedAt: '2026-01-01', alias: 'gone', projectRoot: '/nonexistent', readOnly: true as const},
      ])

      expect(statuses).to.have.length(1)
      expect(statuses[0].valid).to.be.false
    })
  })

  describe('validateWriteTarget (write guard)', () => {
    it('should allow writes when no knowledge links exist', () => {
      const projectA = join(testDir, 'project-a')
      createProjectWithContextTree(projectA)
      const target = join(projectA, '.brv', 'context-tree', 'auth', 'jwt.md')

      const error = validateWriteTarget(target, projectA)
      expect(error).to.be.null
    })

    it('should block writes to a linked project context tree', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectA)
      createProjectWithContextTree(projectB)

      writeKnowledgeLinks(projectA, {
        links: [{addedAt: '2026-01-01', alias: 'shared', projectRoot: projectB, readOnly: true}],
        version: 1,
      })

      const target = join(projectB, '.brv', 'context-tree', 'auth', 'jwt.md')
      const error = validateWriteTarget(target, projectA)
      expect(error).to.not.be.null
      expect(error).to.include('read-only')
      expect(error).to.include('shared')
    })

    it('should allow writes to local context tree even with links', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProjectWithContextTree(projectA)
      createProjectWithContextTree(projectB)

      writeKnowledgeLinks(projectA, {
        links: [{addedAt: '2026-01-01', alias: 'shared', projectRoot: projectB, readOnly: true}],
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
