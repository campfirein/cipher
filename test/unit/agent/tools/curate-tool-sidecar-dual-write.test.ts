import {expect} from 'chai'
import * as fs from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {IRuntimeSignalStore} from '../../../../src/server/core/interfaces/storage/i-runtime-signal-store.js'

import {createCurateTool} from '../../../../src/agent/infra/tools/implementations/curate-tool.js'
import {createDefaultRuntimeSignals} from '../../../../src/server/core/domain/knowledge/runtime-signals-schema.js'
import {createMockRuntimeSignalStore} from '../../../helpers/mock-factories.js'

interface CurateOutput {
  applied: Array<{
    message?: string
    path: string
    status: 'failed' | 'success'
    type: string
  }>
  summary: {
    added: number
    deleted: number
    failed: number
    merged: number
    updated: number
  }
}

interface CurateTool {
  execute(input: unknown): Promise<CurateOutput>
}

async function runCurate(
  basePath: string,
  signalStore: IRuntimeSignalStore,
  operations: Array<Record<string, unknown>>,
): Promise<CurateOutput> {
  const tool = createCurateTool(undefined, undefined, signalStore) as unknown as CurateTool
  return tool.execute({basePath, operations})
}

describe('Curate tool — runtime-signal sidecar dual-write', () => {
  let tmpDir: string
  let basePath: string
  let signalStore: IRuntimeSignalStore

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `curate-dual-write-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    basePath = join(tmpDir, '.brv/context-tree')
    await fs.mkdir(basePath, {recursive: true})
    signalStore = createMockRuntimeSignalStore()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, {force: true, recursive: true})
  })

  describe('ADD', () => {
    it('seeds the sidecar with default signals for the new file', async () => {
      const result = await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['const x = 1'], tags: ['test']},
          impact: 'low',
          path: 'tech_stack/typescript',
          reason: 'init',
          title: 'TypeScript Notes',
          type: 'ADD',
        },
      ])

      expect(result.summary.added).to.equal(1)
      const relPath = 'tech_stack/typescript/typescript_notes.md'
      const signals = await signalStore.get(relPath)
      expect(signals).to.deep.equal(createDefaultRuntimeSignals())
    })
  })

  describe('UPDATE', () => {
    it('bumps importance/recency/updateCount and recomputes maturity in the sidecar', async () => {
      // Seed via ADD so markdown + sidecar both start in sync.
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'domain/topic',
          reason: 'seed',
          title: 'My Note',
          type: 'ADD',
        },
      ])

      const relPath = 'domain/topic/my_note.md'
      const before = await signalStore.get(relPath)
      expect(before.importance).to.equal(50)
      expect(before.updateCount).to.equal(0)
      expect(before.recency).to.equal(1)

      // Simulate a "cold" sidecar by decaying recency so the update bump is visible.
      await signalStore.update(relPath, (current) => ({...current, recency: 0.2}))

      const updateResult = await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a', 'b'], tags: ['t']},
          impact: 'low',
          path: 'domain/topic',
          reason: 'update',
          title: 'My Note',
          type: 'UPDATE',
        },
      ])
      expect(updateResult.summary.updated).to.equal(1)

      const after = await signalStore.get(relPath)
      expect(after.importance).to.equal(55) // 50 + UPDATE_IMPORTANCE_BONUS(5)
      expect(after.recency).to.equal(1) // reset to 1 by recordCurateUpdate
      expect(after.updateCount).to.equal(1)
      expect(after.maturity).to.equal('draft') // 55 < PROMOTE_TO_VALIDATED(65)
    })

    it('maturity invariant: repeated updates promote draft -> validated when importance crosses 65', async () => {
      // Seed, then apply 3 updates (+5 each = +15) on top of an already-elevated importance.
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'd/t',
          reason: 'seed',
          title: 'N',
          type: 'ADD',
        },
      ])
      const relPath = 'd/t/n.md'

      // Pre-set importance to 55 so the first UPDATE (+5=60) still stays draft,
      // the second (+5=65) crosses the PROMOTE_TO_VALIDATED threshold.
      await signalStore.set(relPath, {...createDefaultRuntimeSignals(), importance: 55})

      const updateOp = {
        confidence: 'high' as const,
        content: {snippets: ['a'], tags: ['t']},
        impact: 'low' as const,
        path: 'd/t',
        reason: 'u',
        title: 'N',
        type: 'UPDATE' as const,
      }

      await runCurate(basePath, signalStore, [updateOp])
      expect((await signalStore.get(relPath)).maturity).to.equal('draft')

      await runCurate(basePath, signalStore, [updateOp])
      expect((await signalStore.get(relPath)).maturity).to.equal('validated')
    })
  })

  describe('DELETE', () => {
    it('drops the sidecar entry for the deleted file', async () => {
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'x/y',
          reason: 'seed',
          title: 'Z',
          type: 'ADD',
        },
      ])
      const relPath = 'x/y/z.md'
      // Mark the sidecar entry with a non-default value so we can verify removal.
      await signalStore.set(relPath, {...createDefaultRuntimeSignals(), importance: 87})

      const delResult = await runCurate(basePath, signalStore, [
        {
          confidence: 'low',
          impact: 'low',
          path: 'x/y',
          reason: 'clean',
          title: 'Z',
          type: 'DELETE',
        },
      ])
      expect(delResult.summary.deleted).to.equal(1)

      // After delete, sidecar get() should return defaults (entry gone).
      const after = await signalStore.get(relPath)
      expect(after).to.deep.equal(createDefaultRuntimeSignals())
    })

    it('drops sidecar entries for every file inside a deleted folder', async () => {
      // Seed two files under the same topic folder.
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'domain/topic',
          reason: 'seed one',
          title: 'File One',
          type: 'ADD',
        },
        {
          confidence: 'high',
          content: {snippets: ['b'], tags: ['t']},
          impact: 'low',
          path: 'domain/topic',
          reason: 'seed two',
          title: 'File Two',
          type: 'ADD',
        },
      ])

      const relOne = 'domain/topic/file_one.md'
      const relTwo = 'domain/topic/file_two.md'

      // Mark both sidecar entries with non-default values so we can prove removal.
      await signalStore.set(relOne, {...createDefaultRuntimeSignals(), importance: 80})
      await signalStore.set(relTwo, {...createDefaultRuntimeSignals(), importance: 90})

      // Folder delete: omit `title` so executeDelete takes the folder branch.
      const result = await runCurate(basePath, signalStore, [
        {
          confidence: 'low',
          impact: 'low',
          path: 'domain/topic',
          reason: 'clean folder',
          type: 'DELETE',
        },
      ])
      expect(result.summary.deleted).to.equal(1)

      // Both sidecar entries must be gone — get() returns defaults on miss.
      const afterOne = await signalStore.get(relOne)
      const afterTwo = await signalStore.get(relTwo)
      expect(afterOne).to.deep.equal(createDefaultRuntimeSignals())
      expect(afterTwo).to.deep.equal(createDefaultRuntimeSignals())
    })
  })

  describe('MERGE', () => {
    it('merges source+target signals into the target and drops the source entry', async () => {
      // Seed two files.
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'auth/jwt',
          reason: 'seed src',
          title: 'Refresh',
          type: 'ADD',
        },
        {
          confidence: 'high',
          content: {snippets: ['b'], tags: ['t']},
          impact: 'low',
          path: 'auth/jwt',
          reason: 'seed tgt',
          title: 'Rotation',
          type: 'ADD',
        },
      ])

      const srcRel = 'auth/jwt/refresh.md'
      const tgtRel = 'auth/jwt/rotation.md'

      // Give source and target distinct signal profiles.
      await signalStore.set(srcRel, {accessCount: 3, importance: 70, maturity: 'validated', recency: 0.6, updateCount: 2})
      await signalStore.set(tgtRel, {accessCount: 5, importance: 50, maturity: 'draft', recency: 1, updateCount: 0})

      const mergeResult = await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          impact: 'low',
          mergeTarget: 'auth/jwt',
          mergeTargetTitle: 'Rotation',
          path: 'auth/jwt',
          reason: 'consolidate',
          title: 'Refresh',
          type: 'MERGE',
        },
      ])
      expect(mergeResult.summary.merged).to.equal(1)

      // Source entry dropped.
      expect(await signalStore.get(srcRel)).to.deep.equal(createDefaultRuntimeSignals())

      // Target entry merged: max importance, max recency, sum counts, updateCount+1,
      // tier re-derived from merged importance (70 -> validated by hysteresis).
      const merged = await signalStore.get(tgtRel)
      expect(merged.accessCount).to.equal(8)
      expect(merged.importance).to.equal(70)
      expect(merged.recency).to.equal(1)
      expect(merged.updateCount).to.equal(3) // 2 + 0 + 1
      expect(merged.maturity).to.equal('validated')
    })
  })

  describe('markdown/sidecar separation', () => {
    it('ADD writes scoring only to the sidecar — markdown carries no runtime-signal fields', async () => {
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['code'], tags: ['t']},
          impact: 'low',
          path: 'd/t',
          reason: 'seed',
          title: 'Consistency',
          type: 'ADD',
        },
      ])

      const relPath = 'd/t/consistency.md'
      const markdownPath = join(basePath, relPath)
      const markdown = await fs.readFile(markdownPath, 'utf8')
      const signals = await signalStore.get(relPath)

      // Sidecar carries the runtime signals (default values on ADD).
      expect(signals).to.deep.equal(createDefaultRuntimeSignals())

      // Markdown carries zero runtime-signal fields — not emitted any more.
      expect(markdown).to.not.match(/^importance:/m)
      expect(markdown).to.not.match(/^recency:/m)
      expect(markdown).to.not.match(/^maturity:/m)
      expect(markdown).to.not.match(/^accessCount:/m)
      expect(markdown).to.not.match(/^updateCount:/m)
    })

    it('UPDATE bumps the sidecar while leaving markdown scoring-free', async () => {
      // Seed.
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'd/t',
          reason: 'seed',
          title: 'Sync',
          type: 'ADD',
        },
      ])
      // Bump.
      await runCurate(basePath, signalStore, [
        {
          confidence: 'high',
          content: {snippets: ['a', 'b'], tags: ['t']},
          impact: 'low',
          path: 'd/t',
          reason: 'bump',
          title: 'Sync',
          type: 'UPDATE',
        },
      ])

      const relPath = 'd/t/sync.md'
      const markdown = await fs.readFile(join(basePath, relPath), 'utf8')
      const signals = await signalStore.get(relPath)

      // Sidecar reflects the bump.
      expect(signals.importance).to.equal(55) // 50 + UPDATE_IMPORTANCE_BONUS(5)
      expect(signals.updateCount).to.equal(1)

      // Markdown still carries no runtime-signal fields.
      expect(markdown).to.not.match(/^importance:/m)
      expect(markdown).to.not.match(/^maturity:/m)
      expect(markdown).to.not.match(/^updateCount:/m)
    })
  })

  describe('sidecar failure isolation', () => {
    it('does not abort a curate ADD when the sidecar throws', async () => {
      const throwing: IRuntimeSignalStore = {
        async batchUpdate() {},
        async delete() {
          throw new Error('sidecar down')
        },
        async get() {
          return createDefaultRuntimeSignals()
        },
        async getMany() {
          return new Map()
        },
        async list() {
          return new Map()
        },
        async set() {
          throw new Error('sidecar down')
        },
        async update() {
          throw new Error('sidecar down')
        },
      }

      const result = await runCurate(basePath, throwing, [
        {
          confidence: 'high',
          content: {snippets: ['a'], tags: ['t']},
          impact: 'low',
          path: 'd/t',
          reason: 'test',
          title: 'N',
          type: 'ADD',
        },
      ])

      // ADD completed — markdown write succeeded despite sidecar failure.
      expect(result.summary.added).to.equal(1)
      expect(result.summary.failed).to.equal(0)
    })
  })
})
