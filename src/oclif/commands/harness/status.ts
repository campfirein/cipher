/**
 * `brv harness status` — AutoHarness V2 Phase 7 Task 7.1.
 *
 * Read-only summary of harness state for a `(project, commandType)`
 * pair. Text output is human-oriented; `--format json` emits the shape
 * pinned in `phase_7_8_handoff.md §C2` (consumed by Phase 8's smoke
 * script and KPI harness, so key renames are a handoff break).
 *
 * `status` never errors — a missing store, no version, or a disabled
 * flag all print a clear message and exit `0` per handoff §C1.
 */

import {Command, Flags} from '@oclif/core'

import type {HarnessVersion} from '../../../agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../agent/core/interfaces/i-harness-store.js'
import type {HarnessFeatureConfig} from '../../lib/harness-cli.js'

import {selectHarnessMode} from '../../../agent/infra/harness/harness-mode-selector.js'
import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {openHarnessStoreForProject, readHarnessFeatureConfig} from '../../lib/harness-cli.js'

const COMMAND_TYPES = ['chat', 'curate', 'query'] as const
type HarnessCommandType = (typeof COMMAND_TYPES)[number]

export interface LastRefinement {
  readonly acceptedAt: number
  readonly deltaH: number
  readonly fromVersion: number
  readonly toVersion: number
}

export interface StatusReport {
  readonly autoLearn: boolean
  readonly commandType: HarnessCommandType
  readonly currentVersion: null | number
  readonly currentVersionId: null | string
  readonly enabled: boolean
  readonly heuristic: null | number
  readonly lastRefinement?: LastRefinement
  readonly mode: 'assisted' | 'filter' | 'policy' | null
  readonly outcomeCount: number
  readonly outcomesWithFeedback: number
  readonly projectId: string
}

export interface StatusInputs {
  readonly commandType: HarnessCommandType
  readonly featureConfig: HarnessFeatureConfig
  readonly projectId: string
  readonly store: IHarnessStore | undefined
}

/**
 * Build a `StatusReport` from live store reads.
 *
 * Pure logic, no I/O beyond the `IHarnessStore` calls — the oclif
 * `run()` wrapper injects a resolved store or `undefined`.
 */
export async function buildStatusReport(inputs: StatusInputs): Promise<StatusReport> {
  const {commandType, featureConfig, projectId, store} = inputs

  if (store === undefined) {
    return {
      autoLearn: featureConfig.autoLearn,
      commandType,
      currentVersion: null,
      currentVersionId: null,
      enabled: featureConfig.enabled,
      heuristic: null,
      mode: null,
      outcomeCount: 0,
      outcomesWithFeedback: 0,
      projectId,
    }
  }

  // Fetch current version, every version (for lastRefinement lookup),
  // and the complete outcomes set. Passing `MAX_SAFE_INTEGER` is the
  // documented "give me everything" idiom for `HarnessStore.listOutcomes` —
  // it walks the key partition and slices; no pathological cost at v1.0
  // scale (outcomes cap well under 1k per pair in normal use).
  const [currentVersion, allVersions, outcomes] = await Promise.all([
    store.getLatest(projectId, commandType),
    store.listVersions(projectId, commandType),
    store.listOutcomes(projectId, commandType, Number.MAX_SAFE_INTEGER),
  ])

  if (currentVersion === undefined) {
    return {
      autoLearn: featureConfig.autoLearn,
      commandType,
      currentVersion: null,
      currentVersionId: null,
      enabled: featureConfig.enabled,
      heuristic: null,
      mode: null,
      outcomeCount: outcomes.length,
      outcomesWithFeedback: outcomes.filter((o) => o.userFeedback === 'bad' || o.userFeedback === 'good').length,
      projectId,
    }
  }

  const modeSelection = selectHarnessMode(currentVersion.heuristic, {
    autoLearn: featureConfig.autoLearn,
    enabled: featureConfig.enabled,
    language: 'auto',
    maxVersions: 20,
  })

  const lastRefinement = findLastRefinement(allVersions)
  return {
    autoLearn: featureConfig.autoLearn,
    commandType,
    currentVersion: currentVersion.version,
    currentVersionId: currentVersion.id,
    enabled: featureConfig.enabled,
    heuristic: currentVersion.heuristic,
    ...(lastRefinement === undefined ? {} : {lastRefinement}),
    mode: modeSelection?.mode ?? null,
    outcomeCount: outcomes.length,
    outcomesWithFeedback: outcomes.filter((o) => o.userFeedback === 'bad' || o.userFeedback === 'good').length,
    projectId,
  }
}

