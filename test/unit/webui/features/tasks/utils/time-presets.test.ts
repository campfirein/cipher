import {expect} from 'chai'

import {timePresetToRange} from '../../../../../../src/webui/features/tasks/utils/time-presets.js'

const NOW = new Date(2026, 4, 2, 14, 30, 0).getTime()

describe('timePresetToRange', () => {
  it('returns empty object for all (no constraint)', () => {
    expect(timePresetToRange('all', NOW)).to.deep.equal({})
  })

  it('today snapshots createdAfter to start-of-day local time', () => {
    const startOfDay = new Date(2026, 4, 2).getTime()
    expect(timePresetToRange('today', NOW)).to.deep.equal({createdAfter: startOfDay})
  })

  it('week snapshots createdAfter to start-of-week (Monday)', () => {
    // 2026-05-02 is Saturday → Monday is 2026-04-27
    const monday = new Date(2026, 3, 27).getTime()
    expect(timePresetToRange('week', NOW)).to.deep.equal({createdAfter: monday})
  })

  it('month snapshots createdAfter to first-of-month', () => {
    const startOfMonth = new Date(2026, 4, 1).getTime()
    expect(timePresetToRange('month', NOW)).to.deep.equal({createdAfter: startOfMonth})
  })
})
