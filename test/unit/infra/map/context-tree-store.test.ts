import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {IContentGenerator} from '../../../../src/agent/core/interfaces/i-content-generator.js'
import type {ITokenizer} from '../../../../src/agent/core/interfaces/i-tokenizer.js'

import {ContextTreeStore} from '../../../../src/agent/infra/map/context-tree-store.js'

/**
 * Simple char/4 tokenizer matching the heuristic in escalation-utils.
 */
const charTokenizer: ITokenizer = {
  countTokens: (text: string) => Math.max(0, Math.round(text.length / 4)),
}

/**
 * Helper to access private totalTokens for invariant checks.
 */
function getTotalTokens(store: ContextTreeStore): number {
  return (store as unknown as {totalTokens: number}).totalTokens
}

describe('ContextTreeStore', () => {
  let sandbox: SinonSandbox
  let mockGenerator: {estimateTokensSync: SinonStub; generateContent: SinonStub; generateContentStream: SinonStub}

  beforeEach(() => {
    sandbox = createSandbox()
    mockGenerator = {
      estimateTokensSync: sandbox.stub().returns(100),
      generateContent: sandbox.stub().resolves({content: '', finishReason: 'stop'}),
      generateContentStream: sandbox.stub(),
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('store() token accounting', () => {
    it('should count tokens using canonical labeled form', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        tauHard: 10_000,
        tokenizer: charTokenizer,
      })

      store.store(0, 'hello')
      const totalTokens = getTotalTokens(store)

      // "[Item 0]: hello" = 16 chars → round(16/4) = 4
      expect(totalTokens).to.equal(charTokenizer.countTokens('[Item 0]: hello'))
    })

    it('should handle index overwrite without inflating totalTokens', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        tauHard: 10_000,
        tokenizer: charTokenizer,
      })

      store.store(0, 'first content')
      const afterFirst = getTotalTokens(store)

      store.store(0, 'second content')
      const afterSecond = getTotalTokens(store)

      // Overwrite should not accumulate — totalTokens reflects only the new entry
      expect(afterSecond).to.equal(charTokenizer.countTokens('[Item 0]: second content'))
      // Not doubled
      expect(afterSecond).to.not.equal(afterFirst + charTokenizer.countTokens('[Item 0]: second content'))
    })
  })

  describe('eviction — strict reduction', () => {
    it('should strictly reduce totalTokens on each eviction (regression: tauHard=50)', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        maxCompactionRounds: 50,
        tauHard: 50,
        tokenizer: charTokenizer,
      })

      // Store many tiny items to trigger eviction
      for (let i = 0; i < 100; i++) {
        store.store(i, `item-${i}`)
        const after = getTotalTokens(store)

        // After store(), totalTokens must be <= tauHard + one labeled entry size
        // (the non-reducible case is a single entry with no summary)
        const labeledSize = charTokenizer.countTokens(`[Item ${i}]: item-${i}`)
        expect(after).to.be.at.most(
          50 + labeledSize,
          `totalTokens=${after} exceeded bound after storing item ${i}`,
        )
      }
    })

    it('should not inflate totalTokens with label overhead during eviction', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        maxCompactionRounds: 20,
        tauHard: 50,
        tokenizer: charTokenizer,
      })

      // Store enough to trigger eviction, then check totalTokens doesn't grow
      // This was the original bug: eviction could INCREASE totalTokens
      const totals: number[] = []
      for (let i = 0; i < 20; i++) {
        store.store(i, 'a')
        totals.push(getTotalTokens(store))
      }

      // totalTokens should never exceed tauHard + largest single labeled entry
      const maxLabeledEntry = charTokenizer.countTokens('[Item 19]: a')
      const maxObserved = Math.max(...totals)
      expect(maxObserved).to.be.at.most(
        50 + maxLabeledEntry,
        `Max observed totalTokens=${maxObserved} exceeded bound`,
      )
    })
  })

  describe('high-volume stress', () => {
    it('should remain bounded under 200 items with small tauHard', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        maxCompactionRounds: 20,
        tauHard: 100,
        tokenizer: charTokenizer,
      })

      let maxTotal = 0
      for (let i = 0; i < 200; i++) {
        store.store(i, `data-payload-${i}-with-some-content`)
        const total = getTotalTokens(store)
        if (total > maxTotal) {
          maxTotal = total
        }
      }

      // Largest single labeled entry: "[Item 199]: data-payload-199-with-some-content"
      const maxLabeledEntry = charTokenizer.countTokens(
        '[Item 199]: data-payload-199-with-some-content',
      )
      expect(maxTotal).to.be.at.most(
        100 + maxLabeledEntry,
        `Stress test: maxTotal=${maxTotal} exceeded bound`,
      )
    })
  })

  describe('summary drop safety path', () => {
    it('should drop summary when summaryTokens >= evictedTokens', () => {
      // Use a tokenizer that makes labels very expensive relative to content
      // This triggers the safety drop branch where summary >= evictedTokens
      // 1 token per character — makes labels very expensive relative to content
      const tinyTokenizer: ITokenizer = {
        countTokens: (text: string) => text.length,
      }

      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        maxCompactionRounds: 20,
        tauHard: 50,
        tokenizer: tinyTokenizer,
      })

      // Store several items to trigger eviction
      for (let i = 0; i < 10; i++) {
        const before = getTotalTokens(store)
        store.store(i, 'x')
        const after = getTotalTokens(store)

        // The key invariant: eviction must never increase totalTokens
        // (except for the newly stored item itself)
        if (i > 0) {
          const newEntryTokens = tinyTokenizer.countTokens(`[Item ${i}]: x`)
          expect(after).to.be.at.most(
            before + newEntryTokens,
            `totalTokens grew beyond new entry at item ${i}: before=${before}, after=${after}`,
          )
        }
      }
    })
  })

  describe('edge cases', () => {
    it('should handle tauHard=1 without errors', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        maxCompactionRounds: 10,
        tauHard: 1,
        tokenizer: charTokenizer,
      })

      // Should not throw
      store.store(0, 'hello world')
      store.store(1, 'another item')

      const total = getTotalTokens(store)
      expect(total).to.be.greaterThan(0) // At least the last entry remains
    })

    it('should stay bounded with tauHard=1 under repeated long stores', () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        maxCompactionRounds: 50,
        tauHard: 1,
        tokenizer: charTokenizer,
      })

      const payload = 'payload-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      for (let i = 0; i < 40; i++) {
        store.store(i, payload)
      }

      const total = getTotalTokens(store)
      const singleEntryTokens = charTokenizer.countTokens(`[Item 39]: ${payload}`)
      expect(total).to.be.at.most(
        1 + singleEntryTokens,
        `totalTokens=${total} exceeded bound for tauHard=1`,
      )
    })

    it('should produce a summary handle after compact()', async () => {
      const store = new ContextTreeStore({
        generator: mockGenerator as unknown as IContentGenerator,
        summaryBudget: 10_000,
        tauHard: 10_000,
        tokenizer: charTokenizer,
      })

      store.store(0, 'result one')
      store.store(1, 'result two')

      await store.compact()

      const handle = store.getSummaryHandle()
      expect(handle).to.be.a('string')
      expect(handle!.length).to.be.greaterThan(0)
    })
  })
})
