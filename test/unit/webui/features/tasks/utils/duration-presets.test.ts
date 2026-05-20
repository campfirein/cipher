import {expect} from 'chai'

import {durationPresetToRange} from '../../../../../../src/webui/features/tasks/utils/duration-presets.js'

describe('durationPresetToRange', () => {
  it('returns empty object for all (no constraint)', () => {
    expect(durationPresetToRange('all')).to.deep.equal({})
  })

  it('short maps to maxDurationMs only (open-ended low)', () => {
    expect(durationPresetToRange('short')).to.deep.equal({maxDurationMs: 5000})
  })

  it('medium maps to a 5-30s range', () => {
    expect(durationPresetToRange('medium')).to.deep.equal({maxDurationMs: 30_000, minDurationMs: 5000})
  })

  it('long maps to a 30s-2m range', () => {
    expect(durationPresetToRange('long')).to.deep.equal({maxDurationMs: 120_000, minDurationMs: 30_000})
  })

  it('very-long maps to minDurationMs only (open-ended high)', () => {
    expect(durationPresetToRange('very-long')).to.deep.equal({minDurationMs: 120_000})
  })
})
