import {expect} from 'chai'
import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ICipherAgent} from '../../../../src/agent/core/interfaces/i-cipher-agent.js'
import type {IRuntimeSignalStore} from '../../../../src/server/core/interfaces/storage/i-runtime-signal-store.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../src/server/constants.js'
import {createDefaultRuntimeSignals} from '../../../../src/server/core/domain/knowledge/runtime-signals-schema.js'
import {FileContextTreeArchiveService} from '../../../../src/server/infra/context-tree/file-context-tree-archive-service.js'
import {createMockRuntimeSignalStore} from '../../../helpers/mock-factories.js'

function createMockAgent(ghostCue = 'ghost cue'): ICipherAgent {
  return {
    async cancel() {},
    async createTaskSession() {
      return 'mock-session-id'
    },
    async deleteSandboxVariable() {},
    async deleteSandboxVariableOnSession() {},
    async deleteSession() {},
    async deleteTaskSession() {},
    async execute() {
      return ghostCue
    },
    async executeOnSession() {
      return ghostCue
    },
    async generate() {
      return ghostCue
    },
    async getSessionMetadata() {},
    getState() {
      return 'idle'
    },
    async listPersistedSessions() {
      return []
    },
    async reset() {},
    async setSandboxVariable() {},
    async setSandboxVariableOnSession() {},
    async start() {},
    async *stream() {
      yield ghostCue
    },
  } as unknown as ICipherAgent
}

const MARKDOWN_WITH_SCORING = `---
title: Tokens
importance: 45
maturity: draft
---

# Tokens
Content.
`

describe('FileContextTreeArchiveService — sidecar dual-write', () => {
  let testDir: string
  let contextTreeDir: string
  let signalStore: IRuntimeSignalStore
  let service: FileContextTreeArchiveService
  let agent: ICipherAgent

  beforeEach(async () => {
    testDir = join(tmpdir(), `archive-dual-write-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})
    signalStore = createMockRuntimeSignalStore()
    service = new FileContextTreeArchiveService(signalStore)
    agent = createMockAgent()
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('archiveEntry', () => {
    it('drops the sidecar entry for the archived path', async () => {
      const relPath = 'auth/tokens.md'
      await mkdir(join(contextTreeDir, 'auth'), {recursive: true})
      await writeFile(join(contextTreeDir, relPath), MARKDOWN_WITH_SCORING, 'utf8')

      // Seed the sidecar with a non-default value so we can observe the delete.
      await signalStore.set(relPath, {...createDefaultRuntimeSignals(), importance: 42})

      await service.archiveEntry(relPath, agent, testDir)

      // After archive, get() returns defaults — entry was deleted.
      const after = await signalStore.get(relPath)
      expect(after).to.deep.equal(createDefaultRuntimeSignals())
      // And the map does not contain this key.
      expect((await signalStore.list()).has(relPath)).to.equal(false)
    })

    it('succeeds even if the sidecar delete throws', async () => {
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
        async set() {},
        async update() {
          return createDefaultRuntimeSignals()
        },
      }
      const isolated = new FileContextTreeArchiveService(throwing)

      const relPath = 'x.md'
      await writeFile(join(contextTreeDir, relPath), MARKDOWN_WITH_SCORING, 'utf8')

      // Must not throw — markdown archive completes even though sidecar fails.
      const result = await isolated.archiveEntry(relPath, agent, testDir)
      expect(result.originalPath).to.equal(relPath)
      expect(result.stubPath).to.include('_archived/x.stub.md')
    })
  })

  describe('restoreEntry', () => {
    it('seeds default signals for the restored path', async () => {
      const relPath = 'auth/tokens.md'
      await mkdir(join(contextTreeDir, 'auth'), {recursive: true})
      await writeFile(join(contextTreeDir, relPath), MARKDOWN_WITH_SCORING, 'utf8')

      // Archive first so there is something to restore.
      const archiveResult = await service.archiveEntry(relPath, agent, testDir)
      // Sidecar is empty at this point (archive deleted any entry and there was none).
      expect((await signalStore.list()).size).to.equal(0)

      await service.restoreEntry(archiveResult.stubPath, testDir)

      // Sidecar now has a default entry for the restored path.
      const after = await signalStore.get(relPath)
      expect(after).to.deep.equal(createDefaultRuntimeSignals())
      expect((await signalStore.list()).has(relPath)).to.equal(true)
    })

    it('succeeds even if the sidecar set throws on restore', async () => {
      const throwing: IRuntimeSignalStore = {
        async batchUpdate() {},
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
        async set() {
          throw new Error('sidecar down')
        },
        async update() {
          return createDefaultRuntimeSignals()
        },
      }
      const isolated = new FileContextTreeArchiveService(throwing)

      const relPath = 'y.md'
      await writeFile(join(contextTreeDir, relPath), MARKDOWN_WITH_SCORING, 'utf8')
      const archiveResult = await isolated.archiveEntry(relPath, agent, testDir)

      // Restore must not throw even though sidecar.set rejects.
      const restored = await isolated.restoreEntry(archiveResult.stubPath, testDir)
      expect(restored).to.equal(relPath)
    })
  })
})
