import {expect} from 'chai'

import {
  EXPERIENCE_DEAD_ENDS_DIR,
  EXPERIENCE_HINTS_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_REFLECTIONS_DIR,
  EXPERIENCE_STRATEGIES_DIR,
} from '../../../../src/server/constants.js'
import {extractExperienceSignals, signalSubfolder} from '../../../../src/server/infra/context-tree/experience-extractor.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceExtractor', () => {
  describe('extractExperienceSignals()', () => {
    it('returns empty array when no ```experience block is present', () => {
      const result = extractExperienceSignals('Some agent response with no experience block.')
      expect(result).to.deep.equal([])
    })

    it('returns empty array when the block contains invalid JSON', () => {
      const response = '```experience\nnot valid json\n```'
      expect(extractExperienceSignals(response)).to.deep.equal([])
    })

    it('returns empty array when the block contains a non-array JSON value', () => {
      const response = '```experience\n{"type":"lesson","text":"something"}\n```'
      expect(extractExperienceSignals(response)).to.deep.equal([])
    })

    it('returns empty array when the block is an empty array', () => {
      const response = '```experience\n[]\n```'
      expect(extractExperienceSignals(response)).to.deep.equal([])
    })

    it('extracts a single valid lesson signal', () => {
      const response = '```experience\n[{"type":"lesson","text":"Always initialize before write"}]\n```'
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      expect(signals[0]).to.deep.equal({text: 'Always initialize before write', type: 'lesson'})
    })

    it('extracts all six signal types', () => {
      const payload = JSON.stringify([
        {text: 'lesson text', type: 'lesson'},
        {text: 'hint text', type: 'hint'},
        {text: 'dead-end text', type: 'dead-end'},
        {text: 'strategy text', type: 'strategy'},
        {domain: 'code-review', score: 0.85, text: 'good quality', type: 'performance'},
        {text: 'pattern noticed', type: 'reflection'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(6)
      expect(signals.map((s) => s.type)).to.deep.equal(['lesson', 'hint', 'dead-end', 'strategy', 'performance', 'reflection'])
    })

    it('extracts performance signals with score and domain', () => {
      const payload = JSON.stringify([
        {domain: 'valuation', score: 0.72, text: 'DCF analysis quality', type: 'performance'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      const signal = signals[0] as {domain: string; score: number; text: string; type: string}
      expect(signal.type).to.equal('performance')
      expect(signal.score).to.equal(0.72)
      expect(signal.domain).to.equal('valuation')
    })

    it('rejects performance signals without score', () => {
      const payload = JSON.stringify([
        {domain: 'code-review', text: 'missing score', type: 'performance'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      expect(extractExperienceSignals(response)).to.deep.equal([])
    })

    it('rejects performance signals without domain', () => {
      const payload = JSON.stringify([
        {score: 0.5, text: 'missing domain', type: 'performance'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      expect(extractExperienceSignals(response)).to.deep.equal([])
    })

    it('rejects performance signals with score out of range', () => {
      const payload = JSON.stringify([
        {domain: 'test', score: 1.5, text: 'bad score', type: 'performance'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      expect(extractExperienceSignals(response)).to.deep.equal([])
    })

    it('filters out entries with unknown types', () => {
      const payload = JSON.stringify([
        {text: 'valid', type: 'lesson'},
        {text: 'invalid', type: 'unknown-type'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      expect(signals[0].type).to.equal('lesson')
    })

    it('filters out entries with empty or whitespace-only text', () => {
      const payload = JSON.stringify([
        {text: '  ', type: 'lesson'},
        {text: 'valid hint', type: 'hint'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      expect(signals[0].type).to.equal('hint')
    })

    it('filters out entries that are missing type or text fields', () => {
      const payload = JSON.stringify([
        {type: 'lesson'},
        {text: 'no type'},
        {text: 'valid', type: 'hint'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      expect(signals[0].text).to.equal('valid')
    })

    it('is fail-safe when response is empty string', () => {
      expect(extractExperienceSignals('')).to.deep.equal([])
    })

    it('only matches the first ```experience block', () => {
      const response = [
        '```experience',
        '[{"type":"lesson","text":"first"}]',
        '```',
        'Some text',
        '```experience',
        '[{"type":"hint","text":"second"}]',
        '```',
      ].join('\n')
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      expect(signals[0].text).to.equal('first')
    })

    it('supports CRLF line endings in the fenced block', () => {
      const response = '```experience\r\n[{"type":"lesson","text":"windows newline"}]\r\n```'
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(1)
      expect(signals[0]).to.deep.equal({text: 'windows newline', type: 'lesson'})
    })
  })

  describe('signalSubfolder()', () => {
    it('maps lesson → lessons dir', () => {
      expect(signalSubfolder('lesson')).to.equal(EXPERIENCE_LESSONS_DIR)
    })

    it('maps hint → hints dir', () => {
      expect(signalSubfolder('hint')).to.equal(EXPERIENCE_HINTS_DIR)
    })

    it('maps dead-end → dead-ends dir', () => {
      expect(signalSubfolder('dead-end')).to.equal(EXPERIENCE_DEAD_ENDS_DIR)
    })

    it('maps strategy → strategies dir', () => {
      expect(signalSubfolder('strategy')).to.equal(EXPERIENCE_STRATEGIES_DIR)
    })

    it('maps performance → performance dir', () => {
      expect(signalSubfolder('performance')).to.equal(EXPERIENCE_PERFORMANCE_DIR)
    })

    it('maps reflection → reflections dir', () => {
      expect(signalSubfolder('reflection')).to.equal(EXPERIENCE_REFLECTIONS_DIR)
    })
  })
})