/**
 * The most recent refinement = the highest-`version` version that has
 * a `parentId`. Returns `undefined` when no version is a refinement
 * (only a v1 bootstrap exists).
 */
function findLastRefinement(allVersions: readonly HarnessVersion[]): LastRefinement | undefined {
  const refined = allVersions.filter((v) => v.parentId !== undefined)
  if (refined.length === 0) return undefined

  // `listVersions` returns newest-first by `version`, so refined[0] is
  // the latest refinement. Look up its parent for the deltaH computation.
  const [latest] = refined
  const parent = allVersions.find((v) => v.id === latest.parentId)
  if (parent === undefined) return undefined

  return {
    acceptedAt: latest.createdAt,
    deltaH: latest.heuristic - parent.heuristic,
    fromVersion: parent.version,
    toVersion: latest.version,
  }
}

export function renderStatusText(report: StatusReport): string {
  const enabledLabel = report.enabled ? `enabled (autoLearn: ${report.autoLearn})` : 'disabled'
  const lines: string[] = [
    `harness: ${enabledLabel}`,
    `project: ${report.projectId}`,
    `command: ${report.commandType}`,
  ]

  if (report.currentVersionId === null || report.currentVersion === null) {
    lines.push('version: <none — run curate once to bootstrap>')
  } else {
    const h = report.heuristic === null ? 'n/a' : report.heuristic.toFixed(2)
    const mode = report.mode ?? 'below Mode A floor'
    lines.push(
      `version: ${report.currentVersionId} (#${report.currentVersion})  H: ${h}  mode: ${mode}`,
    )
  }

  lines.push(
    `outcomes: ${report.outcomeCount} recorded (${report.outcomesWithFeedback} w/ feedback)`,
  )

  if (report.lastRefinement !== undefined) {
    const {acceptedAt, deltaH, fromVersion, toVersion} = report.lastRefinement
    const ago = humaniseAgo(Date.now() - acceptedAt)
    const sign = deltaH >= 0 ? '+' : ''
    lines.push(
      `last refinement: accepted ${ago} ago  v${fromVersion} → v${toVersion}  ΔH: ${sign}${deltaH.toFixed(2)}`,
    )
  }

  return lines.join('\n')
}

function humaniseAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`
  return `${Math.round(ms / 86_400_000)}d`
}

export default class HarnessStatus extends Command {
  static description = 'Show current harness state for a (project, commandType) pair'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --commandType query',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  static flags = {
    commandType: Flags.string({
      default: 'curate',
      description: 'Harness pair command type',
      options: [...COMMAND_TYPES],
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(HarnessStatus)
    const commandType = flags.commandType as HarnessCommandType
    const format = flags.format === 'json' ? 'json' : 'text'

    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()
    const featureConfig = await readHarnessFeatureConfig(projectRoot)
    const opened = await openHarnessStoreForProject(projectRoot)

    try {
      const report = await buildStatusReport({
        commandType,
        featureConfig,
        projectId: opened?.projectId ?? projectRoot,
        store: opened?.store,
      })

      if (format === 'json') {
        this.log(JSON.stringify(report, null, 2))
      } else {
        this.log(renderStatusText(report))
      }
    } finally {
      opened?.close()
    }
  }
}
