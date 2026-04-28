import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'

import {BRV_DIR, CONTEXT_TREE_DIR, SUMMARY_INDEX_FILE} from '../../../../src/server/constants.js'
import {FileContextTreeSummaryService} from '../../../../src/server/infra/context-tree/file-context-tree-summary-service.js'
import {parseSummaryFrontmatter} from '../../../../src/server/infra/context-tree/summary-frontmatter.js'

function createMockAgent(response = 'A concise summary of the content.'): ICipherAgent {
  return {
    async cancel() {},
    async createTaskSession() { return 'mock-session-id' },
    async deleteSandboxVariable() {},
    async deleteSandboxVariableOnSession() {},
    async deleteSession() {},
    async deleteTaskSession() {},
    async execute() { return response },
    async executeOnSession() { return response },
    async generate() { return response },
    async getSessionMetadata() { /* returns undefined */ },
    getState() { return 'idle' },
    async listPersistedSessions() { return [] },
    async reset() {},
    async setSandboxVariable() {},
    async setSandboxVariableOnSession() {},
    async start() {},
    async * stream() { yield response },
  } as unknown as ICipherAgent
}

describe('FileContextTreeSummaryService', () => {
  let testDir: string
  let contextTreeDir: string
  let service: FileContextTreeSummaryService
  let mockAgent: ICipherAgent

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-summary-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})
    service = new FileContextTreeSummaryService()
    mockAgent = createMockAgent()
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('hasSummary', () => {
    it('should return false when no _index.md exists', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})

      const result = await service.hasSummary('auth', testDir)
      expect(result).to.be.false
    })

    it('should return true when _index.md exists', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, SUMMARY_INDEX_FILE), '---\ntype: summary\ncondensation_order: 2\n---\nSummary')

      const result = await service.hasSummary('auth', testDir)
      expect(result).to.be.true
    })
  })

  describe('generateSummary', () => {
    it('should return empty_directory for directory with no children', async () => {
      const domainDir = join(contextTreeDir, 'empty')
      await mkdir(domainDir, {recursive: true})

      const result = await service.generateSummary('empty', mockAgent, testDir)
      expect(result.actionTaken).to.be.false
      expect(result.reason).to.equal('empty_directory')
      expect(result.path).to.equal('empty')
    })

    it('should generate _index.md from leaf .md files', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'jwt-tokens.md'), '# JWT Tokens\nHow tokens work.')
      await writeFile(join(domainDir, 'oauth.md'), '# OAuth\nOAuth flow details.')

      const result = await service.generateSummary('auth', mockAgent, testDir)
      expect(result.actionTaken).to.be.true
      expect(result.path).to.equal('auth')
      expect(result.tokenCount).to.be.greaterThan(0)

      // Verify _index.md was created
      const indexContent = await readFile(join(domainDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm).to.not.be.null
      expect(fm!.type).to.equal('summary')
      expect(fm!.condensation_order).to.equal(2) // depth 1 = order 2
      expect(fm!.covers).to.include('jwt-tokens.md')
      expect(fm!.covers).to.include('oauth.md')
    })

    it('should include child _index.md in summary inputs', async () => {
      // Create a child directory with its own _index.md
      const domainDir = join(contextTreeDir, 'auth')
      const topicDir = join(domainDir, 'jwt')
      await mkdir(topicDir, {recursive: true})
      await writeFile(join(topicDir, SUMMARY_INDEX_FILE), '---\ntype: summary\ncondensation_order: 1\n---\nJWT summary')

      const result = await service.generateSummary('auth', mockAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(domainDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm!.covers).to.include(`jwt/${SUMMARY_INDEX_FILE}`)
    })

    it('should skip _index.md itself as a leaf input', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, SUMMARY_INDEX_FILE), '---\ntype: summary\ncondensation_order: 2\n---\nOld summary')
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens\nDetails.')

      const result = await service.generateSummary('auth', mockAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(domainDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm!.covers).to.not.include(SUMMARY_INDEX_FILE)
      expect(fm!.covers).to.include('tokens.md')
    })

    it('should skip _archived/ directory', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      const archivedDir = join(domainDir, '_archived')
      await mkdir(archivedDir, {recursive: true})
      await writeFile(join(archivedDir, 'old.stub.md'), 'Ghost cue')
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      const result = await service.generateSummary('auth', mockAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(domainDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm!.covers).to.have.lengthOf(1)
      expect(fm!.covers).to.include('tokens.md')
    })

    it('should set condensation_order 3 for root directory', async () => {
      await writeFile(join(contextTreeDir, 'overview.md'), '# Overview')

      const result = await service.generateSummary('.', mockAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(contextTreeDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm!.condensation_order).to.equal(3)
      expect(fm!.summary_level).to.equal('d3')
    })

    it('should set condensation_order 0 for deeply nested directories', async () => {
      const deepDir = join(contextTreeDir, 'a', 'b', 'c')
      await mkdir(deepDir, {recursive: true})
      await writeFile(join(deepDir, 'leaf.md'), '# Leaf')

      const result = await service.generateSummary('a/b/c', mockAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(deepDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm!.condensation_order).to.equal(0)
      expect(fm!.summary_level).to.equal('d0')
    })

    it('should fall back to a deterministic summary when LLM generation fails', async () => {
      const failAgent = createMockAgent('')
      failAgent.createTaskSession = async () => { throw new Error('LLM down') }

      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      const result = await service.generateSummary('auth', failAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(domainDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm).to.not.be.null
      expect(indexContent.length).to.be.greaterThan(0)
    })

    it('should still write _index.md when task-session cleanup fails after generation', async () => {
      const cleanupFailAgent = createMockAgent('A concise summary of the content.')
      cleanupFailAgent.deleteTaskSession = async () => { throw new Error('cleanup failed') }

      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens\nDetails.')

      const result = await service.generateSummary('auth', cleanupFailAgent, testDir)
      expect(result.actionTaken).to.be.true

      const indexContent = await readFile(join(domainDir, SUMMARY_INDEX_FILE), 'utf8')
      const fm = parseSummaryFrontmatter(indexContent)
      expect(fm).to.not.be.null
      expect(fm!.type).to.equal('summary')
    })
  })

  describe('checkStaleness', () => {
    it('should report stale when no _index.md exists', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      const result = await service.checkStaleness('auth', testDir)
      expect(result.isStale).to.be.true
      expect(result.storedChildrenHash).to.equal('')
    })

    it('should report not stale when hash matches', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      // Generate first to get the correct hash
      await service.generateSummary('auth', mockAgent, testDir)

      const result = await service.checkStaleness('auth', testDir)
      expect(result.isStale).to.be.false
    })

    it('should report stale after content changes', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.generateSummary('auth', mockAgent, testDir)

      // Modify a child
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens - MODIFIED')

      const result = await service.checkStaleness('auth', testDir)
      expect(result.isStale).to.be.true
    })

    it('should report stale after child addition', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.generateSummary('auth', mockAgent, testDir)

      // Add a new child
      await writeFile(join(domainDir, 'oauth.md'), '# OAuth')

      const result = await service.checkStaleness('auth', testDir)
      expect(result.isStale).to.be.true
    })

    it('should report stale for empty directory with existing _index.md', async () => {
      const domainDir = join(contextTreeDir, 'empty')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, SUMMARY_INDEX_FILE), '---\ntype: summary\ncondensation_order: 2\nchildren_hash: old\n---\nOld summary')

      const result = await service.checkStaleness('empty', testDir)
      expect(result.isStale).to.be.true
    })
  })

  describe('propagateStaleness', () => {
    it('should return empty array for no changed paths', async () => {
      const results = await service.propagateStaleness([], mockAgent, testDir)
      expect(results).to.deep.equal([])
    })

    it('should regenerate parent summary when child changes', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      const results = await service.propagateStaleness(['auth/tokens.md'], mockAgent, testDir)
      // Should have processed at least the 'auth' directory and root '.'
      expect(results.length).to.be.greaterThan(0)

      // The 'auth' directory should have an _index.md now
      const hasSummary = await service.hasSummary('auth', testDir)
      expect(hasSummary).to.be.true
    })

    it('should walk upward to root', async () => {
      const topicDir = join(contextTreeDir, 'auth', 'jwt')
      await mkdir(topicDir, {recursive: true})
      await writeFile(join(topicDir, 'refresh.md'), '# Refresh flow')

      const results = await service.propagateStaleness(['auth/jwt/refresh.md'], mockAgent, testDir)
      // Should process: auth/jwt, auth, .
      const paths = results.map((r) => r.path)
      expect(paths).to.include('auth/jwt')
    })

    it('should process bottom-up (deepest first)', async () => {
      const topicDir = join(contextTreeDir, 'auth', 'jwt')
      await mkdir(topicDir, {recursive: true})
      await writeFile(join(topicDir, 'refresh.md'), '# Refresh flow')

      const results = await service.propagateStaleness(['auth/jwt/refresh.md'], mockAgent, testDir)
      const processedPaths = results.map((r) => r.path)

      // auth/jwt should come before auth in results
      const jwtIndex = processedPaths.indexOf('auth/jwt')
      const authIndex = processedPaths.indexOf('auth')
      if (jwtIndex !== -1 && authIndex !== -1) {
        expect(jwtIndex).to.be.lessThan(authIndex)
      }
    })

    it('should fall back and continue climbing when LLM generation fails', async () => {
      let callCount = 0
      const failOnSecondCallAgent = createMockAgent('Summary.')
      failOnSecondCallAgent.createTaskSession = async () => {
        callCount++
        if (callCount > 1) throw new Error('LLM down')

        return 'mock-session'
      }

      const topicDir = join(contextTreeDir, 'auth', 'jwt')
      await mkdir(topicDir, {recursive: true})
      await writeFile(join(topicDir, 'refresh.md'), '# Refresh')

      const results = await service.propagateStaleness(['auth/jwt/refresh.md'], failOnSecondCallAgent, testDir)
      expect(results.some((result) => result.path === 'auth/jwt' && result.actionTaken)).to.equal(true)
      expect(results.some((result) => result.path === 'auth' && result.actionTaken)).to.equal(true)
    })
  })

  describe('parentTaskId threading', () => {
    it('uses parentTaskId for createTaskSession when provided', async () => {
      const capturedTaskIds: string[] = []
      const trackingAgent = createMockAgent('Summary.')
      trackingAgent.createTaskSession = async (taskId: string) => {
        capturedTaskIds.push(taskId)
        return 'mock-session'
      }

      const authDir = join(contextTreeDir, 'auth')
      await mkdir(authDir, {recursive: true})
      await writeFile(join(authDir, 'jwt.md'), '# JWT\nToken handling.')

      await service.generateSummary('auth', trackingAgent, testDir, 'curate-op-abc123')
      expect(capturedTaskIds).to.include('curate-op-abc123')
      expect(capturedTaskIds.every((id) => !id.startsWith('summary_'))).to.equal(true)
    })

    it('falls back to summary_<dir> taskId when parentTaskId is absent', async () => {
      const capturedTaskIds: string[] = []
      const trackingAgent = createMockAgent('Summary.')
      trackingAgent.createTaskSession = async (taskId: string) => {
        capturedTaskIds.push(taskId)
        return 'mock-session'
      }

      const authDir = join(contextTreeDir, 'auth')
      await mkdir(authDir, {recursive: true})
      await writeFile(join(authDir, 'jwt.md'), '# JWT\nToken handling.')

      await service.generateSummary('auth', trackingAgent, testDir)
      expect(capturedTaskIds).to.include('summary_auth')
    })

    it('propagateStaleness threads parentTaskId through every generateSummary call', async () => {
      const capturedTaskIds: string[] = []
      const trackingAgent = createMockAgent('Summary.')
      trackingAgent.createTaskSession = async (taskId: string) => {
        capturedTaskIds.push(taskId)
        return 'mock-session'
      }

      const topicDir = join(contextTreeDir, 'auth', 'jwt')
      await mkdir(topicDir, {recursive: true})
      await writeFile(join(topicDir, 'refresh.md'), '# Refresh')

      const parentTaskId = 'curate-op-xyz789'
      await service.propagateStaleness(['auth/jwt/refresh.md'], trackingAgent, testDir, parentTaskId)

      // Every walk-up level (auth/jwt, auth) MUST share the parent id so the
      // billing service groups them into one operation.
      expect(capturedTaskIds.length).to.be.greaterThan(1)
      expect(capturedTaskIds.every((id) => id === parentTaskId)).to.equal(true)
    })
  })
})
