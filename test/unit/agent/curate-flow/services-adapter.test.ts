/**
 * Phase 2.5 R-3 — buildReason envelope (PHASE-2.5-PLAN.md §3.4).
 *
 * Asserts the Phase 3 UAT-target Reason shape:
 *   Curated from cur-<id> on <ts> via <type>:"<source>"; subject "<x>" [<cat>] inferred from "<preview>".
 *
 * Critical contract: the envelope MUST always be emitted, even when the
 * conflict-decision provides its own `d.reason` (UPDATE case). The
 * pre-fix bypass (`if (d.reason) return d.reason`) silently dropped
 * provenance for UPDATE rows — exactly the rows where audit trail
 * matters most. See PHASE-2.5-PLAN review P2.
 */

import {expect} from 'chai'

import {buildReason} from '../../../../src/agent/infra/curation/flow/services-adapter.js'

const PROVENANCE_TEXT = {name: 'cli-text', type: 'text' as const}
const PROVENANCE_FILE = {name: 'package.json', type: 'file' as const}

describe('buildReason (R-3 provenance envelope)', () => {
  describe('ADD decisions (no d.reason)', () => {
    it('emits envelope-only when d.reason is undefined', () => {
      const reason = buildReason(
        {action: 'add', fact: {category: 'project', statement: 'JWT tokens expire after 24 hours', subject: 'jwt_expiry'}},
        'task-uuid-1',
        'cur-1777347876578',
        PROVENANCE_TEXT,
      )
      expect(reason).to.include('cur-1777347876578')
      expect(reason).to.include('text:"cli-text"')
      expect(reason).to.include('"jwt_expiry"')
      expect(reason).to.include('[project]')
      expect(reason).to.include('JWT tokens expire after 24 hours')
      expect(reason, 'no Decision: appendix when d.reason absent').to.not.include('Decision:')
    })

    it('uses cur-<logId> as the correlation id when present (preferred over taskId)', () => {
      const reason = buildReason(
        {action: 'add', fact: {statement: 's', subject: 'auth'}},
        'task-uuid-fallback',
        'cur-1777347876578',
        PROVENANCE_TEXT,
      )
      expect(reason).to.include('cur-1777347876578')
      expect(reason, 'taskId UUID must NOT appear when logId is present').to.not.include('task-uuid-fallback')
    })

    it('falls back to taskId when logId is undefined (test fixtures, non-router paths)', () => {
      const reason = buildReason(
        {action: 'add', fact: {statement: 's', subject: 'auth'}},
        'task-uuid-fallback',
        undefined,
        PROVENANCE_TEXT,
      )
      expect(reason).to.include('task-uuid-fallback')
    })

    it('handles missing subject and category with sensible placeholders', () => {
      const reason = buildReason(
        {action: 'add', fact: {statement: 'some content'}},
        'task-1',
        undefined,
        PROVENANCE_TEXT,
      )
      expect(reason).to.include('<unknown>')
      expect(reason).to.include('[uncategorized]')
    })

    it('uses provenance.type=file when source is a file', () => {
      const reason = buildReason(
        {action: 'add', fact: {statement: 's', subject: 'a'}},
        'task-1',
        undefined,
        PROVENANCE_FILE,
      )
      expect(reason).to.include('file:"package.json"')
    })

    it('truncates long statements at 80 chars in the input quote', () => {
      const longStatement = 'a'.repeat(200)
      const reason = buildReason(
        {action: 'add', fact: {statement: longStatement, subject: 'a'}},
        'task-1',
        undefined,
        PROVENANCE_TEXT,
      )
      // input quote should be at most 80 chars between the surrounding quotes
      const quoteMatch = reason.match(/inferred from "([^"]+)"/)
      expect(quoteMatch).to.exist
      expect(quoteMatch![1].length).to.be.at.most(80)
    })
  })

  describe('UPDATE decisions (d.reason present — appended INSIDE envelope, NOT bypassing it)', () => {
    it('emits envelope AND appends d.reason as Decision: ... (P2 fix)', () => {
      const reason = buildReason(
        {
          action: 'update',
          fact: {category: 'project', statement: 'JWT tokens stored in httpOnly cookies', subject: 'jwt_storage'},
          reason: 'subject "jwt_storage" already present at project/jwt_token_expiry/jwt_tokens_expire_after_24_hours.md',
        },
        'task-uuid',
        'cur-1777347889041',
        PROVENANCE_TEXT,
      )

      // Envelope must still be present (this was the P2 bug: pre-fix UPDATE
      // returned d.reason directly, omitting the envelope entirely).
      expect(reason, 'envelope must be present for UPDATE').to.include('cur-1777347889041')
      expect(reason, 'envelope must be present for UPDATE').to.include('"jwt_storage"')
      expect(reason, 'envelope must be present for UPDATE').to.include('[project]')

      // d.reason must be appended as Decision: ...
      expect(reason).to.include('Decision: subject "jwt_storage" already present at')
    })

    it('orders envelope FIRST, then Decision rationale', () => {
      const reason = buildReason(
        {action: 'update', fact: {category: 'project', statement: 's', subject: 'a'}, reason: 'rationale-text'},
        'task-1',
        'cur-1',
        PROVENANCE_TEXT,
      )
      const envelopeIdx = reason.indexOf('cur-1')
      const decisionIdx = reason.indexOf('Decision:')
      expect(envelopeIdx).to.be.greaterThan(-1)
      expect(decisionIdx).to.be.greaterThan(-1)
      expect(envelopeIdx, 'envelope first').to.be.lessThan(decisionIdx)
    })
  })
})
