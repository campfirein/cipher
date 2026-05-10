/**
 * Sanity tests for the curate tool description prompt.
 *
 * The prompt at `src/agent/resources/tools/curate.txt` is the canonical
 * curate output-format contract — it tells the agent that curate output
 * is HTML using the M1 `<bv-*>` vocabulary. These tests guard against
 * silent drift: if a future PR adds a new element to the registry but
 * forgets the prompt, or removes a documented attribute without updating
 * downstream consumers, this test fails loudly.
 *
 * The tests are deliberately string-level (not behavioural). The
 * authoring-fluency check (M1 T2 spike) is the behavioural counterpart.
 */

import {expect} from 'chai'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {ELEMENT_NAMES} from '../../../../../src/server/core/domain/render/element-types.js'

const PROMPT_PATH = join(process.cwd(), 'src/agent/resources/tools/curate.txt')

function loadPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8')
}

describe('curate.txt prompt', () => {
  describe('vocabulary coverage', () => {
    it('mentions every element name in the registry', () => {
      const prompt = loadPrompt()
      for (const name of ELEMENT_NAMES) {
        expect(prompt, `expected prompt to mention <${name}>`).to.include(`<${name}>`)
      }
    })

    it('flags `path` as the required attribute on bv-topic', () => {
      // Required-vs-optional is the only attribute distinction the
      // validator enforces today; if the prompt drops the requirement,
      // generation drifts and bv-topic emits without `path`.
      const prompt = loadPrompt()
      expect(prompt).to.match(/required attributes:[\s\S]*?`path`/)
    })

    it('lists all bv-topic optional attributes (importance, maturity, recency, updatedat)', () => {
      const prompt = loadPrompt()
      for (const attr of ['importance', 'maturity', 'recency', 'updatedat']) {
        expect(prompt, `expected prompt to mention bv-topic optional attribute "${attr}"`).to.include(`\`${attr}\``)
      }
    })

    it('lists severity enum values for bv-rule (info|should|must)', () => {
      const prompt = loadPrompt()
      for (const value of ['info', 'should', 'must']) {
        expect(prompt).to.include(`"${value}"`)
      }
    })

    it('lists severity enum values for bv-bug (low|medium|high|critical)', () => {
      const prompt = loadPrompt()
      for (const value of ['low', 'medium', 'high', 'critical']) {
        expect(prompt).to.include(`"${value}"`)
      }
    })

    it('lists maturity enum values for bv-topic (draft|validated|core)', () => {
      const prompt = loadPrompt()
      for (const value of ['draft', 'validated', 'core']) {
        expect(prompt).to.include(`"${value}"`)
      }
    })
  })

  describe('output contract', () => {
    it('declares the closed vocabulary', () => {
      const prompt = loadPrompt()
      expect(prompt.toLowerCase()).to.include('closed')
    })

    it('forbids prose preamble, code fences, and trailing commentary', () => {
      const prompt = loadPrompt().toLowerCase()
      expect(prompt).to.include('preamble')
      expect(prompt).to.include('code fence')
      expect(prompt).to.include('commentary')
    })

    it('requires exactly one bv-topic root', () => {
      const prompt = loadPrompt()
      expect(prompt.toLowerCase()).to.include('exactly one')
    })

    it('requires lowercase attribute names (HTML5 normalization)', () => {
      const prompt = loadPrompt()
      expect(prompt.toLowerCase()).to.include('lowercase')
    })

    it('forbids clarifying questions', () => {
      const prompt = loadPrompt()
      expect(prompt.toLowerCase()).to.include('clarifying question')
    })
  })
})
