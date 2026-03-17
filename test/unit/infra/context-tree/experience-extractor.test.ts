import {expect} from 'chai'

import {
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../../../src/server/constants.js'
import {extractExperienceSignals, signalTarget} from '../../../../src/server/infra/context-tree/experience-extractor.js'

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

    it('extracts all four signal types', () => {
      const payload = JSON.stringify([
        {text: 'lesson text', type: 'lesson'},
        {text: 'hint text', type: 'hint'},
        {text: 'dead-end text', type: 'dead-end'},
        {text: 'strategy text', type: 'strategy'},
      ])
      const response = `\`\`\`experience\n${payload}\n\`\`\``
      const signals = extractExperienceSignals(response)
      expect(signals).to.have.length(4)
      expect(signals.map((s) => s.type)).to.deep.equal(['lesson', 'hint', 'dead-end', 'strategy'])
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

  describe('signalTarget()', () => {
    it('maps lesson → lessons.md / Facts', () => {
      const target = signalTarget('lesson')
      expect(target.file).to.equal(EXPERIENCE_LESSONS_FILE)
      expect(target.section).to.equal('Facts')
    })

    it('maps hint → hints.md / Hints', () => {
      const target = signalTarget('hint')
      expect(target.file).to.equal(EXPERIENCE_HINTS_FILE)
      expect(target.section).to.equal('Hints')
    })

    it('maps dead-end → dead-ends.md / Dead Ends', () => {
      const target = signalTarget('dead-end')
      expect(target.file).to.equal(EXPERIENCE_DEAD_ENDS_FILE)
      expect(target.section).to.equal('Dead Ends')
    })

    it('maps strategy → playbook.md / Strategies', () => {
      const target = signalTarget('strategy')
      expect(target.file).to.equal(EXPERIENCE_PLAYBOOK_FILE)
      expect(target.section).to.equal('Strategies')
    })
  })
})
