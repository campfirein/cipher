import {expect} from 'chai'

import type {ValidatedHarnessConfig} from '../../../../src/agent/infra/agent/agent-schemas.js'

import {selectHarnessMode} from '../../../../src/agent/infra/harness/harness-mode-selector.js'

function makeConfig(overrides: Partial<ValidatedHarnessConfig> = {}): ValidatedHarnessConfig {
  return {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
    ...overrides,
  }
}

// Deterministic LCG used by the property test — keeps the seed stable
// across runs so a drift in the threshold table fails identically on
// every machine. Constants from Numerical Recipes.
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32
    return state / 2 ** 32
  }
}

describe('selectHarnessMode', () => {
  // ── Heuristic-driven threshold boundaries ────────────────────────────────

  it('1. heuristic=0.29 (just below Mode A) returns undefined', () => {
    expect(selectHarnessMode(0.29, makeConfig())).to.equal(undefined)
  })

  it('2. heuristic=0.30 (Mode A floor) returns assisted', () => {
    expect(selectHarnessMode(0.3, makeConfig())).to.deep.equal({
      mode: 'assisted',
      source: 'heuristic',
    })
  })

  it('3. heuristic=0.59 (just below Mode B) returns assisted', () => {
    expect(selectHarnessMode(0.59, makeConfig())).to.deep.equal({
      mode: 'assisted',
      source: 'heuristic',
    })
  })

  it('4. heuristic=0.60 (Mode B floor) returns filter', () => {
    expect(selectHarnessMode(0.6, makeConfig())).to.deep.equal({
      mode: 'filter',
      source: 'heuristic',
    })
  })

  it('5. heuristic=0.84 (just below Mode C) returns filter', () => {
    expect(selectHarnessMode(0.84, makeConfig())).to.deep.equal({
      mode: 'filter',
      source: 'heuristic',
    })
  })

  it('6. heuristic=0.85 (Mode C floor) returns policy', () => {
    expect(selectHarnessMode(0.85, makeConfig())).to.deep.equal({
      mode: 'policy',
      source: 'heuristic',
    })
  })

  it('7. heuristic=1.00 (top) returns policy', () => {
    expect(selectHarnessMode(1, makeConfig())).to.deep.equal({
      mode: 'policy',
      source: 'heuristic',
    })
  })

  // ── Override semantics ──────────────────────────────────────────────────

  it('8. modeOverride=policy + heuristic=0.05 returns policy/override', () => {
    expect(
      selectHarnessMode(0.05, makeConfig({modeOverride: 'policy'})),
    ).to.deep.equal({mode: 'policy', source: 'override'})
  })

  it('9. modeOverride=assisted + heuristic=0.95 returns assisted/override', () => {
    expect(
      selectHarnessMode(0.95, makeConfig({modeOverride: 'assisted'})),
    ).to.deep.equal({mode: 'assisted', source: 'override'})
  })

  // ── Property test (drift guard) ─────────────────────────────────────────

  it('10. property test: 100 random heuristics honor the threshold table', () => {
    const rand = lcg(42) // stable seed — reproducible across runs
    for (let i = 0; i < 100; i++) {
      const h = rand()
      const result = selectHarnessMode(h, makeConfig())
      if (h < 0.3) {
        expect(result, `h=${h}`).to.equal(undefined)
      } else if (h < 0.6) {
        expect(result, `h=${h}`).to.deep.equal({mode: 'assisted', source: 'heuristic'})
      } else if (h < 0.85) {
        expect(result, `h=${h}`).to.deep.equal({mode: 'filter', source: 'heuristic'})
      } else {
        expect(result, `h=${h}`).to.deep.equal({mode: 'policy', source: 'heuristic'})
      }
    }
  })
})
