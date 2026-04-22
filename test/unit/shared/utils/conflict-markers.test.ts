import {expect} from 'chai'

import {hasConflictMarkers} from '../../../../src/shared/utils/conflict-markers.js'

describe('hasConflictMarkers', () => {
  it('returns true for a complete conflict block', () => {
    const content = [
      'line above',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> branch',
      'line below',
    ].join('\n')
    expect(hasConflictMarkers(content)).to.be.true
  })

  it('returns true even when markers are not on the canonical lines (substring match)', () => {
    // We use plain substring checks, not anchored regex, so any occurrence of all three triggers true.
    const content = 'prefix <<<<<<< mid ======= end >>>>>>> suffix'
    expect(hasConflictMarkers(content)).to.be.true
  })

  it('returns false for empty content', () => {
    expect(hasConflictMarkers('')).to.be.false
  })

  it('returns false for plain markdown without markers', () => {
    const content = '# Heading\n\nBody text with no conflict markers.'
    expect(hasConflictMarkers(content)).to.be.false
  })

  it('returns false when only the start marker is present', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\nours\n')).to.be.false
  })

  it('returns false when only the separator is present (avoids flagging setext h2 underlines)', () => {
    // `=======` alone is also a markdown setext heading underline; we must not flag those.
    expect(hasConflictMarkers('Heading\n=======\nbody')).to.be.false
  })

  it('returns false when only the end marker is present', () => {
    expect(hasConflictMarkers('>>>>>>> branch')).to.be.false
  })

  it('returns false when start + separator are present but end is missing', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\nours\n=======\ntheirs')).to.be.false
  })

  it('returns false for tutorial-style content discussing markers separately', () => {
    const tutorial = 'Use the `<<<<<<<` start marker, the `=======` separator, but be careful'
    // Only two of three present (no `>>>>>>>` literal here)
    expect(hasConflictMarkers(tutorial)).to.be.false
  })
})
