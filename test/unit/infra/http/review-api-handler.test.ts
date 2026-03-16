import type {Server} from 'node:http'

import {expect} from 'chai'
import express from 'express'

import type {CurateLogEntry} from '../../../../src/server/core/domain/entities/curate-log-entry.js'
import type {ICurateLogStore} from '../../../../src/server/core/interfaces/storage/i-curate-log-store.js'
import type {IReviewBackupStore} from '../../../../src/server/core/interfaces/storage/i-review-backup-store.js'

import {createReviewApiRouter} from '../../../../src/server/infra/http/review-api-handler.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_PATH = '/test/project'
const PROJECT_ENCODED = Buffer.from(PROJECT_PATH).toString('base64url')

function makeEntry(overrides: Partial<CurateLogEntry> = {}): CurateLogEntry {
  const base = {
    completedAt: Date.now(),
    id: 'cur-1000',
    input: {},
    operations: [],
    response: 'done',
    startedAt: Date.now() - 1000,
    status: 'completed' as const,
    summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
    taskId: 'task-1',
  }
  return {...base, ...overrides} as CurateLogEntry
}

function makeStore(entries: CurateLogEntry[] = []): ICurateLogStore {
  const data = new Map(entries.map((e) => [e.id, structuredClone(e)]))
  return {
    async batchUpdateOperationReviewStatus(logId, updates) {
      const entry = data.get(logId)
      if (!entry) return false
      for (const {operationIndex, reviewStatus} of updates) {
        if (operationIndex >= 0 && operationIndex < entry.operations.length) {
          entry.operations[operationIndex].reviewStatus = reviewStatus
        }
      }

      return true
    },
    async getById(id) {
      return data.get(id) ?? null
    },
    async getNextId() {
      return `cur-${Date.now()}`
    },
    async list() {
      return [...data.values()]
    },
    async save(entry) {
      data.set(entry.id, structuredClone(entry))
    },
  }
}

function makeBackupStore(backups: Record<string, string> = {}): IReviewBackupStore {
  const data = new Map(Object.entries(backups))
  return {
    async clear() {
      data.clear()
    },
    async delete(path) {
      data.delete(path)
    },
    async has(path) {
      return data.has(path)
    },
    async read(path) {
      return data.get(path) ?? null
    },
    async save(path, content) {
      if (!data.has(path)) data.set(path, content)
    },
  }
}

type ContextTreeFs = {
  deleteFile: (path: string) => Promise<void>
  files: Map<string, string>
  writeFile: (path: string, content: string) => Promise<void>
}

function makeContextTreeFs(): ContextTreeFs {
  const files = new Map<string, string>()
  return {
    async deleteFile(path: string) {
      files.delete(path)
    },
    files,
    async writeFile(path: string, content: string) {
      files.set(path, content)
    },
  }
}

