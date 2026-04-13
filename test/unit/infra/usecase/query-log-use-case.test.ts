import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {QueryLogEntry} from '../../../../src/server/core/domain/entities/query-log-entry.js'
import type {IQueryLogStore} from '../../../../src/server/core/interfaces/storage/i-query-log-store.js'

import {QueryLogUseCase} from '../../../../src/server/infra/usecase/query-log-use-case.js'

// ============================================================================
// Helpers
// ============================================================================

type ProcessingEntry = Extract<QueryLogEntry, {status: 'processing'}>
type CompletedEntry = Extract<QueryLogEntry, {status: 'completed'}>
type ErrorEntry = Extract<QueryLogEntry, {status: 'error'}>
type CancelledEntry = Extract<QueryLogEntry, {status: 'cancelled'}>

function makeProcessingEntry(overrides: Partial<ProcessingEntry> = {}): ProcessingEntry {
  return {
    id: 'qry-1712345678901',
    matchedDocs: [],
    query: 'How is auth implemented?',
    startedAt: 1_712_345_678_901,
    status: 'processing',
    taskId: 'task-1',
    tier: 0,
    ...overrides,
  }
}

function makeCompletedEntry(overrides: Partial<CompletedEntry> = {}): CompletedEntry {
  return {
    completedAt: 1_712_345_678_913,
    id: 'qry-1712345678901',
    matchedDocs: [
      {path: 'authentication/oauth_flow.md', score: 0.92, title: 'OAuth Flow'},
      {path: 'authentication/token_storage.md', score: 0.87, title: 'Token Storage'},
    ],
    query: 'How is user authentication implemented?',
    response: 'Based on the curated knowledge, authentication uses OAuth2 with JWT tokens.',
    searchMetadata: {
      cacheFingerprint: 'a1b2c3d4e5f6g7h8',
      resultCount: 2,
      topScore: 0.92,
      totalFound: 5,
    },
    startedAt: 1_712_345_678_901,
    status: 'completed',
    taskId: 'task-2',
    tier: 0,
    ...overrides,
  }
}

function makeErrorEntry(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    completedAt: 1_712_345_679_000,
    error: 'Search index unavailable',
    id: 'qry-1712345678700',
    matchedDocs: [],
    query: 'show me the deployment flow',
    startedAt: 1_712_345_678_700,
    status: 'error',
    taskId: 'task-3',
    tier: 2,
    ...overrides,
  }
}

function makeCancelledEntry(overrides: Partial<CancelledEntry> = {}): CancelledEntry {
  return {
    completedAt: 1_712_345_679_500,
    id: 'qry-1712345678500',
    matchedDocs: [],
    query: 'explain the auth module',
    startedAt: 1_712_345_678_500,
    status: 'cancelled',
    taskId: 'task-4',
    tier: 1,
    ...overrides,
  }
}

function makeStore(sandbox: SinonSandbox): IQueryLogStore & {
  getById: SinonStub
  getNextId: SinonStub
  list: SinonStub
  save: SinonStub
} {
  return {
    getById: sandbox.stub().resolves(),
    getNextId: sandbox.stub().resolves('qry-9999'),
    list: sandbox.stub().resolves([]),
    save: sandbox.stub().resolves(),
  }
}

