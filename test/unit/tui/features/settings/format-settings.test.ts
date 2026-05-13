import {expect} from 'chai'

import type {SettingsItemDTO} from '../../../../../src/shared/transport/events/settings-events.js'

import {
  buildSettingsRows,
  validateSettingInput,
} from '../../../../../src/tui/features/settings/utils/format-settings.js'

function makeItem(overrides: Partial<SettingsItemDTO> = {}): SettingsItemDTO {
  return {
    current: 10,
    default: 10,
    description: 'desc',
    key: 'agentPool.maxSize',
    max: 100,
    min: 1,
    restartRequired: true,
    type: 'integer',
    ...overrides,
  }
}

describe('format-settings', () => {
  describe('buildSettingsRows', () => {
    it('preserves registry order from the daemon and pre-formats display columns', () => {
      const rows = buildSettingsRows([
        makeItem({current: 25, key: 'agentPool.maxSize'}),
        makeItem({current: 1000, default: 1000, key: 'taskHistory.maxEntries', max: 100_000, min: 10}),
      ])

      expect(rows.map((r) => r.key)).to.deep.equal(['agentPool.maxSize', 'taskHistory.maxEntries'])
      expect(rows[0].displayCurrent).to.equal('25')
      expect(rows[0].displayDefault).to.equal('10')
      expect(rows[1].displayCurrent).to.equal('1000')
    })

    it('marks a row as modified when current differs from default', () => {
      const rows = buildSettingsRows([
        makeItem({current: 25, default: 10}),
        makeItem({current: 5, default: 5, key: 'agentPool.maxConcurrentTasksPerProject'}),
      ])
      expect(rows[0].modified).to.equal(true)
      expect(rows[1].modified).to.equal(false)
    })
  })

  describe('validateSettingInput', () => {
    const descriptor = {max: 100, min: 1}

    it('returns undefined for a valid integer within range', () => {
      expect(validateSettingInput('25', descriptor)).to.be.undefined
      expect(validateSettingInput('1', descriptor)).to.be.undefined
      expect(validateSettingInput('100', descriptor)).to.be.undefined
    })

    it('returns an error for empty input', () => {
      expect(validateSettingInput('   ', descriptor)).to.include('required')
    })

    it('returns an error for non-numeric input', () => {
      const result = validateSettingInput('abc', descriptor)
      expect(result).to.exist
      expect(result).to.include('integer')
    })

    it('returns an error for a fractional number', () => {
      expect(validateSettingInput('1.5', descriptor)).to.include('integer')
    })

    it('returns an error naming the range when value is out of bounds', () => {
      const tooHigh = validateSettingInput('200', descriptor)
      const tooLow = validateSettingInput('0', descriptor)
      expect(tooHigh).to.include('100').and.to.include('range')
      expect(tooLow).to.include('1').and.to.include('range')
    })
  })
})
