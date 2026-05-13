import {expect} from 'chai'

import type {SettingsItemDTO} from '../../../../../src/shared/transport/events/settings-events.js'

import {
  bottomHintFor,
  buildSettingsRows,
  groupRowsByCategory,
  parseRowInput,
  preFillBufferFor,
  type SettingsRow,
  validateSettingInput,
} from '../../../../../src/tui/features/settings/utils/format-settings.js'

function makeItem(overrides: Partial<SettingsItemDTO> = {}): SettingsItemDTO {
  return {
    category: 'concurrency',
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

function makeRow(overrides: Partial<SettingsRow> = {}): SettingsRow {
  return {
    category: 'concurrency',
    current: 10,
    default: 10,
    description: 'desc',
    displayCurrent: '10',
    displayDefault: '10',
    displayRange: '1-100',
    key: 'agentPool.maxSize',
    label: 'agentPool.maxSize',
    max: 100,
    min: 1,
    modified: false,
    restartRequired: true,
    type: 'integer',
    unit: 'count',
    ...overrides,
  }
}

describe('format-settings', () => {
  describe('buildSettingsRows', () => {
    it('preserves registry order within a category and formats display columns per unit', () => {
      const rows = buildSettingsRows([
        makeItem({current: 25, key: 'agentPool.maxSize'}),
        makeItem({category: 'task-history', current: 1000, default: 1000, key: 'taskHistory.maxEntries', max: 10_000, min: 10}),
      ])

      expect(rows.map((r) => r.key)).to.deep.equal(['agentPool.maxSize', 'taskHistory.maxEntries'])
      expect(rows[0].displayCurrent).to.equal('25')
      expect(rows[0].displayDefault).to.equal('10')
      expect(rows[1].displayCurrent).to.equal('1,000')
    })

    it('renders ms-unit rows in human duration form', () => {
      const rows = buildSettingsRows([
        makeItem({
          category: 'llm',
          current: 1_800_000,
          default: 600_000,
          key: 'llm.iterationBudgetMs',
          max: 3_600_000,
          min: 60_000,
          unit: 'ms',
        }),
      ])

      expect(rows[0].displayCurrent).to.equal('30m')
      expect(rows[0].displayDefault).to.equal('10m')
      expect(rows[0].displayRange).to.equal('1m-1h')
    })

    it('marks a row as modified when current differs from default', () => {
      const rows = buildSettingsRows([
        makeItem({current: 25, default: 10}),
        makeItem({current: 5, default: 5, key: 'agentPool.maxConcurrentTasksPerProject'}),
      ])
      expect(rows[0].modified).to.equal(true)
      expect(rows[1].modified).to.equal(false)
    })

    it('orders categories as CONCURRENCY -> LLM -> TASK HISTORY regardless of input order', () => {
      const rows = buildSettingsRows([
        makeItem({category: 'task-history', key: 'taskHistory.maxEntries'}),
        makeItem({category: 'llm', key: 'llm.iterationBudgetMs', unit: 'ms'}),
        makeItem({category: 'concurrency', key: 'agentPool.maxSize'}),
      ])
      expect(rows.map((r) => r.category)).to.deep.equal(['concurrency', 'llm', 'task-history'])
    })

    it('appends the coupling hint to llm.requestTimeoutMs range', () => {
      const rows = buildSettingsRows([
        makeItem({category: 'llm', key: 'llm.requestTimeoutMs', max: 3_600_000, min: 10_000, unit: 'ms'}),
      ])
      expect(rows[0].displayRange).to.include('max loop budget')
    })

    it('falls back to category=other when the DTO omits category', () => {
      const item = makeItem({key: 'foo.bar'})
      const nakedItem = {
        current: item.current,
        default: item.default,
        description: item.description,
        key: item.key,
        max: item.max,
        min: item.min,
        restartRequired: item.restartRequired,
        type: item.type,
      } as SettingsItemDTO
      const rows = buildSettingsRows([nakedItem])
      expect(rows[0].category).to.equal('other')
      expect(rows[0].unit).to.equal('count')
    })
  })

  describe('groupRowsByCategory', () => {
    it('returns ordered [header, rows] groups skipping empty categories', () => {
      const groups = groupRowsByCategory([
        makeRow({category: 'concurrency', key: 'agentPool.maxSize'}),
        makeRow({category: 'llm', key: 'llm.iterationBudgetMs', unit: 'ms'}),
      ])
      expect(groups.map((g) => g.header)).to.deep.equal(['CONCURRENCY', 'LLM'])
      expect(groups[0].rows).to.have.lengthOf(1)
      expect(groups[1].rows).to.have.lengthOf(1)
    })
  })

  describe('bottomHintFor', () => {
    it('returns the browse hint without a key', () => {
      expect(bottomHintFor('browse')).to.equal('Up/Down move | Enter edit | R reset | Esc exit')
    })

    it('names the focused key in edit mode', () => {
      expect(bottomHintFor('edit', 'agentPool.maxSize')).to.equal(
        'Editing agentPool.maxSize | Enter save | Esc cancel',
      )
    })

    it('uses a distinct phrasing in edit-error mode', () => {
      const hint = bottomHintFor('edit-error', 'agentPool.maxSize')
      expect(hint).to.include('when valid')
      expect(hint).to.include('agentPool.maxSize')
    })

    it('mentions background resolution in saving mode', () => {
      const hint = bottomHintFor('saving')
      expect(hint).to.include('Saving')
      expect(hint).to.include('background')
    })
  })

  describe('preFillBufferFor', () => {
    it('pre-fills with the human duration for ms-unit rows', () => {
      const row = makeRow({current: 600_000, key: 'llm.iterationBudgetMs', unit: 'ms'})
      expect(preFillBufferFor(row)).to.equal('10m')
    })

    it('pre-fills with the raw integer (no commas) for count-unit rows', () => {
      const row = makeRow({current: 1000, key: 'taskHistory.maxEntries'})
      expect(preFillBufferFor(row)).to.equal('1000')
    })
  })

  describe('parseRowInput', () => {
    it('count: accepts integer input within range and returns the formatted display value', () => {
      const row = makeRow()
      const result = parseRowInput(row, '25')
      expect(result.kind).to.equal('ok')
      if (result.kind === 'ok') {
        expect(result.value).to.equal(25)
        expect(result.displayValue).to.equal('25')
      }
    })

    it('count: rejects out-of-range with "out of range: max <N>"', () => {
      const row = makeRow({max: 100})
      const result = parseRowInput(row, '150')
      expect(result.kind).to.equal('error')
      if (result.kind === 'error') {
        expect(result.message).to.match(/out of range: max 100/)
      }
    })

    it('count: rejects a duration-shaped string with a unit-mismatch message', () => {
      const row = makeRow({key: 'agentPool.maxSize'})
      const result = parseRowInput(row, '30m')
      expect(result.kind).to.equal('error')
      if (result.kind === 'error') {
        expect(result.message).to.include('expects an integer count')
      }
    })

    it('ms: parses "30m" -> 1_800_000 and surfaces the human display for echo', () => {
      const row = makeRow({key: 'llm.iterationBudgetMs', max: 3_600_000, min: 60_000, unit: 'ms'})
      const result = parseRowInput(row, '30m')
      expect(result.kind).to.equal('ok')
      if (result.kind === 'ok') {
        expect(result.value).to.equal(1_800_000)
        expect(result.displayValue).to.equal('30m')
      }
    })

    it('ms: rejects out-of-range (below min) using the duration form in the message', () => {
      const row = makeRow({key: 'llm.iterationBudgetMs', max: 3_600_000, min: 60_000, unit: 'ms'})
      const result = parseRowInput(row, '30s')
      expect(result.kind).to.equal('error')
      if (result.kind === 'error') {
        expect(result.message).to.match(/30s/)
        expect(result.message).to.match(/outside allowed range/)
      }
    })

    it('ms: rejects an unknown-unit input with the parser hint', () => {
      const row = makeRow({key: 'llm.iterationBudgetMs', max: 3_600_000, min: 60_000, unit: 'ms'})
      const result = parseRowInput(row, '10x')
      expect(result.kind).to.equal('error')
      if (result.kind === 'error') {
        expect(result.message).to.match(/try 30m, 1h, 1h 30m, or a raw ms integer/)
      }
    })

    it('rejects empty input on either unit', () => {
      const row = makeRow()
      expect(parseRowInput(row, '').kind).to.equal('error')
      expect(parseRowInput(row, '   ').kind).to.equal('error')
    })
  })

  describe('validateSettingInput — legacy helper', () => {
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
      expect(validateSettingInput('abc', descriptor)).to.include('integer')
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
