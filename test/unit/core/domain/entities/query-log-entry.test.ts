import {expect} from 'chai'

import type {QueryLogEntry, QueryLogMatchedDoc, QueryLogSearchMetadata, QueryLogStatus, QueryLogTier} from '../../../../../src/server/core/domain/entities/query-log-entry.js'

import {QUERY_LOG_STATUSES, QUERY_LOG_TIER_LABELS, QUERY_LOG_TIERS} from '../../../../../src/server/core/domain/entities/query-log-entry.js'

// ============================================================================
// Type-level compile checks — if this file compiles, the types are correct.
// ============================================================================

const processingEntry: QueryLogEntry = {
  id: 'qry-1000',
  matchedDocs: [],
  query: 'test query',
  startedAt: 1_700_000_000_000,
  status: 'processing',
  taskId: 'task-1',
}

const completedEntry: QueryLogEntry = {
  completedAt: 1_700_000_001_000,
  id: 'qry-1001',
  matchedDocs: [{path: 'doc.md', score: 0.9, title: 'Doc'}],
  query: 'test query',
  response: 'answer',
  searchMetadata: {resultCount: 1, topScore: 0.9, totalFound: 5},
  startedAt: 1_700_000_000_000,
  status: 'completed',
  taskId: 'task-2',
  tier: 0,
}

const errorEntry: QueryLogEntry = {
  completedAt: 1_700_000_001_000,
  error: 'Something broke',
  id: 'qry-1002',
  matchedDocs: [],
  query: 'test query',
  startedAt: 1_700_000_000_000,
  status: 'error',
  taskId: 'task-3',
}

const cancelledEntry: QueryLogEntry = {
  completedAt: 1_700_000_001_000,
  id: 'qry-1003',
  matchedDocs: [],
  query: 'test query',
  startedAt: 1_700_000_000_000,
  status: 'cancelled',
  taskId: 'task-4',
}

// ============================================================================
// Runtime tests
// ============================================================================

describe('QueryLogEntry', () => {
  describe('discriminated union narrowing', () => {
    it('should narrow error entry to access entry.error', () => {
      const entry: QueryLogEntry = errorEntry
      if (entry.status === 'error') {
        // TypeScript narrows: entry.error is accessible
        expect(entry.error).to.equal('Something broke')
      }
    })

    it('should narrow processing entry without completedAt', () => {
      const entry: QueryLogEntry = processingEntry
      if (entry.status === 'processing') {
        // TypeScript narrows: completedAt does NOT exist
        expect(entry).to.not.have.property('completedAt')
      }
    })

    it('should narrow completed entry to access completedAt and response', () => {
      const entry: QueryLogEntry = completedEntry
      if (entry.status === 'completed') {
        expect(entry.completedAt).to.be.a('number')
        expect(entry.response).to.equal('answer')
      }
    })

    it('should narrow cancelled entry to access completedAt', () => {
      const entry: QueryLogEntry = cancelledEntry
      if (entry.status === 'cancelled') {
        expect(entry.completedAt).to.be.a('number')
      }
    })
  })

  describe('base fields available on all variants', () => {
    it('should have id, query, startedAt, matchedDocs, taskId on all entries', () => {
      const entries: QueryLogEntry[] = [processingEntry, completedEntry, errorEntry, cancelledEntry]
      for (const entry of entries) {
        expect(entry.id).to.be.a('string')
        expect(entry.query).to.be.a('string')
        expect(entry.startedAt).to.be.a('number')
        expect(entry.matchedDocs).to.be.an('array')
        expect(entry.taskId).to.be.a('string')
      }
    })

    it('should allow optional tier on all entries', () => {
      expect(processingEntry.tier).to.be.undefined
      expect(completedEntry.tier).to.equal(0)
    })

    it('should allow optional searchMetadata on all entries', () => {
      expect(processingEntry.searchMetadata).to.be.undefined
      expect(completedEntry.searchMetadata).to.have.property('resultCount')
    })

    it('should allow optional timing on all entries', () => {
      expect(processingEntry.timing).to.be.undefined
    })
  })

  describe('exported constants', () => {
    it('should export QUERY_LOG_TIERS as [0,1,2,3,4]', () => {
      expect([...QUERY_LOG_TIERS]).to.deep.equal([0, 1, 2, 3, 4])
    })

    it('should export QUERY_LOG_STATUSES with all 4 statuses', () => {
      expect([...QUERY_LOG_STATUSES]).to.deep.equal(['cancelled', 'completed', 'error', 'processing'])
    })

    it('should export QUERY_LOG_TIER_LABELS for all tiers', () => {
      expect(QUERY_LOG_TIER_LABELS[0]).to.equal('exact cache hit')
      expect(QUERY_LOG_TIER_LABELS[4]).to.equal('full agentic')
    })
  })

  describe('exported types compile', () => {
    it('should allow QueryLogMatchedDoc with title', () => {
      const doc: QueryLogMatchedDoc = {path: 'test.md', score: 0.5, title: 'Test'}
      expect(doc.title).to.equal('Test')
    })

    it('should allow QueryLogSearchMetadata with resultCount and totalFound', () => {
      const meta: QueryLogSearchMetadata = {resultCount: 2, topScore: 0.9, totalFound: 10}
      expect(meta.resultCount).to.equal(2)
      expect(meta.totalFound).to.equal(10)
    })

    it('should derive QueryLogTier from QUERY_LOG_TIERS', () => {
      const tier: QueryLogTier = 3
      expect(tier).to.equal(3)
    })

    it('should derive QueryLogStatus from QUERY_LOG_STATUSES', () => {
      const status: QueryLogStatus = 'completed'
      expect(status).to.equal('completed')
    })
  })
})
