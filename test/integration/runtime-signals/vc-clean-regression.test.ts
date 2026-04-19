import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {IFileSystem} from '../../../src/agent/core/interfaces/i-file-system.js'
import type {IRuntimeSignalStore} from '../../../src/server/core/interfaces/storage/i-runtime-signal-store.js'

import {SearchKnowledgeService} from '../../../src/agent/infra/tools/implementations/search-knowledge-service.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../src/server/constants.js'
import {createMockRuntimeSignalStore} from '../../helpers/mock-factories.js'

interface PendingAccessHitsInternals {
  pendingAccessHits: Map<string, number>
}

function createDiskFileSystem(): IFileSystem {
  return {
    async readFile(path: string) {
      return {content: await fs.readFile(path, 'utf8')}
    },
    async writeFile(path: string, content: string) {
      await fs.writeFile(path, content, 'utf8')
    },
  } as unknown as IFileSystem
}

/**
 * The user-facing acceptance test for commit 5:
 * after N access-hit flushes on a populated context tree, every markdown
 * file's on-disk content is byte-identical to its initial state.
 *
 * This is the test that defines "done" for the runtime-signals migration.
 * If this fails, `brv vc status` shows noise for users after queries and
 * the whole initiative has missed its goal.
 */
describe('Runtime-signals migration — VC-clean regression', () => {
  let projectRoot: string
  let contextTreeDir: string
  let signalStore: IRuntimeSignalStore
  let service: SearchKnowledgeService

  beforeEach(async () => {
    projectRoot = join(tmpdir(), `rs-vc-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    contextTreeDir = join(projectRoot, BRV_DIR, CONTEXT_TREE_DIR)
    await fs.mkdir(contextTreeDir, {recursive: true})
    signalStore = createMockRuntimeSignalStore()
    service = new SearchKnowledgeService(createDiskFileSystem(), {
      baseDirectory: projectRoot,
      runtimeSignalStore: signalStore,
    })
  })

  afterEach(async () => {
    await fs.rm(projectRoot, {force: true, recursive: true})
  })

  it('flushAccessHits never modifies markdown files, regardless of hit volume', async () => {
    // Seed a context tree with 10 files that each have the post-commit-5
    // frontmatter shape: only semantic fields + timestamps.
    const relPaths: string[] = []
    for (let i = 0; i < 10; i++) {
      const domainDir = join(contextTreeDir, `domain_${i}`)
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(domainDir, {recursive: true})

      const relPath = `domain_${i}/entry_${i}.md`
      const fullPath = join(contextTreeDir, relPath)
      const content =
        `---\n` +
        `title: Entry ${i}\n` +
        `tags: [test]\n` +
        `keywords: [sample]\n` +
        `createdAt: '2026-01-01T00:00:00.000Z'\n` +
        `updatedAt: '2026-01-01T00:00:00.000Z'\n` +
        `---\n\n# Entry ${i}\n\nSample content for regression test.\n`
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(fullPath, content, 'utf8')
      relPaths.push(relPath)
    }

    // Snapshot original content for every file.
    const originals = new Map<string, string>()
    for (const relPath of relPaths) {
      // eslint-disable-next-line no-await-in-loop
      originals.set(relPath, await fs.readFile(join(contextTreeDir, relPath), 'utf8'))
    }

    // Simulate 20 rounds of access-hit flushes, each touching every file.
    const pendingMap = (service as unknown as PendingAccessHitsInternals).pendingAccessHits
    for (let round = 0; round < 20; round++) {
      pendingMap.clear()
      for (const relPath of relPaths) {
        pendingMap.set(relPath, 1)
      }

      // eslint-disable-next-line no-await-in-loop
      const flushed = await service.flushAccessHits(contextTreeDir)
      expect(flushed).to.equal(true)
    }

    // Every markdown file on disk is byte-identical to its initial state —
    // no scoring fields were written, no timestamps touched, nothing.
    for (const relPath of relPaths) {
      // eslint-disable-next-line no-await-in-loop
      const currentContent = await fs.readFile(join(contextTreeDir, relPath), 'utf8')
      expect(currentContent, `file ${relPath} was modified after 20 flushes`).to.equal(originals.get(relPath))
    }

    // Meanwhile the sidecar has accumulated real signal state.
    const signals = await signalStore.list()
    expect(signals.size).to.equal(relPaths.length)
    for (const relPath of relPaths) {
      // 20 rounds × 1 hit × 3 importance bonus = 60 importance above default 50.
      const entry = signals.get(relPath)
      expect(entry?.importance).to.be.greaterThanOrEqual(60)
      expect(entry?.accessCount).to.equal(20)
    }
  })

  it('parseContent tolerates legacy files with full signal frontmatter', async () => {
    const {MarkdownWriter} = await import('../../../src/server/core/domain/knowledge/markdown-writer.js')

    // Pre-migration file: every runtime-signal field present in YAML.
    const legacy =
      `---\n` +
      `title: Legacy Entry\n` +
      `tags: [auth]\n` +
      `keywords: [jwt]\n` +
      `importance: 72\n` +
      `recency: 0.8\n` +
      `maturity: validated\n` +
      `accessCount: 14\n` +
      `updateCount: 3\n` +
      `createdAt: '2026-01-01T00:00:00.000Z'\n` +
      `updatedAt: '2026-01-15T00:00:00.000Z'\n` +
      `---\n\n# Legacy Entry\n\nSome content.\n`

    const parsed = MarkdownWriter.parseContent(legacy, 'Legacy Entry')

    // Semantic fields round-trip.
    expect(parsed.name).to.equal('Legacy Entry')
    expect(parsed.tags).to.deep.equal(['auth'])
    expect(parsed.keywords).to.deep.equal(['jwt'])
    expect(parsed.timestamps?.createdAt).to.equal('2026-01-01T00:00:00.000Z')
    expect(parsed.timestamps?.updatedAt).to.equal('2026-01-15T00:00:00.000Z')

    // Legacy runtime-signal fields are silently ignored — not exposed on the
    // semantic type (ContextData has no importance/recency/maturity fields).
    const asRecord = parsed as unknown as Record<string, unknown>
    expect(asRecord.importance).to.be.undefined
    expect(asRecord.recency).to.be.undefined
    expect(asRecord.maturity).to.be.undefined
    expect(asRecord.accessCount).to.be.undefined
    expect(asRecord.updateCount).to.be.undefined
  })

  it('generateFrontmatter never emits runtime-signal fields', async () => {
    const {MarkdownWriter} = await import('../../../src/server/core/domain/knowledge/markdown-writer.js')

    const output = MarkdownWriter.generateContext({
      keywords: ['jwt'],
      name: 'Fresh Entry',
      snippets: [],
      tags: ['auth'],
      timestamps: {createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-15T00:00:00.000Z'},
    })

    expect(output).to.not.match(/^importance:/m)
    expect(output).to.not.match(/^recency:/m)
    expect(output).to.not.match(/^maturity:/m)
    expect(output).to.not.match(/^accessCount:/m)
    expect(output).to.not.match(/^updateCount:/m)

    // Semantic fields and timestamps still emit.
    expect(output).to.match(/^title: Fresh Entry/m)
    expect(output).to.match(/^tags: \[auth\]/m)
    expect(output).to.match(/^createdAt:/m)
    expect(output).to.match(/^updatedAt:/m)
  })
})
