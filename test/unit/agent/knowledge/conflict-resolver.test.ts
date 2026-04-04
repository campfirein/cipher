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
  lostNarrativeFields: 0,
  lostRawConceptFields: 0,
  lostRelations: 0,
  lostSnippets: 0,
}

const hasLoss: StructuralLoss = {
  hasLoss: true,
  lostArrayItems: 0,
  lostNarrativeFields: 0,
  lostRawConceptFields: 0,
  lostRelations: 0,
  lostSnippets: 1,
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
      it('should keep proposed name, keywords, tags', () => {
        const existing = makeContext({keywords: ['old-kw'], name: 'old name', tags: ['old-tag']})
        const proposed = makeContext({keywords: ['new-kw'], name: 'new name', tags: ['new-tag']})

        const result = resolveStructuralLoss(existing, proposed, hasLoss)

        expect(result.name).to.equal('new name')
        expect(result.keywords).to.deep.equal(['new-kw'])
        expect(result.tags).to.deep.equal(['new-tag'])
      })
    })
  })
})