describe('QueryLogUseCase', () => {
  let sandbox: SinonSandbox
  let store: ReturnType<typeof makeStore>
  let logs: string[]
  let useCase: QueryLogUseCase

  beforeEach(() => {
    sandbox = createSandbox()
    store = makeStore(sandbox)
    logs = []
    useCase = new QueryLogUseCase({
      queryLogStore: store,
      terminal: {
        log(msg?: string) {
          logs.push(msg ?? '')
        },
      },
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  // ==========================================================================
  // List mode (no id)
  // ==========================================================================

  describe('list mode', () => {
    // Test 1: List with entries shows aligned table
    it('should show aligned table with ID, Tier, Status, Time, Query columns', async () => {
      store.list.resolves([makeCompletedEntry()])
      await useCase.run({})

      const output = logs.join('\n')
      expect(output).to.include('ID')
      expect(output).to.include('Tier')
      expect(output).to.include('Status')
      expect(output).to.include('Time')
      expect(output).to.include('Query')
      expect(output).to.include('qry-1712345678901')
      expect(output).to.include('T0')
      expect(output).to.include('completed')
      expect(output).to.include('12ms')
    })

    // Test 2: Empty list shows message
    it('should show empty state message when no entries', async () => {
      store.list.resolves([])
      await useCase.run({})

      expect(logs.join('\n')).to.include('No query log entries found.')
    })

    // Test 3: Empty list + filters shows filter-specific message
    it('should show filter-specific empty message when no entries match filters', async () => {
      store.list.resolves([])
      await useCase.run({status: ['completed']})

      expect(logs.join('\n')).to.include('No query log entries found matching your filters.')
    })

    // Test 4: Query text truncated at 40 chars
    it('should truncate query text at 40 chars in list view', async () => {
      const longQuery = 'This is a very long query that exceeds forty characters limit for display'
      store.list.resolves([makeCompletedEntry({query: longQuery})])
      await useCase.run({})

      const output = logs.join('\n')
      // First 40 chars: "This is a very long query that exceeds f" + "..."
      expect(output).to.include('This is a very long query that exceeds f...')
      expect(output).to.not.include(longQuery)
    })

    // Test 5: JSON format outputs valid JSON
    it('should output valid JSON with all fields', async () => {
      store.list.resolves([makeCompletedEntry()])
      await useCase.run({format: 'json'})

      const output = logs.join('\n')
      const parsed = JSON.parse(output)
      expect(parsed.command).to.equal('query view')
      expect(parsed.success).to.be.true
      expect(Array.isArray(parsed.data)).to.be.true
      expect(parsed.retrievedAt).to.be.a('string')
    })

    // Test 6: Tier filter passed through to store
    it('should pass tier filter to store.list', async () => {
      await useCase.run({tier: [0, 1]})
      expect(store.list.calledWith({limit: 10, tier: [0, 1]})).to.be.true
    })

    // Test 7: Status filter passed through to store
    it('should pass status filter to store.list', async () => {
      await useCase.run({status: ['completed', 'error']})
      expect(store.list.calledWith({limit: 10, status: ['completed', 'error']})).to.be.true
    })

    // Test 8: Time filters passed through to store
    it('should pass after and before filters to store.list', async () => {
      const after = 1_700_000_000_000
      const before = 1_700_000_001_000
      await useCase.run({after, before})
      expect(store.list.calledWith({after, before, limit: 10})).to.be.true
    })

    // Test 9: Limit passed through to store
    it('should pass limit to store.list', async () => {
      await useCase.run({limit: 5})
      expect(store.list.calledWith({limit: 5})).to.be.true
    })

    // Test: Error entries show duration for Time in list view (completedAt - startedAt fallback)
    it('should show duration for Time column on error entries', async () => {
      store.list.resolves([makeErrorEntry()])
      await useCase.run({})

      const output = logs.join('\n')
      expect(output).to.include('T2')
      expect(output).to.include('error')
      expect(output).to.include('300ms')
    })

    // Test: Cancelled entries show duration for Time in list view (completedAt - startedAt fallback)
    it('should show duration for Time column on cancelled entries', async () => {
      store.list.resolves([makeCancelledEntry()])
      await useCase.run({})

      const output = logs.join('\n')
      expect(output).to.include('T1')
      expect(output).to.include('cancelled')
      expect(output).to.include('1.0s')
    })
  })

  // ==========================================================================
  // Detail mode (with id)
  // ==========================================================================

  describe('detail mode', () => {
    // Test 10: Detail shows all fields for completed entry
    it('should show all fields for completed entry', async () => {
      store.getById.resolves(makeCompletedEntry())
      await useCase.run({id: 'qry-1712345678901'})

      const output = logs.join('\n')
      expect(output).to.include('qry-1712345678901')
      expect(output).to.include('completed')
      expect(output).to.include('0 (exact cache hit)')
      expect(output).to.include('How is user authentication implemented?')
      expect(output).to.include('authentication/oauth_flow.md')
      expect(output).to.include('[0.92]')
      expect(output).to.include('authentication/token_storage.md')
      expect(output).to.include('[0.87]')
      expect(output).to.include('a1b2c3d4e5f6g7h8')
      expect(output).to.include('Based on the curated knowledge')
    })

    // Test 11: Detail shows error message for error entry
    it('should show error message for error entry', async () => {
      store.getById.resolves(makeErrorEntry())
      await useCase.run({id: 'qry-1712345678700'})

      const output = logs.join('\n')
      expect(output).to.include('Error: Search index unavailable')
    })

    // Test: Cancelled entry in detail shows Finished and Duration (completedAt - startedAt fallback)
    it('should show Finished and Duration for cancelled entry', async () => {
      store.getById.resolves(makeCancelledEntry())
      await useCase.run({id: 'qry-1712345678500'})

      const output = logs.join('\n')
      expect(output).to.include('cancelled')
      expect(output).to.include('Finished:')
      expect(output).to.include('Duration: 1.0s')
    })

    // Test: Error entry in detail shows Finished and Duration (completedAt - startedAt fallback)
    it('should show Finished and Duration for error entry', async () => {
      store.getById.resolves(makeErrorEntry())
      await useCase.run({id: 'qry-1712345678700'})

      const output = logs.join('\n')
      expect(output).to.include('Finished:')
      expect(output).to.include('Duration: 300ms')
    })

    // Test 12: Non-existent ID shows not-found message
    it('should show not-found message for non-existent ID', async () => {
      store.getById.resolves()
      await useCase.run({id: 'qry-missing'})

      expect(logs.join('\n')).to.include('No query log entry found with ID: qry-missing')
    })

    // Test 13: Duration formatted correctly
    it('should format duration correctly: ms for <1s, seconds for >=1s, dash for missing', async () => {
      // 12ms duration
      store.getById.resolves(
        makeCompletedEntry({
          completedAt: 1_712_345_678_913,
          startedAt: 1_712_345_678_901,
        }),
      )
      await useCase.run({id: 'qry-1712345678901'})

      let output = logs.join('\n')
      expect(output).to.include('12ms')

      // 3.2s duration
      logs = []
      store.getById.resolves(
        makeCompletedEntry({
          completedAt: 1_712_345_682_101,
          startedAt: 1_712_345_678_901,
        }),
      )
      await useCase.run({id: 'qry-1712345678901'})

      output = logs.join('\n')
      expect(output).to.include('3.2s')

      // processing (no completedAt) → no Finished line
      logs = []
      store.getById.resolves(makeProcessingEntry())
      await useCase.run({id: 'qry-1712345678901'})

      output = logs.join('\n')
      expect(output).to.not.include('Finished')
    })

    // Test 14: Matched docs displayed with scores
    it('should display matched docs with scores in detail view', async () => {
      store.getById.resolves(makeCompletedEntry())
      await useCase.run({id: 'qry-1712345678901'})

      const output = logs.join('\n')
      expect(output).to.include('[0.92] authentication/oauth_flow.md')
      expect(output).to.include('[0.87] authentication/token_storage.md')
    })

    // Test 15: Response truncated at 500 chars
    it('should truncate response at 500 chars in detail view', async () => {
      const longResponse = 'A'.repeat(600)
      store.getById.resolves(makeCompletedEntry({response: longResponse}))
      await useCase.run({id: 'qry-1712345678901'})

      const output = logs.join('\n')
      expect(output).to.include('A'.repeat(500) + '...')
      expect(output).to.not.include('A'.repeat(501))
    })
  })
})
