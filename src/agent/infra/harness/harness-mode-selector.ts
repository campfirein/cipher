import type {HarnessMode} from '../../core/domain/harness/types.js'
import type {ValidatedHarnessConfig} from '../agent/agent-schemas.js'

export interface ModeSelection {
  readonly mode: HarnessMode
  readonly source: 'heuristic' | 'override'
}

// Thresholds per v1-design-decisions.md §2.2. Inclusive at the floor —
// matches the heuristic helper's inclusive semantics for realHarnessRate.
const MODE_C_FLOOR = 0.85
const MODE_B_FLOOR = 0.6
const MODE_A_FLOOR = 0.3

/**
 * Select the harness mode from a heuristic value and config. Returns
 * `undefined` when heuristic is below Mode A's floor AND no override
 * is set — callers should then leave the harness uninjected.
 */
export function selectHarnessMode(
  heuristic: number,
  config: ValidatedHarnessConfig,
): ModeSelection | undefined {
  if (config.modeOverride !== undefined) {
    return {mode: config.modeOverride, source: 'override'}
  }

  if (heuristic >= MODE_C_FLOOR) return {mode: 'policy', source: 'heuristic'}
  if (heuristic >= MODE_B_FLOOR) return {mode: 'filter', source: 'heuristic'}
  if (heuristic >= MODE_A_FLOOR) return {mode: 'assisted', source: 'heuristic'}

  return undefined
}
