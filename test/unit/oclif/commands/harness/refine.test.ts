/**
 * Unit tests for `brv harness refine`.
 *
 * Tests the pure formatting functions and result interpretation.
 * The daemon transport interaction is verified via the integration test.
 */

import {expect} from 'chai'

import type {SynthesisResult} from '../../../../../src/agent/infra/harness/harness-synthesizer.js'

import {
  formatRefineResult,
  renderRefineText,
} from '../../../../../src/oclif/commands/harness/refine.js'

describe('HarnessRefine command — renderRefineText + formatRefineResult', () => {
  // Test 1: accepted result text output
  it('renders accepted refinement with version transition and delta H', () => {
    const result: SynthesisResult = {
      accepted: true,
      deltaH: 0.06,
      fromVersionId: 'v-abc',
      toVersionId: 'v-def',
    }

    const text = renderRefineText(result, 1, 2)

    expect(text).to.match(/accepted/i)
    expect(text).to.include('v1')
    expect(text).to.include('v2')
    expect(text).to.include('0.06')
  })

  // Test 2: rejected result text output with reason
  it('renders rejected refinement with reason', () => {
    const result: SynthesisResult = {
      accepted: false,
      deltaH: 0.03,
      fromVersionId: 'v-abc',
      reason: 'delta H was 0.03, below acceptance threshold',
    }

    const text = renderRefineText(result, 1)

    expect(text).to.match(/rejected/i)
    expect(text).to.include('delta H was 0.03')
  })

  // Test 3: undefined result (skipped — no parent, weak model, in-flight)
  it('renders skipped refinement when result is undefined', () => {
    const text = renderRefineText()

    expect(text).to.match(/no refinement|skipped|nothing to refine/i)
  })

  // Test 4: formatRefineResult produces JSON matching event payload shape
  it('formatRefineResult returns JSON with accepted payload', () => {
    const result: SynthesisResult = {
      accepted: true,
      deltaH: 0.06,
      fromVersionId: 'v-abc',
      toVersionId: 'v-def',
    }

    const json = formatRefineResult(result, 1, 2)

    expect(json.accepted).to.equal(true)
    expect(json.fromVersion).to.equal(1)
    expect(json.toVersion).to.equal(2)
  })

  // Test 5: formatRefineResult with rejected result
  it('formatRefineResult returns JSON with rejected payload', () => {
    const result: SynthesisResult = {
      accepted: false,
      fromVersionId: 'v-abc',
      reason: 'delta H was 0.03, below acceptance threshold',
    }

    const json = formatRefineResult(result, 1)

    expect(json.accepted).to.equal(false)
    expect(json.reason).to.include('delta H')
  })

  // Test 6: formatRefineResult with undefined result (skipped)
  it('formatRefineResult returns JSON with skipped payload', () => {
    const json = formatRefineResult()

    expect(json.accepted).to.equal(false)
    expect(json.reason).to.match(/skipped|no refinement/i)
  })
})
