import {expect} from 'chai'

import type {BaselineReport} from '../../../../../src/agent/infra/harness/harness-baseline-runner.js'

import {
  renderBaselineText,
  toBaselineJsonReport,
} from '../../../../../src/oclif/commands/harness/baseline.js'

function makeReport(overrides: Partial<BaselineReport> = {}): BaselineReport {
  return {
    delta: 0.5,
    harnessSuccessRate: 0.75,
    perScenario: [
      {harnessSuccess: true, rawStderr: 'boom', rawSuccess: false, scenarioId: 's-1'},
      {harnessSuccess: true, rawStderr: 'boom', rawSuccess: false, scenarioId: 's-2'},
      {harnessSuccess: true, rawSuccess: true, scenarioId: 's-3'},
      {harnessStderr: 'crash', harnessSuccess: false, rawSuccess: true, scenarioId: 's-4'},
    ],
    rawSuccessRate: 0.25,
    scenarioCount: 4,
    ...overrides,
  }
}

describe('HarnessBaseline command — toBaselineJsonReport + renderBaselineText', () => {
  describe('toBaselineJsonReport', () => {
    it('1. maps per-scenario outcomes to the handoff §C2 "success"/"failure" shape', () => {
      const json = toBaselineJsonReport(makeReport())
      expect(json.perScenario).to.deep.equal([
        {harnessOutcome: 'success', rawOutcome: 'failure', scenarioId: 's-1'},
        {harnessOutcome: 'success', rawOutcome: 'failure', scenarioId: 's-2'},
        {harnessOutcome: 'success', rawOutcome: 'success', scenarioId: 's-3'},
        {harnessOutcome: 'failure', rawOutcome: 'success', scenarioId: 's-4'},
      ])
    })

    it('2. propagates scalar fields unchanged (rates + delta + count)', () => {
      const json = toBaselineJsonReport(makeReport())
      expect(json.scenarioCount).to.equal(4)
      expect(json.rawSuccessRate).to.equal(0.25)
      expect(json.harnessSuccessRate).to.equal(0.75)
      expect(json.delta).to.equal(0.5)
    })

    it('3. JSON shape does not leak stderr fields (pinned contract)', () => {
      const json = toBaselineJsonReport(makeReport())
      for (const entry of json.perScenario) {
        expect(Object.keys(entry).sort()).to.deep.equal(['harnessOutcome', 'rawOutcome', 'scenarioId'])
      }
    })
  })

  describe('renderBaselineText', () => {
    it('1. renders a human-readable summary block with rates + delta', () => {
      const text = renderBaselineText(makeReport())
      expect(text).to.include('scenarios: 4')
      expect(text).to.include('raw:       25%')
      expect(text).to.include('harness:   75%')
      expect(text).to.match(/delta:\s+\+0\.50/)
    })

    it('2. prefixes delta with "+" when positive, bare "-" when negative', () => {
      const positive = renderBaselineText(makeReport({delta: 0.3}))
      expect(positive).to.match(/delta:\s+\+0\.30/)
      const negative = renderBaselineText(makeReport({delta: -0.2}))
      expect(negative).to.match(/delta:\s+-0\.20/)
    })

    it('3. includes per-scenario rows with ✓/✗ markers', () => {
      const text = renderBaselineText(makeReport())
      expect(text).to.include('✗ raw  ✓ harness  s-1')
      expect(text).to.include('✓ raw  ✗ harness  s-4')
    })

    it('4. appends stderr text when either arm surfaced one', () => {
      const text = renderBaselineText(makeReport())
      expect(text).to.include('raw: boom')
      expect(text).to.include('harness: crash')
    })

    it('5. scenarios with no stderr get the row alone (no trailing error line)', () => {
      const text = renderBaselineText(makeReport({
        perScenario: [
          {harnessSuccess: true, rawSuccess: true, scenarioId: 's-ok'},
        ],
      }))
      // The row is present, and no "raw: " or "harness: " error payload follows.
      expect(text).to.include('✓ raw  ✓ harness  s-ok')
      expect(text).to.not.match(/s-ok\n\s+(raw|harness): /)
    })
  })
})
