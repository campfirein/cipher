/* eslint-disable camelcase */
import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ARCHIVE_DIR, BRV_DIR, CONTEXT_TREE_DIR, MANIFEST_FILE, SUMMARY_INDEX_FILE} from '../../../../src/server/constants.js'
import {FileContextTreeManifestService} from '../../../../src/server/infra/context-tree/file-context-tree-manifest-service.js'
import {generateArchiveStubContent, generateSummaryContent} from '../../../../src/server/infra/context-tree/summary-frontmatter.js'

describe('FileContextTreeManifestService', () => {
  let testDir: string
  let contextTreeDir: string
  let service: FileContextTreeManifestService

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-manifest-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})
    service = new FileContextTreeManifestService({baseDirectory: testDir})
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('buildManifest', () => {
    it('should create _manifest.json', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 80\n---\n# Tokens\nContent.')

      const manifest = await service.buildManifest(testDir)

      // Verify file was written
      const manifestContent = await readFile(join(contextTreeDir, MANIFEST_FILE), 'utf8')
      const parsed = JSON.parse(manifestContent)
      expect(parsed.version).to.equal(1)
      expect(manifest.version).to.equal(1)
    })

    it('should allocate summaries into the summaries lane', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      const summaryContent = generateSummaryContent(
        {
          children_hash: 'hash123',
          compression_ratio: 0.2,
          condensation_order: 2,
          covers: ['tokens.md'],
          covers_token_total: 500,
          summary_level: 'd2',
          token_count: 100,
          type: 'summary',
        },
        'Auth summary.',
      )
      await writeFile(join(domainDir, SUMMARY_INDEX_FILE), summaryContent)

      const manifest = await service.buildManifest(testDir)
      const summaryEntries = manifest.active_context.filter((e) => e.type === 'summary')
      expect(summaryEntries.length).to.be.greaterThan(0)
      expect(summaryEntries[0].path).to.equal(`auth/${SUMMARY_INDEX_FILE}`)
    })

    it('should allocate regular .md files into the contexts lane', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 80\n---\n# Tokens')

      const manifest = await service.buildManifest(testDir)
      const contextEntries = manifest.active_context.filter((e) => e.type === 'context')
      expect(contextEntries.length).to.be.greaterThan(0)
      expect(contextEntries[0].path).to.equal('auth/tokens.md')
    })

    it('should allocate archive stubs into the stubs lane', async () => {
      const archiveDir = join(contextTreeDir, ARCHIVE_DIR, 'auth')
      await mkdir(archiveDir, {recursive: true})
      const stubContent = generateArchiveStubContent(
        {
          evicted_at: '2026-03-01T00:00:00.000Z',
          evicted_importance: 25,
          original_path: 'auth/tokens.md',
          original_token_count: 1000,
          points_to: '_archived/auth/tokens.full.md',
          type: 'archive_stub',
        },
        'Ghost cue for tokens.',
      )
      await writeFile(join(archiveDir, 'tokens.stub.md'), stubContent)

      const manifest = await service.buildManifest(testDir)
      const stubEntries = manifest.active_context.filter((e) => e.type === 'stub')
      expect(stubEntries.length).to.be.greaterThan(0)
      expect(stubEntries[0].path).to.include('_archived/auth/tokens.stub.md')
    })

    it('should respect lane token budgets', async () => {
      const domainDir = join(contextTreeDir, 'big')
      await mkdir(domainDir, {recursive: true})

      // Create many context files to exceed the 4000 token budget
      const bigContent = 'x '.repeat(5000) // ~5000 tokens
      await writeFile(join(domainDir, 'file1.md'), `---\nimportance: 90\n---\n${bigContent}`)
      await writeFile(join(domainDir, 'file2.md'), `---\nimportance: 80\n---\n${bigContent}`)

      const manifest = await service.buildManifest(testDir)

      // Only one should fit within the 4000 token budget
      const contextEntries = manifest.active_context.filter((e) => e.type === 'context')
      expect(contextEntries.length).to.equal(1)
      expect(manifest.lane_tokens.contexts).to.be.lessThanOrEqual(4000)
    })

    it('should prioritize summaries by condensation_order (broadest first)', async () => {
      const authDir = join(contextTreeDir, 'auth')
      const apiDir = join(contextTreeDir, 'api')
      await mkdir(authDir, {recursive: true})
      await mkdir(apiDir, {recursive: true})

      // auth has order 2 (broader)
      await writeFile(
        join(authDir, SUMMARY_INDEX_FILE),
        generateSummaryContent(
          {children_hash: 'h1', compression_ratio: 0.2, condensation_order: 2, covers: ['a.md'], covers_token_total: 500, summary_level: 'd2', token_count: 50, type: 'summary'},
          'Auth broad summary.',
        ),
      )
      // api has order 1 (narrower)
      await writeFile(
        join(apiDir, SUMMARY_INDEX_FILE),
        generateSummaryContent(
          {children_hash: 'h2', compression_ratio: 0.3, condensation_order: 1, covers: ['b.md'], covers_token_total: 300, summary_level: 'd1', token_count: 40, type: 'summary'},
          'API narrow summary.',
        ),
      )

      const manifest = await service.buildManifest(testDir)
      const summaries = manifest.active_context.filter((e) => e.type === 'summary')
      expect(summaries.length).to.equal(2)
      // Higher order should come first (order 2 before order 1)
      expect(summaries[0].order).to.equal(2)
      expect(summaries[1].order).to.equal(1)
    })

    it('should prioritize contexts by importance (highest first)', async () => {
      const domainDir = join(contextTreeDir, 'mixed')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'low.md'), '---\nimportance: 30\n---\n# Low importance')
      await writeFile(join(domainDir, 'high.md'), '---\nimportance: 90\n---\n# High importance')

      const manifest = await service.buildManifest(testDir)
      const contexts = manifest.active_context.filter((e) => e.type === 'context')
      expect(contexts.length).to.equal(2)
      expect(contexts[0].importance).to.be.greaterThanOrEqual(contexts[1].importance!)
    })

    it('should include source_fingerprint', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      const manifest = await service.buildManifest(testDir)
      expect(manifest.source_fingerprint).to.be.a('string')
      expect(manifest.source_fingerprint).to.have.lengthOf(64)
    })

    it('should include generated_at timestamp', async () => {
      const manifest = await service.buildManifest(testDir)
      expect(manifest.generated_at).to.be.a('string')
      expect(() => new Date(manifest.generated_at)).to.not.throw()
    })

    it('should track lane_tokens correctly', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 80\n---\n# Tokens content')
      await writeFile(
        join(domainDir, SUMMARY_INDEX_FILE),
        generateSummaryContent(
          {children_hash: 'h1', compression_ratio: 0.2, condensation_order: 2, covers: ['tokens.md'], covers_token_total: 100, summary_level: 'd2', token_count: 20, type: 'summary'},
          'Summary text.',
        ),
      )

      const manifest = await service.buildManifest(testDir)
      expect(manifest.lane_tokens.summaries).to.be.greaterThan(0)
      expect(manifest.lane_tokens.contexts).to.be.greaterThan(0)
      expect(manifest.total_tokens).to.equal(
        manifest.lane_tokens.summaries + manifest.lane_tokens.contexts + manifest.lane_tokens.stubs,
      )
    })
  })

  describe('readManifest', () => {
    it('should return null when no manifest exists', async () => {
      const result = await service.readManifest(testDir)
      expect(result).to.be.null
    })

    it('should return manifest after build', async () => {
      await service.buildManifest(testDir)
      const result = await service.readManifest(testDir)
      expect(result).to.not.be.null
      expect(result!.version).to.equal(1)
    })
  })

  describe('readManifestIfFresh', () => {
    it('should return null when no manifest exists', async () => {
      const result = await service.readManifestIfFresh(testDir)
      expect(result).to.be.null
    })

    it('should return manifest when fingerprint matches', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.buildManifest(testDir)
      const result = await service.readManifestIfFresh(testDir)
      expect(result).to.not.be.null
    })

    it('should return null when files are added after build', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.buildManifest(testDir)

      // Add a new file
      await writeFile(join(domainDir, 'oauth.md'), '# OAuth')

      const result = await service.readManifestIfFresh(testDir)
      expect(result).to.be.null
    })

    it('should return null when files are deleted after build', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.buildManifest(testDir)

      // Delete the file
      await rm(join(domainDir, 'tokens.md'))

      const result = await service.readManifestIfFresh(testDir)
      expect(result).to.be.null
    })

    it('should return null when files are modified after build', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.buildManifest(testDir)

      // Wait a bit to ensure mtime changes
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens MODIFIED')

      const result = await service.readManifestIfFresh(testDir)
      expect(result).to.be.null
    })

    it('should return null when an abstract file is added after build', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '# Tokens')

      await service.buildManifest(testDir)
      await writeFile(join(domainDir, 'tokens.abstract.md'), 'Short abstract')

      const result = await service.readManifestIfFresh(testDir)
      expect(result).to.be.null
    })
  })

  describe('resolveForInjection', () => {
    it('should return content for all active entries', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 80\n---\n# Tokens\nContent here.')

      const manifest = await service.buildManifest(testDir)
      const resolved = await service.resolveForInjection(manifest, undefined, testDir)

      expect(resolved.length).to.be.greaterThan(0)
      expect(resolved[0].content).to.include('# Tokens')
      expect(resolved[0].path).to.equal('auth/tokens.md')
      expect(resolved[0].type).to.equal('context')
    })

    it('should order: summaries → contexts → stubs', async () => {
      const domainDir = join(contextTreeDir, 'auth')
      const archiveDir = join(contextTreeDir, ARCHIVE_DIR, 'old')
      await mkdir(domainDir, {recursive: true})
      await mkdir(archiveDir, {recursive: true})

      // Create a summary
      await writeFile(
        join(domainDir, SUMMARY_INDEX_FILE),
        generateSummaryContent(
          {children_hash: 'h', compression_ratio: 0.2, condensation_order: 2, covers: ['tokens.md'], covers_token_total: 100, summary_level: 'd2', token_count: 20, type: 'summary'},
          'Summary.',
        ),
      )
      // Create a context
      await writeFile(join(domainDir, 'tokens.md'), '---\nimportance: 80\n---\n# Tokens')
      // Create a stub
      await writeFile(
        join(archiveDir, 'legacy.stub.md'),
        generateArchiveStubContent(
          {evicted_at: '2026-03-01', evicted_importance: 20, original_path: 'old/legacy.md', original_token_count: 500, points_to: '_archived/old/legacy.full.md', type: 'archive_stub'},
          'Ghost cue.',
        ),
      )

      const manifest = await service.buildManifest(testDir)
      const resolved = await service.resolveForInjection(manifest, undefined, testDir)

      const types = resolved.map((r) => r.type)
      const summaryIndex = types.indexOf('summary')
      const contextIndex = types.indexOf('context')
      const stubIndex = types.indexOf('stub')

      if (summaryIndex !== -1 && contextIndex !== -1) {
        expect(summaryIndex).to.be.lessThan(contextIndex)
      }

      if (contextIndex !== -1 && stubIndex !== -1) {
        expect(contextIndex).to.be.lessThan(stubIndex)
      }
    })

    it('should skip unreadable entries gracefully', async () => {
      const manifest = {
        active_context: [{path: 'nonexistent/file.md', tokens: 100, type: 'context' as const}],
        generated_at: new Date().toISOString(),
        lane_tokens: {contexts: 100, stubs: 0, summaries: 0},
        source_fingerprint: 'hash',
        total_tokens: 100,
        version: 1 as const,
      }

      const resolved = await service.resolveForInjection(manifest, undefined, testDir)
      expect(resolved).to.deep.equal([])
    })
  })
})
