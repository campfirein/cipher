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
    async updateOperationReviewStatus(logId, operationIndex, reviewStatus) {
      const entry = data.get(logId)
      if (!entry) return false
      if (operationIndex < 0 || operationIndex >= entry.operations.length) return false
      entry.operations[operationIndex].reviewStatus = reviewStatus
      return true
    },
  }
}

function makeBackupStore(backups: Record<string, string> = {}): IReviewBackupStore {
  const data = new Map(Object.entries(backups))
  return {
    async clear() {
      data.clear()
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

function startTestServer(opts: {
  backups?: Record<string, string>
  entries?: CurateLogEntry[]
}): Promise<{port: number; server: Server; store: ICurateLogStore}> {
  const store = makeStore(opts.entries ?? [])
  const backupStore = makeBackupStore(opts.backups ?? {})
  const app = express()
  app.use(createReviewApiRouter({
    curateLogStoreFactory: () => store,
    reviewBackupStoreFactory: () => backupStore,
  }))

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({port, server, store})
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
  })
})
