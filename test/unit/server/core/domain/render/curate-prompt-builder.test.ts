/**
 * curate-prompt-builder tests.
 *
 * The prompt builder ships TKT 03's contract with the calling agent:
 *   - kickoff prompt embeds user intent, output contract, path format,
 *     and the bv-* schema slice
 *   - correction prompt embeds the previous response + per-kind fix
 *     hints + the output contract
 *   - schema slice is derived from `ELEMENT_REGISTRY`, so additions
 *     propagate automatically
 *
 * The schema-slice tests are intentionally drift-sensitive: snapshot
 * mismatches mean the registry changed, which is exactly when a
 * reviewer should confirm the diff is what they expect.
 */

import {expect} from 'chai'

import {
  buildCorrectionPrompt,
  buildGeneratePrompt,
  CURATE_SCHEMA_PROMPT,
} from '../../../../../../src/server/core/domain/render/curate-prompt-builder.js'
import {ELEMENT_NAMES} from '../../../../../../src/server/core/domain/render/element-types.js'

describe('curate-prompt-builder', () => {
  describe('CURATE_SCHEMA_PROMPT (derived from ELEMENT_REGISTRY)', () => {
    it('contains every registered element name', () => {
      // Drift guard: a future PR adding an element to ELEMENT_NAMES
      // must also surface in the prompt. The registry is the single
      // source of truth — this test fails if the walk misses a name.
      for (const name of ELEMENT_NAMES) {
        expect(CURATE_SCHEMA_PROMPT, `expected ${name} in schema prompt`).to.include(`<${name}>`)
      }
    })

    it('preserves ELEMENT_NAMES declaration order', () => {
      // bv-topic must come first (it's the root); body-section
      // elements follow in the canonical order. Re-ordering the
      // registry would shift the prompt without us noticing —
      // assert order so any change is intentional.
      const positions = ELEMENT_NAMES.map((name) => CURATE_SCHEMA_PROMPT.indexOf(`<${name}>`))
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i], `${ELEMENT_NAMES[i]} should appear after ${ELEMENT_NAMES[i - 1]}`).to.be.greaterThan(positions[i - 1])
      }
    })

    it('stays under a 3.5 KB budget so kickoff prompts remain context-cheap', () => {
      // The schema slice is loaded on every kickoff. Keeping it tight
      // matters — the calling agent's context is the bill payer.
      // Bumping this budget should be a deliberate decision, not a
      // silent drift; current size ~3.1 KB across 19 elements with
      // MD-rendering preamble stripped.
      expect(CURATE_SCHEMA_PROMPT.length).to.be.lessThan(3584)
    })

    it('renders required + optional attributes when present', () => {
      // bv-topic has both required and optional. Spot-check that both
      // labels appear adjacent to the element block (proxy for the
      // walker emitting them correctly).
      const topicBlockIdx = CURATE_SCHEMA_PROMPT.indexOf('<bv-topic>')
      const nextElIdx = CURATE_SCHEMA_PROMPT.indexOf('\n<bv-', topicBlockIdx + 1)
      const topicBlock = CURATE_SCHEMA_PROMPT.slice(topicBlockIdx, nextElIdx)

      expect(topicBlock).to.include('required: path, title')
      expect(topicBlock).to.include('optional: summary, tags, keywords, related')
    })

    it('renders children semantics for every element', () => {
      // `children: any | block | inline | none` carries the
      // allowed-children hint. Every element block should declare one.
      // Anchor on the newline-prefixed header to avoid matching the
      // first inline mention of an element name in another element's
      // description.
      for (const name of ELEMENT_NAMES) {
        const header = `${name === ELEMENT_NAMES[0] ? '' : '\n'}<${name}>`
        const idx = CURATE_SCHEMA_PROMPT.indexOf(header)
        const nextIdx = CURATE_SCHEMA_PROMPT.indexOf('\n<bv-', idx + header.length)
        const end = nextIdx === -1 ? CURATE_SCHEMA_PROMPT.length : nextIdx
        const block = CURATE_SCHEMA_PROMPT.slice(idx, end)
        expect(block, `${name} should declare children semantics`).to.match(/children: (any|block|inline|none)/)
      }
    })
  })

  describe('buildGeneratePrompt', () => {
    it('embeds the user intent verbatim', () => {
      const intent = 'remember we decided to use RS256 for JWT signing'
      const prompt = buildGeneratePrompt({userIntent: intent})

      expect(prompt).to.include(intent)
    })

    it('embeds the full schema prompt', () => {
      const prompt = buildGeneratePrompt({userIntent: 'x'})
      expect(prompt).to.include(CURATE_SCHEMA_PROMPT)
    })

    it('includes the output contract (forbids code fences + extra elements)', () => {
      const prompt = buildGeneratePrompt({userIntent: 'x'})
      expect(prompt).to.include('DO NOT wrap the response in a code fence')
      expect(prompt).to.include('Exactly one `<bv-topic>`')
    })

    it('includes path-format guidance', () => {
      const prompt = buildGeneratePrompt({userIntent: 'x'})
      expect(prompt).to.include('<domain>/<topic>')
      expect(prompt).to.include('snake_case')
    })

    it('stays under a ~5 KB total budget', () => {
      // Schema slice is ~2-3 KB; the surrounding prose adds ~1 KB; the
      // user intent is bounded by the caller. We expect kickoff
      // prompts on typical intents to fit comfortably under 5 KB.
      const prompt = buildGeneratePrompt({userIntent: 'remember we use RS256'})
      expect(prompt.length).to.be.lessThan(5120)
    })
  })

  describe('buildCorrectionPrompt', () => {
    const userIntent = 'remember we use RS256'
    const previousHtml = '<bv-topic title="JWT"></bv-topic>' // missing path

    it('embeds the user intent + previous response verbatim', () => {
      const prompt = buildCorrectionPrompt({
        errors: [{kind: 'missing-path-attribute', message: 'path is required'}],
        previousHtml,
        userIntent,
      })

      expect(prompt).to.include(userIntent)
      expect(prompt).to.include(previousHtml)
    })

    it('lists every error kind with the human-readable message', () => {
      const errors = [
        {kind: 'missing-path-attribute' as const, message: 'path is required'},
        {field: 'severity', kind: 'attribute-validation' as const, message: 'severity invalid', tag: 'bv-rule' as const},
      ]
      const prompt = buildCorrectionPrompt({errors, previousHtml, userIntent})

      for (const err of errors) {
        expect(prompt).to.include(err.kind)
        expect(prompt).to.include(err.message)
      }
    })

    it('attaches a fix hint per known kind', () => {
      const errors = [
        {kind: 'missing-path-attribute' as const, message: 'm'},
        {kind: 'missing-bv-topic' as const, message: 'm'},
        {kind: 'multiple-bv-topic' as const, message: 'm'},
        {kind: 'unknown-bv-element' as const, message: 'm', tag: 'bv-foo'},
        {kind: 'unsafe-path' as const, message: 'm'},
        {field: 'severity', kind: 'attribute-validation' as const, message: 'm', tag: 'bv-rule' as const},
      ]
      const prompt = buildCorrectionPrompt({errors, previousHtml, userIntent})

      // Fix hints contain anchor phrases keyed off `kind`
      expect(prompt).to.include('Add a `path=')                // missing-path-attribute
      expect(prompt).to.include('Wrap the entire response')    // missing-bv-topic
      expect(prompt).to.include('Merge the topics')            // multiple-bv-topic
      expect(prompt).to.include('Remove `<bv-foo>`')           // unknown-bv-element
      expect(prompt).to.include('no `..` or `.` parts')        // unsafe-path
      expect(prompt).to.include('value of `severity`')         // attribute-validation
    })

    it('falls back to a generic instruction when given zero errors', () => {
      const prompt = buildCorrectionPrompt({errors: [], previousHtml, userIntent})
      expect(prompt).to.include('No structured errors')
    })

    it('includes the output contract so the LLM still gets the bare-HTML rule', () => {
      const prompt = buildCorrectionPrompt({
        errors: [{kind: 'missing-path-attribute', message: 'm'}],
        previousHtml,
        userIntent,
      })
      expect(prompt).to.include('DO NOT wrap the response in a code fence')
    })

    it('does NOT re-embed the schema slice (calling agent already has it from the kickoff prompt)', () => {
      // The correction loop should be tighter than the kickoff. Re-
      // including the full vocabulary would burn tokens unnecessarily
      // — the agent has already seen it on the generate-html step.
      const prompt = buildCorrectionPrompt({
        errors: [{kind: 'missing-path-attribute', message: 'm'}],
        previousHtml,
        userIntent,
      })
      expect(prompt).to.not.include(CURATE_SCHEMA_PROMPT)
    })
  })
})
