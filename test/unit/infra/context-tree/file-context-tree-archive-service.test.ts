import {expect} from 'chai'
import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {ARCHIVE_DIR, BRV_DIR, CONTEXT_TREE_DIR} from '../../../../src/server/constants.js'
import {FileContextTreeArchiveService} from '../../../../src/server/infra/context-tree/file-context-tree-archive-service.js'
import {parseArchiveStubFrontmatter} from '../../../../src/server/infra/context-tree/summary-frontmatter.js'

function createMockAgent(ghostCue = 'A brief ghost cue for the archived content.'): ICipherAgent {
  return {
    async cancel() {},
    async createTaskSession() { return 'mock-session-id' },
    async deleteSandboxVariable() {},
    async deleteSandboxVariableOnSession() {},
    async deleteSession() {},
    async deleteTaskSession() {},
    async execute() { return ghostCue },
    async executeOnSession() { return ghostCue },
    async generate() { return ghostCue },
    async getSessionMetadata() { /* returns undefined */ },
    getState() { return 'idle' },
    async listPersistedSessions() { return [] },
    async reset() {},
    async setSandboxVariable() {},
    async setSandboxVariableOnSession() {},
    async start() {},
    async * stream() { yield ghostCue },
  } as unknown as ICipherAgent
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)

    return true
  } catch {
    return false
  }
}

