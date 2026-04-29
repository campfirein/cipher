/**
 * Phase 2.5 R-2 — metadata derivers (PHASE-2.5-PLAN.md §3.3).
 *
 * Tests three pure-function helpers that populate `tags` / `keywords` /
 * `related` for curate operations, replacing the always-empty arrays
 * the Phase 3 UAT flagged on 86/86 leaf files.
 *
 * The helpers live in their own module (NOT scope-private inside
 * services-adapter.ts) per §3.3 P3a — direct import for tests is the
 * right boundary because the helpers are pure functions over plain
 * inputs with no infrastructure dependencies.
 */

import {expect} from 'chai'

import {
  deriveKeywords,
  deriveRelated,
  deriveRelatedFromResolved,
  deriveTags,
} from '../../../../src/agent/infra/curation/flow/metadata-derivers.js'

describe('metadata-derivers', () => {
  describe('deriveTags', () => {
    it('includes both category and subject as tags', () => {
      const tags = deriveTags({category: 'project', statement: 'X', subject: 'auth'})
      expect(tags).to.include('project')
      expect(tags).to.include('auth')
      expect(tags).to.have.length(2)
    })

    it('lowercases and dedupes when category and subject collide case-insensitively', () => {
      const tags = deriveTags({category: 'Project', statement: 'X', subject: 'project'})
      expect(tags).to.deep.equal(['project'])
    })

    it('returns empty array when both category and subject are missing', () => {
      expect(deriveTags({statement: 'X'})).to.deep.equal([])
    })

    it('returns just category when subject missing', () => {
      expect(deriveTags({category: 'project', statement: 'X'})).to.deep.equal(['project'])
    })
  })

  describe('deriveKeywords', () => {
    it('includes subject as the first keyword when present', () => {
      const kw = deriveKeywords({statement: 'JWT tokens expire after 24 hours', subject: 'jwt'})
      expect(kw[0]).to.equal('jwt')
    })

    it('filters out stop words and short (≤2 char) tokens', () => {
      const kw = deriveKeywords({statement: 'The cat is on the mat'})
      expect(kw).to.not.include('the')
      expect(kw).to.not.include('is')
      expect(kw).to.not.include('on')
      // 'cat' and 'mat' are >2 chars and not stopwords — should survive
      expect(kw).to.include('cat')
      expect(kw).to.include('mat')
    })

    it('caps total keywords at 8', () => {
      const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi'
      const kw = deriveKeywords({statement: long})
      expect(kw.length).to.be.at.most(8)
    })

    it('strips punctuation/non-word chars from tokens', () => {
      const kw = deriveKeywords({statement: 'JWT,tokens; auth!'})
      expect(kw).to.include('jwt')
      expect(kw).to.include('tokens')
      expect(kw).to.include('auth')
    })

    it('does NOT duplicate the subject token when statement also contains it', () => {
      const kw = deriveKeywords({statement: 'auth uses jwt tokens', subject: 'auth'})
      // subject is included once; statement-derived 'auth' should be dedup'd
      expect(kw.filter((k) => k === 'auth')).to.have.length(1)
      expect(kw[0]).to.equal('auth') // subject is first
    })
  })

  describe('deriveRelated', () => {
    it('links decisions sharing the same category but with distinct subjects', () => {
      const current = {action: 'add' as const, fact: {category: 'project', statement: 's1', subject: 'auth'}}
      const all = [
        current,
        {action: 'add' as const, fact: {category: 'project', statement: 's2', subject: 'logging'}},
        {action: 'add' as const, fact: {category: 'convention', statement: 's3', subject: 'naming'}},
      ]
      const related = deriveRelated(current, all)
      // 3-segment path matching <category>/<subject>/<subject> (R-4 file layout)
      expect(related).to.deep.equal(['project/logging/logging'])
    })

    it('skips the current decision (no self-link)', () => {
      const current = {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'auth'}}
      const related = deriveRelated(current, [current])
      expect(related).to.deep.equal([])
    })

    it('skips decisions with same subject (would point to same file)', () => {
      const current = {action: 'add' as const, fact: {category: 'project', statement: 's1', subject: 'auth'}}
      const all = [
        current,
        {action: 'add' as const, fact: {category: 'project', statement: 's2', subject: 'auth'}},
      ]
      expect(deriveRelated(current, all)).to.deep.equal([])
    })

    it('emits empty array when no other decisions in batch share the category', () => {
      const current = {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'auth'}}
      const all = [
        current,
        {action: 'add' as const, fact: {category: 'convention', statement: 's2', subject: 'naming'}},
      ]
      expect(deriveRelated(current, all)).to.deep.equal([])
    })

    // SLUG PARITY (PHASE-2.5-PLAN review P1) — each path segment must use
    // toSnakeCase so the relation resolves to the actual file written by
    // executeAdd (which uses toSnakeCase). normalizeRelationPath only
    // lowercases + replaces SPACES — hyphens/punctuation would slug-mismatch.
    it('uses toSnakeCase for every segment so hyphens/punctuation match the writer', () => {
      const current = {action: 'add' as const, fact: {category: 'project', statement: 's1', subject: 'rate-limit'}}
      const all = [
        current,
        {action: 'add' as const, fact: {category: 'project', statement: 's2', subject: 'jwt-token'}},
      ]
      const related = deriveRelated(current, all)
      // hyphens in 'jwt-token' must become underscores so the relation points
      // to the real file at project/jwt_token/jwt_token.md
      expect(related).to.deep.equal(['project/jwt_token/jwt_token'])
    })
  })

  // NEW-1 (PHASE-2.6-PLAN.md §3.2) — like deriveRelated but operates over
  // RESOLVED target paths. Filters out same-target decisions (UPSERT
  // collision OR cross-batch UPDATE merge), so the emitted `related`
  // never points at a file that won't be materialized on disk.
  describe('deriveRelatedFromResolved (NEW-1 fix)', () => {
    it('returns same-category sibling targets, skipping current', () => {
      const a = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'auth'}},
        path: 'project/auth',
        title: 'auth',
      }
      const b = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'logging'}},
        path: 'project/logging',
        title: 'logging',
      }
      const related = deriveRelatedFromResolved(a, [a, b])
      expect(related).to.deep.equal(['project/logging/logging'])
    })

    it('FILTERS OUT decisions whose RESOLVED target equals the current target (R-4 in-batch UPSERT collision)', () => {
      // Two decisions with the same subject → R-4 routes both to same file.
      // Both have path='project/auth', title='auth' → resolved target is identical.
      // deriveRelatedFromResolved must NOT cross-link them.
      const a = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's1', subject: 'auth'}},
        path: 'project/auth',
        title: 'auth',
      }
      const b = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's2', subject: 'auth'}},
        path: 'project/auth',
        title: 'auth',
      }
      // Different subject FIELDS but same resolved target — must be filtered.
      // (In practice, deriveTitle returns subject so same-subject implies same target.)
      const related = deriveRelatedFromResolved(a, [a, b])
      expect(related, 'same target → not related').to.deep.equal([])
    })

    it('FILTERS OUT decisions with DIFFERENT subjects but SAME resolved target (cross-batch UPDATE merge)', () => {
      // Scenario 4 step B reproducer: 3 decisions with distinct subjects
      // (jwt_ttl, jwt_storage) all UPDATE-route to the existing jwt_expiry file.
      // Resolved targets identical → must be filtered out of each others' related.
      const a = {
        decision: {action: 'update' as const, fact: {category: 'project', statement: 's', subject: 'jwt_ttl'}},
        path: 'project/jwt_expiry',
        title: 'jwt_expiry',
      }
      const b = {
        decision: {action: 'update' as const, fact: {category: 'project', statement: 's', subject: 'jwt_storage'}},
        path: 'project/jwt_expiry',
        title: 'jwt_expiry',
      }
      const related = deriveRelatedFromResolved(a, [a, b])
      expect(related, 'merged-into-same-file siblings are not related').to.deep.equal([])
    })

    it('uses toSnakeCase on path AND title segments for slug-parity (matches what executeCurate writes)', () => {
      const a = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'rate-limit'}},
        path: 'project/rate-limit',
        title: 'rate-limit',
      }
      const b = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'jwt-token'}},
        path: 'project/jwt-token',
        title: 'jwt-token',
      }
      const related = deriveRelatedFromResolved(a, [a, b])
      // hyphens → underscores in BOTH path segments (matches executeCurate's toSnakeCase per segment)
      expect(related).to.deep.equal(['project/jwt_token/jwt_token'])
    })

    it('skips other-decisions with different category (in-batch isolation between subtrees)', () => {
      const a = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'auth'}},
        path: 'project/auth',
        title: 'auth',
      }
      const b = {
        decision: {action: 'add' as const, fact: {category: 'environment', statement: 's', subject: 'deploy'}},
        path: 'environment/deploy',
        title: 'deploy',
      }
      expect(deriveRelatedFromResolved(a, [a, b])).to.deep.equal([])
    })

    it('returns empty array when only the current decision is in the batch', () => {
      const a = {
        decision: {action: 'add' as const, fact: {category: 'project', statement: 's', subject: 'auth'}},
        path: 'project/auth',
        title: 'auth',
      }
      expect(deriveRelatedFromResolved(a, [a])).to.deep.equal([])
    })
  })
})
