import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'
import type {IRuntimeSignalStore} from '../../../../src/server/core/interfaces/storage/i-runtime-signal-store.js'

import {SearchKnowledgeService} from '../../../../src/agent/infra/tools/implementations/search-knowledge-service.js'
import {createDefaultRuntimeSignals} from '../../../../src/server/core/domain/knowledge/runtime-signals-schema.js'
import {createMockRuntimeSignalStore} from '../../../helpers/mock-factories.js'

// Minimal IFileSystem shim backed by real disk.
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

interface PendingAccessHitsInternals {
  pendingAccessHits: Map<string, number>
}

// Narrow unsafe-cast helper: SearchKnowledgeService accumulates access hits
// via private `pendingAccessHits`. The flush pipeline is the unit under test,
// so we prime the map directly rather than going through the indexing path.
function primePendingHits(service: SearchKnowledgeService, hits: Record<string, number>): void {
  const bag = (service as unknown as PendingAccessHitsInternals).pendingAccessHits
  bag.clear()
  for (const [path, count] of Object.entries(hits)) {
    bag.set(path, count)
  }
}

const MARKDOWN_WITH_SCORING = `---
title: Test
importance: 50
recency: 1
maturity: draft
accessCount: 0
updateCount: 0
---

Body.
`

describe('SearchKnowledgeService — flushAccessHits dual-write', () => {
  let tmpDir: string
  let contextTreeDir: string
  let signalStore: IRuntimeSignalStore
  let service: SearchKnowledgeService

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `sks-flush-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    contextTreeDir = join(tmpDir, 'ctx')
    await fs.mkdir(contextTreeDir, {recursive: true})
    signalStore = createMockRuntimeSignalStore()
    service = new SearchKnowledgeService(createDiskFileSystem(), {runtimeSignalStore: signalStore})
  })

  afterEach(async () => {
    await fs.rm(tmpDir, {force: true, recursive: true})
  })

  it('mirrors accumulated hits into the sidecar with bumped importance and accessCount', async () => {
    const relPath = 'auth/jwt.md'
    const filePath = join(contextTreeDir, relPath)
    await fs.mkdir(join(contextTreeDir, 'auth'), {recursive: true})
    await fs.writeFile(filePath, MARKDOWN_WITH_SCORING, 'utf8')

    primePendingHits(service, {[relPath]: 4})

    const flushed = await service.flushAccessHits(contextTreeDir)
    expect(flushed).to.equal(true)

    const signals = await signalStore.get(relPath)
    // importance: 50 + 3 * 4 = 62
    expect(signals.importance).to.equal(62)
    expect(signals.accessCount).to.equal(4)
    // 62 < 65 -> stays draft under hysteresis
    expect(signals.maturity).to.equal('draft')
  })

  it('promotes maturity from draft to validated once importance crosses 65', async () => {
    const relPath = 'domain/topic.md'
    const filePath = join(contextTreeDir, relPath)
    await fs.mkdir(join(contextTreeDir, 'domain'), {recursive: true})
    await fs.writeFile(filePath, MARKDOWN_WITH_SCORING, 'utf8')

    // Prime the sidecar at importance 60 so 3 hits (+9) crosses the threshold.
    await signalStore.set(relPath, {...createDefaultRuntimeSignals(), importance: 60})
    primePendingHits(service, {[relPath]: 3})

    await service.flushAccessHits(contextTreeDir)

    const signals = await signalStore.get(relPath)
    expect(signals.importance).to.equal(69)
    expect(signals.maturity).to.equal('validated')
  })

  it('returns false and does not touch the sidecar when there are no pending hits', async () => {
    const flushed = await service.flushAccessHits(contextTreeDir)
    expect(flushed).to.equal(false)
    // No side effects — signal store is empty.
    expect((await signalStore.list()).size).to.equal(0)
  })

  it('reports completion even when the sidecar batchUpdate throws and leaves markdown untouched', async () => {
    const throwing: IRuntimeSignalStore = {
      async batchUpdate() {
        throw new Error('sidecar down')
      },
      async delete() {},
      async get() {
        return createDefaultRuntimeSignals()
      },
      async getMany() {
        return new Map()
      },
      async list() {
        return new Map()
      },
      async set() {},
      async update() {
        return createDefaultRuntimeSignals()
      },
    }
    const isolated = new SearchKnowledgeService(createDiskFileSystem(), {runtimeSignalStore: throwing})

    const relPath = 'x.md'
    const filePath = join(contextTreeDir, relPath)
    await fs.writeFile(filePath, MARKDOWN_WITH_SCORING, 'utf8')
    const before = await fs.readFile(filePath, 'utf8')
    primePendingHits(isolated, {[relPath]: 1})

    // Flush must not throw despite the sidecar failure — commit 5 no longer
    // writes to markdown so `flushed` simply indicates that pending hits
    // were processed.
    const flushed = await isolated.flushAccessHits(contextTreeDir)
    expect(flushed).to.equal(true)

    // Markdown is byte-identical — flush never touches it post-commit-5.
    const after = await fs.readFile(filePath, 'utf8')
    expect(after).to.equal(before)
  })
})
