import {expect} from 'chai'

import type {StructuralLoss} from '../../../../src/agent/core/domain/knowledge/conflict-detector.js'
import type {ContextData} from '../../../../src/server/core/domain/knowledge/markdown-writer.js'

import {resolveStructuralLoss} from '../../../../src/agent/core/domain/knowledge/conflict-resolver.js'

function makeContext(overrides: Partial<ContextData> = {}): ContextData {
  return {
    keywords: [],
    name: 'test',
    snippets: [],
    tags: [],
    ...overrides,
  }
}

const noLoss: StructuralLoss = {
  hasLoss: false,
  lostArrayItems: 0,
  lostFacts: 0,
  lostKeywords: 0,
  lostNarrativeFields: 0,
  lostRawConceptFields: 0,
  lostRelations: 0,
  lostSnippets: 0,
  lostTags: 0,
}

const hasLoss: StructuralLoss = {
  hasLoss: true,
  lostArrayItems: 0,
  lostFacts: 0,
  lostKeywords: 0,
  lostNarrativeFields: 0,
  lostRawConceptFields: 0,
  lostRelations: 0,
  lostSnippets: 1,
  lostTags: 0,
}

describe('conflict-resolver', () => {
  describe('resolveStructuralLoss', () => {
    describe('no loss — returns proposed as-is', () => {
      it('should return proposed unchanged when no loss detected', () => {
        const existing = makeContext({snippets: ['old']})
        const proposed = makeContext({snippets: ['old', 'new']})

        const result = resolveStructuralLoss(existing, proposed, noLoss)

        expect(result).to.deep.equal(proposed)
      })
    })

    describe('snippets', () => {
      it('should merge lost snippets back into proposed', () => {
        const existing = makeContext({snippets: ['existing-1', 'existing-2']})
        const proposed = makeContext({snippets: ['existing-1', 'new-snippet']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.snippets).to.include('existing-1')
        expect(result.snippets).to.include('existing-2')
        expect(result.snippets).to.include('new-snippet')
      })

      it('should deduplicate snippets (case-insensitive)', () => {
        const existing = makeContext({snippets: ['Snippet-A', 'snippet-b']})
        const proposed = makeContext({snippets: ['snippet-a', 'snippet-c']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        // Should not have duplicates
        const normalized = result.snippets.map((s) => s.toLowerCase())
        expect(new Set(normalized).size).to.equal(normalized.length)
        expect(result.snippets).to.have.length(3)
      })

      it('should preserve existing snippet order first', () => {
        const existing = makeContext({snippets: ['first', 'second']})
        const proposed = makeContext({snippets: ['third']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.snippets[0]).to.equal('first')
        expect(result.snippets[1]).to.equal('second')
        expect(result.snippets[2]).to.equal('third')
      })
    })

    describe('relations', () => {
      it('should merge lost relations back into proposed', () => {
        const existing = makeContext({relations: ['auth/jwt/token.md', 'auth/session/flow.md']})
        const proposed = makeContext({relations: ['auth/jwt/token.md']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.relations).to.include('auth/jwt/token.md')
        expect(result.relations).to.include('auth/session/flow.md')
      })

      it('should deduplicate relations', () => {
        const existing = makeContext({relations: ['auth/jwt/token.md']})
        const proposed = makeContext({relations: ['auth/jwt/token.md', 'new/path.md']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.relations).to.have.length(2)
      })
    })

    describe('narrative fields', () => {
      it('should preserve existing narrative fields absent in proposed', () => {
        const existing = makeContext({narrative: {dependencies: 'existing deps', structure: 'old structure'}})
        const proposed = makeContext({narrative: {structure: 'new structure'}})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.narrative?.structure).to.equal('new structure')
        expect(result.narrative?.dependencies).to.equal('existing deps')
      })

      it('should use proposed narrative fields when both exist', () => {
        const existing = makeContext({narrative: {highlights: 'old highlights'}})
        const proposed = makeContext({narrative: {highlights: 'new highlights'}})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.narrative?.highlights).to.equal('new highlights')
      })

      it('should return undefined narrative when both existing and proposed have none', () => {
        const existing = makeContext()
        const proposed = makeContext()

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.narrative).to.be.undefined
      })
    })

    describe('rawConcept fields', () => {
      it('should preserve existing rawConcept scalar fields absent in proposed', () => {
        const existing = makeContext({rawConcept: {flow: 'existing flow', task: 'main task'}})
        const proposed = makeContext({rawConcept: {task: 'updated task'}})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.rawConcept?.task).to.equal('updated task')
        expect(result.rawConcept?.flow).to.equal('existing flow')
      })

      it('should union-merge rawConcept array fields', () => {
        const existing = makeContext({rawConcept: {changes: ['change-1', 'change-2'], files: ['src/auth.ts']}})
        const proposed = makeContext({rawConcept: {changes: ['change-1', 'change-3']}})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.rawConcept?.changes).to.include('change-1')
        expect(result.rawConcept?.changes).to.include('change-2')
        expect(result.rawConcept?.changes).to.include('change-3')
        expect(result.rawConcept?.files).to.include('src/auth.ts')
      })
    })

    describe('non-conflict fields pass through unchanged', () => {
      // Post-R-1 hotfix (PHASE-2-UAT.md §5.3): when hasLoss is true,
      // keywords and tags are now union-merged (existing first, then
      // new-only items appended). `name` still passes through from
      // proposed since it's a scalar identity field, not array content.
      it('should keep proposed name and union-merge keywords + tags', () => {
        const existing = makeContext({keywords: ['old-kw'], name: 'old name', tags: ['old-tag']})
        const proposed = makeContext({keywords: ['new-kw'], name: 'new name', tags: ['new-tag']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.name).to.equal('new name')
        expect(result.keywords).to.include('old-kw')
        expect(result.keywords).to.include('new-kw')
        expect(result.tags).to.include('old-tag')
        expect(result.tags).to.include('new-tag')
      })
    })

    // R-1 hotfix (PHASE-2-UAT.md §5.3): facts/keywords/tags must be merged
    // back when loss is detected, otherwise UPDATE silently overwrites
    // existing facts (Scenario 4 fact-loss bug).

    describe('facts', () => {
      it('should merge lost facts back into proposed', () => {
        const existing = makeContext({
          facts: [
            {statement: 'JWT tokens expire after 24 hours', subject: 'jwt_expiry'},
          ],
        })
        const proposed = makeContext({
          facts: [
            {statement: 'JWT tokens use SameSite=Strict', subject: 'jwt_samesite'},
          ],
        })

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        const statements = result.facts?.map((f) => f.statement) ?? []
        expect(statements).to.include('JWT tokens expire after 24 hours')
        expect(statements).to.include('JWT tokens use SameSite=Strict')
      })

      it('should deduplicate facts by statement (existing wins for richer fields)', () => {
        const existing = makeContext({
          facts: [{category: 'project', statement: 'Auth uses JWT', subject: 'auth'}],
        })
        const proposed = makeContext({
          facts: [{statement: 'auth uses jwt'}], // same statement, less metadata
        })

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.facts).to.have.length(1)
        expect(result.facts?.[0].category).to.equal('project') // existing wins
        expect(result.facts?.[0].subject).to.equal('auth')
      })

      it('should preserve existing fact order first then append new facts', () => {
        const existing = makeContext({
          facts: [{statement: 'first'}, {statement: 'second'}],
        })
        const proposed = makeContext({
          facts: [{statement: 'third'}],
        })

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.facts?.[0].statement).to.equal('first')
        expect(result.facts?.[1].statement).to.equal('second')
        expect(result.facts?.[2].statement).to.equal('third')
      })
    })

    describe('keywords and tags merge', () => {
      it('should union-merge keywords', () => {
        const existing = makeContext({keywords: ['jwt', 'auth']})
        const proposed = makeContext({keywords: ['auth', 'security']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.keywords).to.include('jwt')
        expect(result.keywords).to.include('auth')
        expect(result.keywords).to.include('security')
      })

      it('should union-merge tags', () => {
        const existing = makeContext({tags: ['security']})
        const proposed = makeContext({tags: ['authentication']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.tags).to.include('security')
        expect(result.tags).to.include('authentication')
      })
    })
  })
})
