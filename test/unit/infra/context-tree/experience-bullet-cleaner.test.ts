import {expect} from 'chai'

import {cleanExperienceBullets} from '../../../../src/server/infra/context-tree/experience-bullet-cleaner.js'

describe('cleanExperienceBullets', () => {
  it('returns empty array for empty input', () => {
    expect(cleanExperienceBullets([])).to.deep.equal([])
  })

  it('removes whitespace-only entries', () => {
    const result = cleanExperienceBullets(['  ', '\t', '   ', 'valid bullet'])
    expect(result).to.deep.equal(['valid bullet'])
  })

  it('trims whitespace from entries', () => {
    const result = cleanExperienceBullets(['  leading', 'trailing  ', '  both  '])
    expect(result).to.deep.equal(['leading', 'trailing', 'both'])
  })

  it('deduplicates case-insensitively and keeps first occurrence', () => {
    const result = cleanExperienceBullets(['Use strict mode', 'use strict mode', 'USE STRICT MODE'])
    expect(result).to.deep.equal(['Use strict mode'])
  })

  it('passes through clean unique bullets unchanged', () => {
    const input = ['first bullet', 'second bullet', 'third bullet']
    const result = cleanExperienceBullets(input)
    expect(result).to.deep.equal(['first bullet', 'second bullet', 'third bullet'])
  })

  it('handles mixed empty, whitespace, duplicate, and valid entries', () => {
    const result = cleanExperienceBullets([
      '',
      '  alpha  ',
      '   ',
      'Alpha',
      'beta',
      '  BETA ',
      'gamma',
    ])
    expect(result).to.deep.equal(['alpha', 'beta', 'gamma'])
  })
})