describe('FileContextTreeArchiveService', () => {
  let testDir: string
  let contextTreeDir: string
  let service: FileContextTreeArchiveService
  let mockAgent: ICipherAgent

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-archive-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})
    service = new FileContextTreeArchiveService()
    mockAgent = createMockAgent()
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('archiveEntry', () => {
    it('should create .stub.md and .full.md in _archived/', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 20\nmaturity: draft\n---\n# Tokens\nContent here.')

      const result = await service.archiveEntry('auth/tokens.md', mockAgent, testDir)

      expect(result.originalPath).to.equal('auth/tokens.md')
      expect(result.stubPath).to.include('_archived/auth/tokens.stub.md')
      expect(result.fullPath).to.include('_archived/auth/tokens.full.md')

      // Verify .full.md exists and contains original content
      const fullContent = await readFile(join(contextTreeDir, result.fullPath), 'utf8')
      expect(fullContent).to.include('# Tokens')

      // Verify .stub.md exists and has frontmatter
      const stubContent = await readFile(join(contextTreeDir, result.stubPath), 'utf8')
      const fm = parseArchiveStubFrontmatter(stubContent)
      expect(fm).to.not.be.null
      expect(fm!.type).to.equal('archive_stub')
      expect(fm!.original_path).to.equal('auth/tokens.md')
      expect(fm!.points_to).to.include('_archived/auth/tokens.full.md')
    })

    it('should delete the original file', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      const originalPath = join(domainDir, 'tokens.md')
      await writeFile(originalPath, '# Tokens')

      await service.archiveEntry('auth/tokens.md', mockAgent, testDir)

      expect(await fileExists(originalPath)).to.be.false
    })

    it('should preserve relative path structure in archive', async () => {
      const topicDir = join(contextTreeDir, 'api', 'endpoints')
      await mkdir(topicDir, {recursive: true})
      await writeFile(join(topicDir, 'legacy-v1.md'), '# Legacy V1 API')

      const result = await service.archiveEntry('api/endpoints/legacy-v1.md', mockAgent, testDir)
      expect(result.stubPath).to.equal('_archived/api/endpoints/legacy-v1.stub.md')
      expect(result.fullPath).to.equal('_archived/api/endpoints/legacy-v1.full.md')

      // Verify the nested directory structure was created
      expect(await fileExists(join(contextTreeDir, ARCHIVE_DIR, 'api', 'endpoints', 'legacy-v1.stub.md'))).to.be.true
    })

    it('captures importance from the runtime-signal sidecar in the archive stub', async () => {
      // Post-migration: evicted_importance is read from the sidecar, not
      // markdown. Seed the sidecar with a known value, then assert the stub
      // preserves it.
      const {createMockRuntimeSignalStore} = await import('../../../helpers/mock-factories.js')
      const signalStore = createMockRuntimeSignalStore()
      await signalStore.set('auth/tokens.md', {
        accessCount: 0,
        importance: 25,
        maturity: 'draft',
        recency: 1,
        updateCount: 0,
      })
      const scopedService = new FileContextTreeArchiveService(signalStore)

      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await scopedService.archiveEntry('auth/tokens.md', mockAgent, testDir)

      const stubContent = await readFile(join(contextTreeDir, ARCHIVE_DIR, 'auth', 'tokens.stub.md'), 'utf8')
      const fm = parseArchiveStubFrontmatter(stubContent)
      expect(fm!.evicted_importance).to.equal(25)
    })

    it('should use deterministic fallback when LLM fails', async () => {
      const failAgent = createMockAgent('')
      failAgent.createTaskSession = async () => { throw new Error('LLM down') }

      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens\nSome content here for truncation testing purposes.')

      const result = await service.archiveEntry('auth/tokens.md', failAgent, testDir)
      // Should still succeed (fail-open)
      expect(result.stubPath).to.include('.stub.md')

      const stubContent = await readFile(join(contextTreeDir, result.stubPath), 'utf8')
      // Ghost cue should be deterministic truncation (ends with ...)
      expect(stubContent).to.include('...')
    })
  })

  describe('drillDown', () => {
    it('should return full content from .full.md', async () => {
      // Set up archive files
      const archiveDir = join(contextTreeDir, ARCHIVE_DIR, 'auth')
      await mkdir(archiveDir, {recursive: true})
      await writeFile(join(archiveDir, 'tokens.full.md'), '# Tokens\nFull original content.')
      await writeFile(
        join(archiveDir, 'tokens.stub.md'),
        '---\ntype: archive_stub\noriginal_path: auth/tokens.md\npoints_to: _archived/auth/tokens.full.md\noriginal_token_count: 100\nevicted_at: "2026-03-01T00:00:00.000Z"\nevicted_importance: 25\n---\nGhost cue.',
      )

      const result = await service.drillDown('_archived/auth/tokens.stub.md', testDir)
      expect(result.fullContent).to.include('# Tokens')
      expect(result.fullContent).to.include('Full original content.')
      expect(result.originalPath).to.equal('auth/tokens.md')
      expect(result.tokenCount).to.be.greaterThan(0)
    })

    it('should throw for invalid stub', async () => {
      const archiveDir = join(contextTreeDir, ARCHIVE_DIR, 'auth')
      await mkdir(archiveDir, {recursive: true})
      await writeFile(join(archiveDir, 'bad.stub.md'), 'No frontmatter here')

      try {
        await service.drillDown('_archived/auth/bad.stub.md', testDir)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('Invalid archive stub')
      }
    })
  })

  describe('restoreEntry', () => {
    it('should restore file to original location', async () => {
      // First archive a file
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      const originalContent = '# Tokens\nOriginal content for restoration.'
      await writeFile(join(domainDir, 'tokens.md'), originalContent)

      const archiveResult = await service.archiveEntry('auth/tokens.md', mockAgent, testDir)

      // Restore it
      const restoredPath = await service.restoreEntry(archiveResult.stubPath, testDir)
      expect(restoredPath).to.equal('auth/tokens.md')

      // Verify restored content matches original
      const restoredContent = await readFile(join(contextTreeDir, 'auth', 'tokens.md'), 'utf8')
      expect(restoredContent).to.equal(originalContent)
    })

    it('should remove stub and full archive files', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      const archiveResult = await service.archiveEntry('auth/tokens.md', mockAgent, testDir)

      await service.restoreEntry(archiveResult.stubPath, testDir)

      // Stub and full should be gone
      expect(await fileExists(join(contextTreeDir, archiveResult.stubPath))).to.be.false
      expect(await fileExists(join(contextTreeDir, archiveResult.fullPath))).to.be.false
    })

    it('should throw for invalid stub', async () => {
      const archiveDir = join(contextTreeDir, ARCHIVE_DIR)
      await mkdir(archiveDir, {recursive: true})
      await writeFile(join(archiveDir, 'bad.stub.md'), 'No frontmatter')

      try {
        await service.restoreEntry('_archived/bad.stub.md', testDir)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).to.include('Invalid archive stub')
      }
    })
  })

  describe('findArchiveCandidates', () => {
    it('should return empty array for empty context tree', async () => {
      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.deep.equal([])
    })

    it('should not include core maturity files', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 10\nmaturity: core\n---\n# Tokens')

      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.not.include('auth/tokens.md')
    })

    it('should not include validated maturity files', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 10\nmaturity: validated\n---\n# Tokens')

      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.not.include('auth/tokens.md')
    })

    it('should include draft files below importance threshold', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'old-notes.md'), '---\nimportance: 10\nmaturity: draft\nupdatedAt: "2025-01-01T00:00:00.000Z"\n---\n# Old Notes')

      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.include('auth/old-notes.md')
    })

    it('should not include draft files above importance threshold', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'important.md'), '---\nimportance: 80\nmaturity: draft\n---\n# Important')

      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.not.include('auth/important.md')
    })

    it('should skip _archived/ directory', async () => {
      const archiveDir = join(contextTreeDir, ARCHIVE_DIR, 'auth')
      await mkdir(archiveDir, {recursive: true})
      await writeFile(join(archiveDir, 'old.stub.md'), '---\nimportance: 5\nmaturity: draft\n---\nGhost cue')

      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.deep.equal([])
    })

    it('should skip _index.md files', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, '_index.md'), '---\ntype: summary\ncondensation_order: 2\nimportance: 5\nmaturity: draft\n---\nSummary')

      const candidates = await service.findArchiveCandidates(testDir)
      expect(candidates).to.not.include('auth/_index.md')
    })
  })
})
