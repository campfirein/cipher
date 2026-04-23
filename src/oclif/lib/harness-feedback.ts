/**
 * AutoHarness V2 — CLI-side feedback attach helper.
 *
 * Shared logic for `brv curate --feedback` and `brv query --feedback`
 * (Phase 7 Task 7.4, brutal-review Tier 2 D4). Implements §C5 of the
 * handoff contract:
 *
 *   - Target the MOST RECENT `CodeExecOutcome` for
 *     `(projectId, commandType)`.
 *   - Call the recorder's `attachFeedback` — Phase 6 Task 6.5's
 *     weighting policy (3x synthetic failures for `'bad'`, 1x
 *     synthetic success for `'good'`) lives there.
 *   - Repeat invocation with a different verdict replaces the
 *     previous synthetics (idempotent re-label).
 *
 * Harness-disabled / no-outcome cases surface as typed errors so the
 * calling command can choose between "warn + exit 0" (disabled) and
 * "error + exit 1" (missing outcome) per §C1.
 */

import type {IHarnessStore} from '../../agent/core/interfaces/i-harness-store.js'
import type {ValidatedHarnessConfig} from '../../agent/infra/agent/agent-schemas.js'

import {NoOpLogger} from '../../agent/core/interfaces/i-logger.js'
import {SessionEventBus} from '../../agent/infra/events/event-emitter.js'
import {
  BAD_SYNTHETIC_COUNT,
  GOOD_SYNTHETIC_COUNT,
  HarnessOutcomeRecorder,
  SYNTHETIC_DELIMITER,
} from '../../agent/infra/harness/harness-outcome-recorder.js'
import {openHarnessStoreForProject, readHarnessFeatureConfig} from './harness-cli.js'

export type FeedbackVerdict = 'bad' | 'good'

/**
 * Scan depth when hunting for the most-recent NON-synthetic outcome.
 * 10 feedback synthetics (bad=3, good=1 × several re-labels) can
 * precede a real outcome in the worst case; 50 gives comfortable
 * headroom without unbounded store reads.
 *
 * `BAD_SYNTHETIC_COUNT`, `GOOD_SYNTHETIC_COUNT`, and
 * `SYNTHETIC_DELIMITER` are re-used from `HarnessOutcomeRecorder`
 * (the canonical owner of the §C2 weighting policy) to prevent
 * drift — redeclaring them here would silently diverge on a policy
 * change.
 */
const FEEDBACK_SCAN_LIMIT = 50

export interface FeedbackResult {
  readonly outcomeId: string
  readonly syntheticCount: number
  readonly verdict: FeedbackVerdict
}

export type FeedbackErrorCode = 'HARNESS_DISABLED' | 'NO_RECENT_OUTCOME' | 'NO_STORAGE'

export class FeedbackError extends Error {
  constructor(
    message: string,
    public readonly code: FeedbackErrorCode,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'FeedbackError'
  }
}

/**
 * Attach `verdict` to the most recent outcome for the current
 * `(projectRoot, commandType)` pair. Returns the outcome id and the
 * number of synthetic rows the recorder inserted.
 *
 * @throws {FeedbackError} `HARNESS_DISABLED` when `.brv/config.json`
 *   has `harness.enabled !== true` — the primary action already ran;
 *   caller should warn-log and exit 0.
 * @throws {FeedbackError} `NO_STORAGE` when the project has no XDG
 *   storage dir yet (daemon never wrote for this project) — exit 1.
 * @throws {FeedbackError} `NO_RECENT_OUTCOME` when `listOutcomes`
 *   returns empty for the pair — exit 1 with a hint to run
 *   curate/query first.
 */
export async function attachFeedbackFromCli(
  projectRoot: string,
  commandType: 'curate' | 'query',
  verdict: FeedbackVerdict,
): Promise<FeedbackResult> {
  const config = await readHarnessFeatureConfig(projectRoot)
  if (!config.enabled) {
    throw new FeedbackError(
      `harness is disabled — --feedback requires enabled harness in .brv/config.json.`,
      'HARNESS_DISABLED',
      {commandType, projectRoot},
    )
  }

  const opened = await openHarnessStoreForProject(projectRoot)
  if (opened === undefined) {
    throw new FeedbackError(
      `no harness storage for this project (${projectRoot}) — run curate/query first.`,
      'NO_STORAGE',
      {projectRoot},
    )
  }

  try {
    return await attachFeedbackToStore(opened.store, opened.projectId, commandType, verdict, config)
  } finally {
    opened.close()
  }
}

/**
 * Pure-store variant: does the full most-recent-lookup + recorder
 * delegation against an explicit `IHarnessStore`. Exported for unit
 * tests that want to exercise the feedback logic without the XDG
 * filesystem dance.
 *
 * Phase 6 Task 6.5's `HarnessOutcomeRecorder.attachFeedback` is the
 * canonical path for the weighting policy (3x synthetic failures for
 * `'bad'`, 1x synthetic success for `'good'`). We construct a
 * minimal recorder here because `attachFeedback` only reads
 * `this.store` and `this.logger` — `sessionEventBus` / `config` are
 * untouched by that method. Duplicating the weighting logic here
 * would drift from the recorder on a policy change.
 */
export async function attachFeedbackToStore(
  store: IHarnessStore,
  projectId: string,
  commandType: 'curate' | 'query',
  verdict: FeedbackVerdict,
  feature: {readonly autoLearn: boolean; readonly enabled: boolean},
): Promise<FeedbackResult> {
  // Skip feedback synthetics: they carry `Date.now()` timestamps so
  // would otherwise shadow the real outcome in a "most recent" scan.
  // A re-label (`--feedback good` then `--feedback bad`) must target
  // the original user outcome, not the synthetic from the first call.
  const recent = await store.listOutcomes(projectId, commandType, FEEDBACK_SCAN_LIMIT)
  const mostRecent = recent.find((o) => !o.id.includes(SYNTHETIC_DELIMITER))
  if (mostRecent === undefined) {
    throw new FeedbackError(
      `no recent outcome to flag — run ${commandType} first.`,
      'NO_RECENT_OUTCOME',
      {commandType, projectId},
    )
  }

  const recorder = buildCliRecorder(store, feature)
  await recorder.attachFeedback(projectId, commandType, mostRecent.id, verdict)

  return {
    outcomeId: mostRecent.id,
    syntheticCount: verdict === 'bad' ? BAD_SYNTHETIC_COUNT : GOOD_SYNTHETIC_COUNT,
    verdict,
  }
}

/**
 * Construct a minimal `HarnessOutcomeRecorder` for CLI use.
 *
 * `attachFeedback` only reads `store` and `logger` off the recorder —
 * verified in `harness-outcome-recorder.ts`. The `sessionEventBus`
 * and hot-path `config.enabled` checks live in other methods, so
 * the stubs here are safe for the feedback-attach path.
 *
 * Exposed for unit tests that want to seed the recorder from a
 * test-double store; callers should prefer `attachFeedbackFromCli`.
 */
export function buildCliRecorder(
  store: IHarnessStore,
  feature: {readonly autoLearn: boolean; readonly enabled: boolean},
): HarnessOutcomeRecorder {
  const validatedConfig: ValidatedHarnessConfig = {
    autoLearn: feature.autoLearn,
    enabled: feature.enabled,
    language: 'auto',
    maxVersions: 20,
  }
  return new HarnessOutcomeRecorder(store, new SessionEventBus(), new NoOpLogger(), validatedConfig)
}

export type {CodeExecOutcome} from '../../agent/core/domain/harness/types.js'
