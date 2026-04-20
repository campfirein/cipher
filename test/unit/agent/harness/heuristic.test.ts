import {expect} from 'chai'

import type {CodeExecOutcome} from '../../../../src/agent/core/domain/harness/types.js'

import {computeHeuristic} from '../../../../src/agent/core/domain/harness/heuristic.js'

const NOW = 1_700_000_000_000
const DAY_MS = 24 * 60 * 60 * 1000

function outcome(overrides: Partial<CodeExecOutcome> = {}): CodeExecOutcome {
  return {
    code: 'tools.search("x")',
    commandType: 'curate',
    executionTimeMs: 10,
    id: `o-${Math.random().toString(36).slice(2)}`,
    projectId: 'p',
    projectType: 'typescript',
    sessionId: 's',
    success: true,
    timestamp: NOW,
    usedHarness: false,
    ...overrides,
  }
}

describe('computeHeuristic', () => {
  // ── Min-sample floor ──────────────────────────────────────────────────────

  it('returns null for empty input', () => {
    expect(computeHeuristic([], NOW)).to.equal(null)
  })

  it('returns null for 9 outcomes (below floor)', () => {
    const outcomes = Array.from({length: 9}, () => outcome({success: true, usedHarness: true}))
    expect(computeHeuristic(outcomes, NOW)).to.equal(null)
  })

  // ── At min-sample ─────────────────────────────────────────────────────────

  it('returns a real number in (0, 1] at n=10 with all-success, all-real-harness', () => {
    const outcomes = Array.from({length: 10}, () =>
      outcome({delegated: false, success: true, usedHarness: true}),
    )
    const h = computeHeuristic(outcomes, NOW)
    expect(h).to.be.a('number')
    // success=1, errorRate=0, realHarness=1 → 0.2 + 0.3 + 0.5 = 1.0
    expect(h).to.equal(1)
  })

  // ── Window cap ────────────────────────────────────────────────────────────

  it('uses only the most recent 50 outcomes when 100 are supplied', () => {
    // 50 recent: delegated, success=false, usedHarness=true, stderr empty
    //   → successRate=0, errorRate=0, realHarness=0 → 0.2·0 + 0.3·1 + 0 = 0.3
    // 50 older: real harness, success=true, no stderr
    //   → would give H near 1 if included
    // With the recent 50 dominating, H should land at 0.3, not ≈1.
    const recent: CodeExecOutcome[] = Array.from({length: 50}, (_, i) =>
      outcome({
        delegated: true,
        success: false,
        timestamp: NOW - i, // distinct, most recent
        usedHarness: true,
      }),
    )
    const older: CodeExecOutcome[] = Array.from({length: 50}, (_, i) =>
      outcome({
        delegated: false,
        success: true,
        timestamp: NOW - (1000 + i), // older than every `recent`
        usedHarness: true,
      }),
    )

    const h = computeHeuristic([...recent, ...older], NOW)
    expect(h).to.be.closeTo(0.3, 1e-9)
  })

  // ── Decay ─────────────────────────────────────────────────────────────────

  it('weights recent outcomes more heavily than 60-day-old ones', () => {
    // 10 fresh all-zero outcomes: success=false, stderr='err', delegated
    //   fresh contribution to rates: successRate=0, errorRate=1, realHarness=0 → H ≈ 0.2·0 + 0.3·0 + 0 = 0
    // 10 @ 60d all-one outcomes: success=true, no stderr, real harness
    //   @60d contribution to rates: successRate=1, errorRate=0, realHarness=1 → H ≈ 1
    // weight ratio fresh:old = 1 : exp(-60/30) = 1 : e^-2 ≈ 1 : 0.1353
    // Fresh dominates — H should be well under 0.5, not well over.
    const fresh: CodeExecOutcome[] = Array.from({length: 10}, () =>
      outcome({
        delegated: true,
        stderr: 'err',
        success: false,
        timestamp: NOW,
        usedHarness: true,
      }),
    )
    const old: CodeExecOutcome[] = Array.from({length: 10}, () =>
      outcome({
        delegated: false,
        success: true,
        timestamp: NOW - 60 * DAY_MS,
        usedHarness: true,
      }),
    )

    const h = computeHeuristic([...fresh, ...old], NOW)
    expect(h).to.be.a('number')
    // If no decay, H would be the unweighted average → 0.5. With e^-2
    // decay on the old outcomes, H should lean heavily toward the fresh
    // (0-ish) side.
    expect(h).to.be.lessThan(0.2)
  })

  // ── Pass-through cap (Tier 1 A2) ──────────────────────────────────────────
  //
  // The invariant: any window where every outcome has `delegated: true`
  // caps at H ≤ 0.5 (well inside the ≤ 0.55 budget the design doc
  // requires). With `realHarnessRate = 0`, the formula reduces to
  // `H = 0.2·successRate + 0.3·(1 − errorRate)`, both rates ∈ [0, 1].
  // Four deterministic corner cases pin the four extremes of the
  // (successRate, errorRate) plane — any implementation drift in the
  // weights or in the `realHarnessRate` condition shifts at least one
  // of these four to a wrong exact value.

  it('pass-through cap: all-delegated + all-success + no stderr → H = 0.5 (max)', () => {
    const outcomes = Array.from({length: 10}, (_, i) =>
      outcome({
        delegated: true,
        success: true,
        timestamp: NOW - i,
        usedHarness: true,
      }),
    )
    const h = computeHeuristic(outcomes, NOW)
    expect(h).to.be.closeTo(0.5, 1e-9)
  })

  it('pass-through cap: all-delegated + all-success + all stderr → H = 0.2', () => {
    const outcomes = Array.from({length: 10}, (_, i) =>
      outcome({
        delegated: true,
        stderr: 'warning',
        success: true,
        timestamp: NOW - i,
        usedHarness: true,
      }),
    )
    const h = computeHeuristic(outcomes, NOW)
    expect(h).to.be.closeTo(0.2, 1e-9)
  })

  it('pass-through cap: all-delegated + all-fail + no stderr → H = 0.3', () => {
    const outcomes = Array.from({length: 10}, (_, i) =>
      outcome({
        delegated: true,
        success: false,
        timestamp: NOW - i,
        usedHarness: true,
      }),
    )
    const h = computeHeuristic(outcomes, NOW)
    expect(h).to.be.closeTo(0.3, 1e-9)
  })

  it('pass-through cap: all-delegated + all-fail + all stderr → H = 0 (min)', () => {
    const outcomes = Array.from({length: 10}, (_, i) =>
      outcome({
        delegated: true,
        stderr: 'error',
        success: false,
        timestamp: NOW - i,
        usedHarness: true,
      }),
    )
    const h = computeHeuristic(outcomes, NOW)
    expect(h).to.be.closeTo(0, 1e-9)
  })

  // ── Defensive clamp against future timestamps ─────────────────────────────

  it('clamps H to [0, 1] when future timestamps produce weights > 1', () => {
    // timestamp = NOW + 1_000_000 ms ⇒ ageDays ≈ −0.0116 ⇒ weight ≈ 1.0004.
    // The weighted-average math still normalizes, so H naturally stays
    // in [0, 1]. The clamp is a belt-and-braces guard; this test asserts
    // the invariant rather than exercising an out-of-range code path.
    const outcomes = Array.from({length: 10}, () =>
      outcome({
        delegated: false,
        success: true,
        timestamp: NOW + 1_000_000,
        usedHarness: true,
      }),
    )
    const h = computeHeuristic(outcomes, NOW)
    expect(h).to.be.a('number')
    expect(h).to.be.within(0, 1)
  })
})
