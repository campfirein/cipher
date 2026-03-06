import {expect} from 'chai'

import type {StructuralLoss} from '../../../../src/agent/core/domain/knowledge/conflict-detector.js'
import type {ContextData} from '../../../../src/server/core/domain/knowledge/markdown-writer.js'

import {deriveImpactFromLoss, detectStructuralLoss} from '../../../../src/agent/core/domain/knowledge/conflict-detector.js'

function makeContext(overrides: Partial<ContextData> = {}): ContextData {
  return {
    keywords: [],
    name: 'test',
    snippets: [],
    tags: [],
    ...overrides,
  }
}

describe('conflict-detector', () => {
  describe('detectStructuralLoss', () => {
    describe('snippets', () => {
      it('should detect lost snippets when proposed omits existing ones', () => {
        const existing = makeContext({snippets: ['snippet-a', 'snippet-b', 'snippet-c']})
        const proposed = makeContext({snippets: ['snippet-a']})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.true
        expect(loss.lostSnippets).to.equal(2)
      })

      it('should not flag snippets that are present in proposed', () => {
        const existing = makeContext({snippets: ['snippet-a', 'snippet-b']})
        const proposed = makeContext({snippets: ['snippet-a', 'snippet-b', 'snippet-c']})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.lostSnippets).to.equal(0)
      })

      it('should use case-insensitive comparison for snippets', () => {
        const existing = makeContext({snippets: ['Snippet-A']})
        const proposed = makeContext({snippets: ['snippet-a']})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.lostSnippets).to.equal(0)
      })

      it('should detect all snippets as lost when proposed is empty', () => {
        const existing = makeContext({snippets: ['a', 'b', 'c']})
        const proposed = makeContext({snippets: []})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.lostSnippets).to.equal(3)
      })
    })

    describe('relations', () => {
      it('should detect lost relations', () => {
        const existing = makeContext({relations: ['auth/jwt/token.md', 'auth/session/flow.md']})
        const proposed = makeContext({relations: ['auth/jwt/token.md']})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.true
        expect(loss.lostRelations).to.equal(1)
      })

      it('should not flag when all relations preserved', () => {
        const existing = makeContext({relations: ['auth/jwt/token.md']})
        const proposed = makeContext({relations: ['auth/jwt/token.md', 'new/path.md']})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.lostRelations).to.equal(0)
      })
    })

    describe('narrative fields', () => {
      it('should detect lost narrative fields', () => {
        const existing = makeContext({
          narrative: {dependencies: 'some deps', highlights: 'key points', structure: 'overview'},
        })
        const proposed = makeContext({narrative: {structure: 'overview'}})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.true
        expect(loss.lostNarrativeFields).to.equal(2)
      })

      it('should not flag narrative fields present in proposed', () => {
        const existing = makeContext({narrative: {structure: 'overview'}})
        const proposed = makeContext({narrative: {structure: 'updated overview'}})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.lostNarrativeFields).to.equal(0)
      })

      it('should not flag when existing has no narrative', () => {
        const existing = makeContext({narrative: undefined})
        const proposed = makeContext({narrative: {structure: 'new'}})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.lostNarrativeFields).to.equal(0)
      })
    })

    describe('rawConcept fields', () => {
      it('should detect lost rawConcept scalar fields', () => {
        const existing = makeContext({
          rawConcept: {flow: 'some flow', task: 'main task', timestamp: '2025-01-01'},
        })
        const proposed = makeContext({rawConcept: {task: 'main task'}})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.true
        expect(loss.lostRawConceptFields).to.equal(2)
      })

      it('should detect lost rawConcept array items', () => {
        const existing = makeContext({
          rawConcept: {changes: ['change-1', 'change-2'], files: ['src/auth.ts']},
        })
        const proposed = makeContext({rawConcept: {changes: ['change-1']}})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.true
        expect(loss.lostArrayItems).to.equal(2) // change-2 + src/auth.ts
      })
    })

    describe('no loss cases', () => {
      it('should return hasLoss=false when nothing is lost', () => {
        const existing = makeContext({
          narrative: {structure: 'overview'},
          relations: ['auth/jwt/token.md'],
          snippets: ['snippet-a'],
        })
        const proposed = makeContext({
          narrative: {highlights: 'new', structure: 'overview'},
          relations: ['auth/jwt/token.md', 'new/path.md'],
          snippets: ['snippet-a', 'snippet-b'],
        })

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.false
        expect(loss.lostSnippets).to.equal(0)
        expect(loss.lostRelations).to.equal(0)
        expect(loss.lostNarrativeFields).to.equal(0)
      })

      it('should return no loss for empty existing content', () => {
        const existing = makeContext()
        const proposed = makeContext({snippets: ['new snippet'], tags: ['newtag']})

        const loss = detectStructuralLoss(existing, proposed)

        expect(loss.hasLoss).to.be.false
      })
    })
  })

  describe('deriveImpactFromLoss', () => {
    const noLoss: StructuralLoss = {
      hasLoss: false,
      lostArrayItems: 0,
      lostNarrativeFields: 0,
      lostRawConceptFields: 0,
      lostRelations: 0,
      lostSnippets: 0,
    }

    it('should return "low" when no loss detected', () => {
      expect(deriveImpactFromLoss(noLoss)).to.equal('low')
    })

    it('should return "high" when snippets are lost', () => {
      const loss: StructuralLoss = {...noLoss, hasLoss: true, lostSnippets: 1}
      expect(deriveImpactFromLoss(loss)).to.equal('high')
    })

    it('should return "high" when multiple snippets are lost', () => {
      const loss: StructuralLoss = {...noLoss, hasLoss: true, lostSnippets: 5}
      expect(deriveImpactFromLoss(loss)).to.equal('high')
    })

    it('should return "high" when relations are lost but no snippets', () => {
      const loss: StructuralLoss = {...noLoss, hasLoss: true, lostRelations: 2}
      expect(deriveImpactFromLoss(loss)).to.equal('high')
    })

    it('should return "high" when narrative fields are lost', () => {
      const loss: StructuralLoss = {...noLoss, hasLoss: true, lostNarrativeFields: 1}
      expect(deriveImpactFromLoss(loss)).to.equal('high')
    })

    it('should return "high" when rawConcept fields are lost', () => {
      const loss: StructuralLoss = {...noLoss, hasLoss: true, lostRawConceptFields: 1}
      expect(deriveImpactFromLoss(loss)).to.equal('high')
    })

    it('should return "high" when snippets lost even alongside other loss types', () => {
      const loss: StructuralLoss = {
        hasLoss: true,
        lostArrayItems: 3,
        lostNarrativeFields: 2,
        lostRawConceptFields: 1,
        lostRelations: 2,
        lostSnippets: 1,
      }
      expect(deriveImpactFromLoss(loss)).to.equal('high')
    })
  })
})