function startTestServer(opts: {
  backups?: Record<string, string>
  entries?: CurateLogEntry[]
}): Promise<{
  backupStore: IReviewBackupStore
  contextTreeFs: ContextTreeFs
  port: number
  server: Server
  store: ICurateLogStore
}> {
  const store = makeStore(opts.entries ?? [])
  const backupStore = makeBackupStore(opts.backups ?? {})
  const contextTreeFs = makeContextTreeFs()
  const app = express()
  app.use(createReviewApiRouter({
    contextTreeFs,
    curateLogStoreFactory: () => store,
    reviewBackupStoreFactory: () => backupStore,
  }))

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({backupStore, contextTreeFs, port, server, store})
    })
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('review-api-handler', () => {
  let server: Server | undefined

  afterEach(() => {
    if (server) {
      server.close()
      server = undefined
    }
  })

  // ── GET /review ──────────────────────────────────────────────────────────

  describe('GET /review', () => {
    it('should serve the review UI HTML page', async () => {
      const result = await startTestServer({})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/review`)
      expect(res.status).to.equal(200)
      expect(res.headers.get('content-type')).to.include('html')

      const body = await res.text()
      expect(body).to.include('ByteRover Review')
      expect(body).to.include('<!DOCTYPE html>')
    })
  })

  // ── GET /api/review/pending ──────────────────────────────────────────────

  describe('GET /api/review/pending', () => {
    it('should return 400 when project parameter is missing', async () => {
      const result = await startTestServer({})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/pending`)
      expect(res.status).to.equal(400)
    })

    it('should return empty files array when no pending reviews exist', async () => {
      const entry = makeEntry({
        operations: [
          {path: 'auth/jwt', status: 'success', type: 'ADD'},
        ],
      })
      const result = await startTestServer({entries: [entry]})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://127.0.0.1:${result.port}/api/review/pending?project=${PROJECT_ENCODED}`,
      )
      expect(res.status).to.equal(200)
      const body = await res.json() as {files: unknown[]}
      expect(body.files).to.deep.equal([])
    })

    it('should return files with pending review operations', async () => {
      const entry = makeEntry({
        operations: [
          {
            confidence: 'low',
            filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
            impact: 'high',
            needsReview: true,
            path: 'auth/jwt',
            reason: 'uncertain',
            reviewStatus: 'pending',
            status: 'success',
            type: 'UPDATE',
          },
          {
            filePath: `${PROJECT_PATH}/.brv/context-tree/api/rest.md`,
            path: 'api/rest',
            status: 'success',
            type: 'ADD',
          },
        ],
      })
      const result = await startTestServer({entries: [entry]})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://127.0.0.1:${result.port}/api/review/pending?project=${PROJECT_ENCODED}`,
      )
      expect(res.status).to.equal(200)
      const body = await res.json() as {files: {operations: unknown[]; path: string}[]}
      expect(body.files).to.have.lengthOf(1)
      expect(body.files[0].path).to.equal('auth/jwt.md')
      expect(body.files[0].operations).to.have.lengthOf(1)
    })

    it('should group operations by file path across multiple entries', async () => {
      const entries = [
        makeEntry({
          id: 'cur-1001',
          operations: [{
            filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'UPDATE',
          }],
        }),
        makeEntry({
          id: 'cur-1002',
          operations: [{
            filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'UPDATE',
          }],
        }),
      ]
      const result = await startTestServer({entries})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://127.0.0.1:${result.port}/api/review/pending?project=${PROJECT_ENCODED}`,
      )
      const body = await res.json() as {files: {operations: unknown[]; path: string}[]}
      expect(body.files).to.have.lengthOf(1)
      expect(body.files[0].operations).to.have.lengthOf(2)
    })
  })

  // ── GET /api/review/diff ─────────────────────────────────────────────────

  describe('GET /api/review/diff', () => {
    it('should return 400 when parameters are missing', async () => {
      const result = await startTestServer({})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/diff`)
      expect(res.status).to.equal(400)
    })

    it('should return old and new content for a file', async () => {
      const result = await startTestServer({
        backups: {'auth/jwt.md': '# Old Content\nOriginal text'},
      })
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://127.0.0.1:${result.port}/api/review/diff?project=${PROJECT_ENCODED}&path=auth/jwt.md`,
      )
      expect(res.status).to.equal(200)
      const body = await res.json() as {newContent: string; oldContent: string; path: string}
      expect(body.path).to.equal('auth/jwt.md')
      expect(body.oldContent).to.equal('# Old Content\nOriginal text')
      // newContent will be empty since we don't have a real context tree on disk
      expect(body.newContent).to.equal('')
    })

    it('should return empty oldContent when no backup exists', async () => {
      const result = await startTestServer({backups: {}})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(
        `http://127.0.0.1:${result.port}/api/review/diff?project=${PROJECT_ENCODED}&path=nonexistent.md`,
      )
      expect(res.status).to.equal(200)
      const body = await res.json() as {newContent: string; oldContent: string}
      expect(body.oldContent).to.equal('')
      expect(body.newContent).to.equal('')
    })
  })

  // ── POST /api/review/decide ──────────────────────────────────────────────

  describe('POST /api/review/decide', () => {
    it('should return 400 when required fields are missing', async () => {
      const result = await startTestServer({})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(res.status).to.equal(400)
    })

    it('should return 400 for invalid decision value', async () => {
      const result = await startTestServer({})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'maybe', path: 'auth/jwt.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(res.status).to.equal(400)
    })

    it('should approve all pending operations for a file', async () => {
      const entry = makeEntry({
        operations: [
          {
            filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'UPDATE',
          },
          {
            filePath: `${PROJECT_PATH}/.brv/context-tree/api/rest.md`,
            needsReview: true,
            path: 'api/rest',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ],
      })
      const result = await startTestServer({entries: [entry]})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'approved', path: 'auth/jwt.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(res.status).to.equal(200)
      const body = await res.json() as {success: boolean; updatedCount: number}
      expect(body.success).to.be.true
      expect(body.updatedCount).to.equal(1)

      // Verify the store was updated
      const updated = await result.store.getById('cur-1000')
      expect(updated?.operations[0].reviewStatus).to.equal('approved')
      expect(updated?.operations[1].reviewStatus).to.equal('pending') // different file, unchanged
    })

    it('should reject all pending operations for a file', async () => {
      const entry = makeEntry({
        operations: [
          {
            filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
            needsReview: true,
            path: 'auth/jwt',
            reviewStatus: 'pending',
            status: 'success',
            type: 'DELETE',
          },
        ],
      })
      const result = await startTestServer({entries: [entry]})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'auth/jwt.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(res.status).to.equal(200)
      const body = await res.json() as {success: boolean; updatedCount: number}
      expect(body.updatedCount).to.equal(1)

      const updated = await result.store.getById('cur-1000')
      expect(updated?.operations[0].reviewStatus).to.equal('rejected')
    })

    it('should return updatedCount=0 when no matching operations found', async () => {
      const result = await startTestServer({entries: []})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'approved', path: 'nonexistent.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      expect(res.status).to.equal(200)
      const body = await res.json() as {updatedCount: number}
      expect(body.updatedCount).to.equal(0)
    })

    it('should return reverted=false when approving', async () => {
      const entry = makeEntry({
        operations: [{
          filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'UPDATE',
        }],
      })
      const result = await startTestServer({
        backups: {'auth/jwt.md': '# Original'},
        entries: [entry],
      })
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'approved', path: 'auth/jwt.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean; success: boolean}
      expect(body.reverted).to.be.false
      expect(body.success).to.be.true

      // Backup cleared on approve so future modifications use the approved state as baseline
      expect(await result.backupStore.has('auth/jwt.md')).to.be.false
    })

    it('should restore backup content when rejecting an UPDATE', async () => {
      const entry = makeEntry({
        operations: [{
          filePath: `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`,
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'UPDATE',
        }],
      })
      const result = await startTestServer({
        backups: {'auth/jwt.md': '# Original Content'},
        entries: [entry],
      })
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'auth/jwt.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean; success: boolean; updatedCount: number}
      expect(body.success).to.be.true
      expect(body.reverted).to.be.true
      expect(body.updatedCount).to.equal(1)

      // Verify file was restored in context tree
      const expectedPath = `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`
      expect(result.contextTreeFs.files.get(expectedPath)).to.equal('# Original Content')

      // Verify review status was set to rejected
      const updated = await result.store.getById('cur-1000')
      expect(updated?.operations[0].reviewStatus).to.equal('rejected')

      // Verify backup was cleaned up
      expect(await result.backupStore.has('auth/jwt.md')).to.be.false
    })

    it('should restore backup content when rejecting a DELETE', async () => {
      const entry = makeEntry({
        operations: [{
          filePath: `${PROJECT_PATH}/.brv/context-tree/api/endpoints.md`,
          needsReview: true,
          path: 'api/endpoints',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        }],
      })
      const result = await startTestServer({
        backups: {'api/endpoints.md': '# Endpoints\nGET /api/v1/users'},
        entries: [entry],
      })
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'api/endpoints.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean}
      expect(body.reverted).to.be.true

      // Verify deleted file was restored
      const expectedPath = `${PROJECT_PATH}/.brv/context-tree/api/endpoints.md`
      expect(result.contextTreeFs.files.get(expectedPath)).to.equal('# Endpoints\nGET /api/v1/users')
    })

    it('should delete file when rejecting an ADD (no backup exists)', async () => {
      const entry = makeEntry({
        operations: [{
          filePath: `${PROJECT_PATH}/.brv/context-tree/new-feature.md`,
          needsReview: true,
          path: 'new-feature',
          reviewStatus: 'pending',
          status: 'success',
          type: 'ADD',
        }],
      })
      const result = await startTestServer({
        entries: [entry],
      })
      server = result.server

      // Pre-populate the context tree file (simulating the ADD created it)
      const filePath = `${PROJECT_PATH}/.brv/context-tree/new-feature.md`
      result.contextTreeFs.files.set(filePath, '# New Feature\nContent')

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'new-feature.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean; updatedCount: number}
      expect(body.reverted).to.be.true
      expect(body.updatedCount).to.equal(1)

      // Verify file was deleted from context tree
      expect(result.contextTreeFs.files.has(filePath)).to.be.false
    })

    it('should restore source file when rejecting a MERGE', async () => {
      const targetFilePath = `${PROJECT_PATH}/.brv/context-tree/auth/jwt.md`
      const sourceFilePath = `${PROJECT_PATH}/.brv/context-tree/auth/old_token.md`
      const entry = makeEntry({
        operations: [{
          additionalFilePaths: [sourceFilePath],
          filePath: targetFilePath,
          needsReview: true,
          path: 'auth/jwt',
          reviewStatus: 'pending',
          status: 'success',
          type: 'MERGE',
        }],
      })
      const result = await startTestServer({
        backups: {
          'auth/jwt.md': '# JWT Target\nMerged content',
          'auth/old_token.md': '# Old Token\nOriginal source content',
        },
        entries: [entry],
      })
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'auth/jwt.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean; success: boolean; updatedCount: number}
      expect(body.success).to.be.true
      expect(body.reverted).to.be.true
      expect(body.updatedCount).to.equal(1)

      // Verify target file was restored
      expect(result.contextTreeFs.files.get(targetFilePath)).to.equal('# JWT Target\nMerged content')

      // Verify source file was restored from backup
      expect(result.contextTreeFs.files.get(sourceFilePath)).to.equal('# Old Token\nOriginal source content')

      // Verify both backups were cleaned up
      expect(await result.backupStore.has('auth/jwt.md')).to.be.false
      expect(await result.backupStore.has('auth/old_token.md')).to.be.false
    })

    it('should restore all individual files when rejecting a folder DELETE', async () => {
      const folderPath = `${PROJECT_PATH}/.brv/context-tree/api`
      const file1 = `${PROJECT_PATH}/.brv/context-tree/api/endpoints.md`
      const file2 = `${PROJECT_PATH}/.brv/context-tree/api/auth.md`
      const entry = makeEntry({
        operations: [{
          additionalFilePaths: [file1, file2],
          filePath: folderPath,
          needsReview: true,
          path: 'api',
          reviewStatus: 'pending',
          status: 'success',
          type: 'DELETE',
        }],
      })
      const result = await startTestServer({
        backups: {
          'api/auth.md': '# Auth\nOAuth flows',
          'api/endpoints.md': '# Endpoints\nGET /api/v1/users',
        },
        entries: [entry],
      })
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'api', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean; success: boolean; updatedCount: number}
      expect(body.success).to.be.true
      expect(body.reverted).to.be.true

      // Verify both files were restored
      expect(result.contextTreeFs.files.get(file1)).to.equal('# Endpoints\nGET /api/v1/users')
      expect(result.contextTreeFs.files.get(file2)).to.equal('# Auth\nOAuth flows')

      // Verify backups were cleaned up
      expect(await result.backupStore.has('api/endpoints.md')).to.be.false
      expect(await result.backupStore.has('api/auth.md')).to.be.false
    })

    it('should not revert when rejecting with no matching operations', async () => {
      const result = await startTestServer({entries: []})
      server = result.server

      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const res = await fetch(`http://127.0.0.1:${result.port}/api/review/decide`, {
        body: JSON.stringify({decision: 'rejected', path: 'nonexistent.md', project: PROJECT_ENCODED}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
      const body = await res.json() as {reverted: boolean; updatedCount: number}
      expect(body.reverted).to.be.false
      expect(body.updatedCount).to.equal(0)
    })
  })
})
