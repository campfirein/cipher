import {expect} from 'chai'

import type {HtmlWriteResult} from '../../../../src/server/infra/render/writer/html-writer.js'

import {buildCurateHtmlLogEntry} from '../../../../src/server/infra/process/curate-html-log.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SUCCESS: HtmlWriteResult = {
  filePath: '/project/.brv/context-tree/security/auth.html',
  ok: true,
  written: '<bv-topic path="security/auth"></bv-topic>',
}

const FAILURE: HtmlWriteResult = {
  errors: [
    {kind: 'missing-bv-topic', message: 'Curate output must contain exactly one <bv-topic> root.'},
  ],
  ok: false,
}

function baseInput() {
  return {
    completedAt: 1_700_000_010_000,
    confirmOverwrite: false,
    existedBefore: false,
    // Absolute path — mirrors what writeHtmlTopic returns. Review-handler
    // and dream-executor both treat `op.filePath` as absolute.
    filePath: '/project/.brv/context-tree/security/auth.html',
    id: 'cur-1700000000000',
    reviewDisabled: false,
    startedAt: 1_700_000_000_000,
    taskId: 'task-abc',
    topicPath: 'security/auth',
    writeResult: SUCCESS,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildCurateHtmlLogEntry', () => {
  describe('success with meta.impact = high', () => {
    it('sets needsReview = true and reviewStatus = pending when reviewDisabled = false', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        meta: {impact: 'high', reason: 'Locks JWT alg.', summary: 'JWT RS256.', type: 'ADD'},
      })

      expect(entry.status).to.equal('completed')
      expect(entry.operations).to.have.lengthOf(1)
      const op = entry.operations[0]
      expect(op.needsReview).to.equal(true)
      expect(op.reviewStatus).to.equal('pending')
      expect(op.impact).to.equal('high')
      expect(op.type).to.equal('ADD')
      expect(op.reason).to.equal('Locks JWT alg.')
      expect(op.summary).to.equal('JWT RS256.')
      expect(op.status).to.equal('success')
    })

    it('suppresses needsReview when reviewDisabled = true', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        meta: {impact: 'high', type: 'ADD'},
        reviewDisabled: true,
      })

      const op = entry.operations[0]
      expect(op.needsReview).to.equal(false)
      expect(op.reviewStatus).to.be.undefined
      expect(op.impact).to.equal('high')
    })
  })

  describe('success with meta.impact = low', () => {
    it('sets needsReview = false and omits reviewStatus', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        meta: {impact: 'low', type: 'UPDATE'},
      })

      const op = entry.operations[0]
      expect(op.needsReview).to.equal(false)
      expect(op.reviewStatus).to.be.undefined
      expect(op.impact).to.equal('low')
    })
  })

  describe('success without meta', () => {
    it('falls back to writer-derived type and omits impact / needsReview', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput()})

      const op = entry.operations[0]
      expect(op.type).to.equal('ADD') // existedBefore: false → ADD
      expect(op.impact).to.be.undefined
      expect(op.needsReview).to.be.undefined
      expect(op.reviewStatus).to.be.undefined
      expect(op.reason).to.be.undefined
    })
  })

  describe('type derivation', () => {
    it('defaults to UPDATE when existedBefore = true and confirmOverwrite = true, no meta.type', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput(), confirmOverwrite: true, existedBefore: true})
      expect(entry.operations[0].type).to.equal('UPDATE')
    })

    it('defaults to ADD when existedBefore = true but confirmOverwrite = false', () => {
      // existedBefore + confirmOverwrite=false is a writer "path-exists" failure scenario;
      // type fallback only treats it as UPDATE when overwrite was confirmed.
      const entry = buildCurateHtmlLogEntry({...baseInput(), confirmOverwrite: false, existedBefore: true})
      expect(entry.operations[0].type).to.equal('ADD')
    })

    it('lets agent-asserted meta.type win over writer fallback (MERGE)', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        confirmOverwrite: true,
        existedBefore: true,
        meta: {type: 'MERGE'},
      })
      expect(entry.operations[0].type).to.equal('MERGE')
    })

    it('lets agent-asserted meta.type win over writer fallback (ADD on UPDATE-ish state)', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        confirmOverwrite: true,
        existedBefore: true,
        meta: {type: 'ADD'},
      })
      expect(entry.operations[0].type).to.equal('ADD')
    })
  })

  describe('failure path', () => {
    it('returns error entry with failed operation and preserves error message', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput(), writeResult: FAILURE})

      expect(entry.status).to.equal('error')
      if (entry.status !== 'error') throw new Error('unreachable')
      expect(entry.error).to.contain('missing-bv-topic')

      expect(entry.operations).to.have.lengthOf(1)
      const op = entry.operations[0]
      expect(op.status).to.equal('failed')
      expect(op.needsReview).to.equal(false)
      expect(op.reviewStatus).to.be.undefined
      expect(op.message).to.contain('Curate output must contain exactly one')
    })

    it('uses sentinel path on failure when topicPath is unknown', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        topicPath: undefined,
        writeResult: FAILURE,
      })
      expect(entry.operations[0].path).to.equal('<unknown>')
    })

    it('failed entry still includes meta.impact when present (telemetry) but does not surface for review', () => {
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        meta: {impact: 'high', type: 'ADD'},
        writeResult: FAILURE,
      })

      const op = entry.operations[0]
      expect(op.status).to.equal('failed')
      expect(op.needsReview).to.equal(false)
      expect(op.reviewStatus).to.be.undefined
    })
  })

  describe('filePath convention (regression — see review-handler contract)', () => {
    it('preserves the caller-supplied absolute filePath verbatim on the operation', () => {
      // review-handler.ts:117 + dream-executor convention: op.filePath is
      // absolute. The handler does `relative(contextTreeDir, op.filePath)`
      // to derive its display key — passing a relative path produces a
      // garbage key and `brv review approve <taskId>` silently no-ops.
      const entry = buildCurateHtmlLogEntry({
        ...baseInput(),
        filePath: '/abs/.brv/context-tree/x/y.html',
        meta: {impact: 'high', type: 'ADD'},
      })
      expect(entry.operations[0].filePath).to.equal('/abs/.brv/context-tree/x/y.html')
    })
  })

  describe('entry shape', () => {
    it('includes startedAt, completedAt, taskId, id, format = html', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput()})

      expect(entry.id).to.equal('cur-1700000000000')
      expect(entry.taskId).to.equal('task-abc')
      expect(entry.startedAt).to.equal(1_700_000_000_000)
      expect(entry.format).to.equal('html')
      if (entry.status !== 'completed') throw new Error('expected completed')
      expect(entry.completedAt).to.equal(1_700_000_010_000)
    })

    it('threads intent into input.context', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput(), intent: 'remember JWT decision'})
      expect(entry.input.context).to.equal('remember JWT decision')
    })

    it('falls back to a sentinel intent when none supplied', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput()})
      expect(entry.input.context).to.be.a('string').and.not.equal('')
    })

    it('computes summary from operations (success ADD increments added)', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput(), meta: {type: 'ADD'}})
      expect(entry.summary.added).to.equal(1)
      expect(entry.summary.failed).to.equal(0)
    })

    it('computes summary from operations (failure increments failed)', () => {
      const entry = buildCurateHtmlLogEntry({...baseInput(), writeResult: FAILURE})
      expect(entry.summary.failed).to.equal(1)
      expect(entry.summary.added).to.equal(0)
    })
  })
})
