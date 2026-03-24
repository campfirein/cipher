/**
 * Unit tests for knowledge-link-operations.ts
 *
 * Tests: addKnowledgeLink, removeKnowledgeLink, listKnowledgeLinkStatuses,
 * detectCircularLink, alias deduplication.
 */

import {expect} from 'chai'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  addKnowledgeLink,
  detectCircularLink,
  listKnowledgeLinkStatuses,
  removeKnowledgeLink,
} from '../../../../src/server/core/domain/knowledge/knowledge-link-operations.js'

// ============================================================================
// Helpers
// ============================================================================

function createProject(dir: string): void {
  mkdirSync(join(dir, '.brv'), {recursive: true})
  writeFileSync(join(dir, '.brv', 'config.json'), JSON.stringify({version: '0.0.1'}))
}

function readKnowledgeLinks(projectRoot: string): {links: Array<{alias: string; projectRoot: string}>; version: number} {
  return JSON.parse(readFileSync(join(projectRoot, '.brv', 'knowledge-links.json'), 'utf8'))
}

// ============================================================================
// Tests
// ============================================================================

describe('knowledge-link-operations', () => {
  let testDir: string

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'brv-kl-ops-')))
  })

  afterEach(() => {
    rmSync(testDir, {force: true, recursive: true})
  })

  // ==========================================================================
  // addKnowledgeLink
  // ==========================================================================

  describe('addKnowledgeLink', () => {
    it('should add a knowledge link successfully', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      const result = addKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.true
      expect(result.message).to.include('project-b')

      const links = readKnowledgeLinks(projectA)
      expect(links.version).to.equal(1)
      expect(links.links).to.have.length(1)
      expect(links.links[0].alias).to.equal('project-b')
      expect(links.links[0].projectRoot).to.equal(projectB)
    })

    it('should use custom alias when provided', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      const result = addKnowledgeLink(projectA, projectB, 'shared')

      expect(result.success).to.be.true
      const links = readKnowledgeLinks(projectA)
      expect(links.links[0].alias).to.equal('shared')
    })

    it('should reject when local project has no .brv/', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      mkdirSync(projectA, {recursive: true})
      createProject(projectB)

      const result = addKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.false
      expect(result.message).to.include('no .brv/')
    })

    it('should reject when target does not exist', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)

      const result = addKnowledgeLink(projectA, '/nonexistent/path')

      expect(result.success).to.be.false
      expect(result.message).to.include('does not exist')
    })

    it('should reject when target is not a brv project', () => {
      const projectA = join(testDir, 'project-a')
      const notAProject = join(testDir, 'not-a-project')
      createProject(projectA)
      mkdirSync(notAProject, {recursive: true})

      const result = addKnowledgeLink(projectA, notAProject)

      expect(result.success).to.be.false
      expect(result.message).to.include('not a ByteRover project')
    })

    it('should reject self-linking', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)

      const result = addKnowledgeLink(projectA, projectA)

      expect(result.success).to.be.false
      expect(result.message).to.include('self')
    })

    it('should reject duplicate links', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      addKnowledgeLink(projectA, projectB)
      const result = addKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.false
      expect(result.message).to.include('Already linked')
    })

    it('should reject circular links', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      // B links to A
      addKnowledgeLink(projectB, projectA)

      // A tries to link to B — circular
      const result = addKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.false
      expect(result.message).to.include('Circular')
    })

    it('should auto-deduplicate aliases with suffix', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'lib')
      const projectC = join(testDir, 'other', 'lib')
      createProject(projectA)
      createProject(projectB)
      mkdirSync(join(testDir, 'other'), {recursive: true})
      createProject(projectC)

      addKnowledgeLink(projectA, projectB)
      const result = addKnowledgeLink(projectA, projectC)

      expect(result.success).to.be.true

      const links = readKnowledgeLinks(projectA)
      expect(links.links).to.have.length(2)
      expect(links.links[0].alias).to.equal('lib')
      expect(links.links[1].alias).to.equal('lib-2')
    })

    it('should add multiple links to different projects', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      const projectC = join(testDir, 'project-c')
      createProject(projectA)
      createProject(projectB)
      createProject(projectC)

      addKnowledgeLink(projectA, projectB)
      addKnowledgeLink(projectA, projectC)

      const links = readKnowledgeLinks(projectA)
      expect(links.links).to.have.length(2)
    })

    it('should refuse to add link when knowledge-links.json is malformed JSON', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      // Corrupt the file
      writeFileSync(join(projectA, '.brv', 'knowledge-links.json'), 'not json')

      const result = addKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.false
      expect(result.message).to.include('Malformed')
      expect(result.message).to.include('not valid JSON')
    })

    it('should refuse to add link when knowledge-links.json has invalid schema', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      // Write valid JSON but invalid schema
      writeFileSync(join(projectA, '.brv', 'knowledge-links.json'), JSON.stringify({version: 999}))

      const result = addKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.false
      expect(result.message).to.include('Malformed')
      expect(result.message).to.include('schema validation failed')
    })

    it('should reject empty alias', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      const result = addKnowledgeLink(projectA, projectB, '')

      expect(result.success).to.be.false
      expect(result.message).to.include('empty')
    })

    it('should reject whitespace-only alias', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      const result = addKnowledgeLink(projectA, projectB, '   ')

      expect(result.success).to.be.false
      expect(result.message).to.include('empty')
    })
  })

  // ==========================================================================
  // removeKnowledgeLink
  // ==========================================================================

  describe('removeKnowledgeLink', () => {
    it('should remove a link by alias', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      addKnowledgeLink(projectA, projectB, 'shared')

      const result = removeKnowledgeLink(projectA, 'shared')

      expect(result.success).to.be.true
      expect(result.message).to.include('shared')

      const links = readKnowledgeLinks(projectA)
      expect(links.links).to.have.length(0)
    })

    it('should remove a link by path', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      addKnowledgeLink(projectA, projectB)

      const result = removeKnowledgeLink(projectA, projectB)

      expect(result.success).to.be.true
      const links = readKnowledgeLinks(projectA)
      expect(links.links).to.have.length(0)
    })

    it('should return error when no links configured', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)

      const result = removeKnowledgeLink(projectA, 'nonexistent')

      expect(result.success).to.be.false
      expect(result.message).to.include('No knowledge links configured')
    })

    it('should return error when link not found', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      addKnowledgeLink(projectA, projectB)

      const result = removeKnowledgeLink(projectA, 'nonexistent')

      expect(result.success).to.be.false
      expect(result.message).to.include('No knowledge link found')
    })

    it('should refuse to remove when knowledge-links.json is malformed', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)

      writeFileSync(join(projectA, '.brv', 'knowledge-links.json'), 'not json')

      const result = removeKnowledgeLink(projectA, 'some-alias')

      expect(result.success).to.be.false
      expect(result.message).to.include('Malformed')
    })

    it('should preserve other links when removing one', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      const projectC = join(testDir, 'project-c')
      createProject(projectA)
      createProject(projectB)
      createProject(projectC)

      addKnowledgeLink(projectA, projectB)
      addKnowledgeLink(projectA, projectC)

      removeKnowledgeLink(projectA, 'project-b')

      const links = readKnowledgeLinks(projectA)
      expect(links.links).to.have.length(1)
      expect(links.links[0].alias).to.equal('project-c')
    })
  })

  // ==========================================================================
  // listKnowledgeLinkStatuses
  // ==========================================================================

  describe('listKnowledgeLinkStatuses', () => {
    it('should return empty statuses when no links', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)

      const result = listKnowledgeLinkStatuses(projectA)

      expect(result.error).to.be.undefined
      expect(result.statuses).to.have.length(0)
    })

    it('should return valid status for existing target with context tree', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)
      // Must have context-tree/ for link to be considered valid
      mkdirSync(join(projectB, '.brv', 'context-tree'), {recursive: true})

      addKnowledgeLink(projectA, projectB)

      const result = listKnowledgeLinkStatuses(projectA)

      expect(result.error).to.be.undefined
      expect(result.statuses).to.have.length(1)
      expect(result.statuses[0].alias).to.equal('project-b')
      expect(result.statuses[0].valid).to.be.true
    })

    it('should report broken status for missing target', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      addKnowledgeLink(projectA, projectB)

      // Remove project B
      rmSync(projectB, {force: true, recursive: true})

      const result = listKnowledgeLinkStatuses(projectA)

      expect(result.error).to.be.undefined
      expect(result.statuses).to.have.length(1)
      expect(result.statuses[0].valid).to.be.false
    })

    it('should return error for malformed JSON', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)
      writeFileSync(join(projectA, '.brv', 'knowledge-links.json'), 'not json')

      const result = listKnowledgeLinkStatuses(projectA)

      expect(result.error).to.include('Malformed')
      expect(result.error).to.include('not valid JSON')
      expect(result.statuses).to.have.length(0)
    })

    it('should return error for invalid schema', () => {
      const projectA = join(testDir, 'project-a')
      createProject(projectA)
      writeFileSync(join(projectA, '.brv', 'knowledge-links.json'), JSON.stringify({version: 999}))

      const result = listKnowledgeLinkStatuses(projectA)

      expect(result.error).to.include('Malformed')
      expect(result.error).to.include('schema validation failed')
      expect(result.statuses).to.have.length(0)
    })
  })

  // ==========================================================================
  // detectCircularLink
  // ==========================================================================

  describe('detectCircularLink', () => {
    it('should return false when no circular dependency', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      const result = detectCircularLink(projectA, projectB)

      expect(result).to.be.false
    })

    it('should detect direct circular link', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      // B already links to A
      addKnowledgeLink(projectB, projectA)

      const result = detectCircularLink(projectA, projectB)

      expect(result).to.be.true
    })

    it('should return false when target has no knowledge links', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      createProject(projectA)
      createProject(projectB)

      const result = detectCircularLink(projectA, projectB)

      expect(result).to.be.false
    })

    it('should NOT detect transitive circular links (v1 limitation)', () => {
      const projectA = join(testDir, 'project-a')
      const projectB = join(testDir, 'project-b')
      const projectC = join(testDir, 'project-c')
      createProject(projectA)
      createProject(projectB)
      createProject(projectC)

      // A -> B -> C, trying C -> A is NOT detected (transitive)
      addKnowledgeLink(projectA, projectB)
      addKnowledgeLink(projectB, projectC)

      const result = detectCircularLink(projectC, projectA)

      expect(result).to.be.false
    })
  })
})
