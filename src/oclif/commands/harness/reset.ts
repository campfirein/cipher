/**
 * `brv harness reset` — wipe all harness state for a pair.
 *
 * Deletes versions, outcomes, scenarios, and pin for a
 * `(projectId, commandType)` pair. Interactive confirmation prompt
 * by default; `--force` skips it for scripts + CI.
 */

import {confirm} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'

import type {IHarnessStore} from '../../../agent/core/interfaces/i-harness-store.js'

import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {
  HARNESS_COMMAND_TYPES,
  isHarnessCommandType,
  openHarnessStoreForProject,
} from '../../lib/harness-cli.js'

// ---------------------------------------------------------------------------
// Public types — tested directly by unit tests
// ---------------------------------------------------------------------------

export type ResetArtifactCounts = {
  readonly outcomes: number
  readonly scenarios: number
  readonly versions: number
}

// ---------------------------------------------------------------------------
// Pure logic — unit-testable without oclif
// ---------------------------------------------------------------------------

/**
 * Count artifacts that would be deleted. Shown in the confirmation
 * prompt so the user knows what they're about to lose.
 */
export async function countArtifacts(
  store: IHarnessStore,
  projectId: string,
  commandType: string,
): Promise<ResetArtifactCounts> {
  const [versions, outcomes, scenarios] = await Promise.all([
    store.listVersions(projectId, commandType),
    store.listOutcomes(projectId, commandType, Number.MAX_SAFE_INTEGER),
    store.listScenarios(projectId, commandType),
  ])

  return {
    outcomes: outcomes.length,
    scenarios: scenarios.length,
    versions: versions.length,
  }
}

/**
 * Delete every harness artifact for a `(projectId, commandType)` pair.
 * Order: outcomes → scenarios → versions (each version individually).
 */
export async function executeReset(
  store: IHarnessStore,
  projectId: string,
  commandType: string,
): Promise<ResetArtifactCounts> {
  const outcomesDeleted = await store.deleteOutcomes(projectId, commandType)
  const scenariosDeleted = await store.deleteScenarios(projectId, commandType)

  const versions = await store.listVersions(projectId, commandType)
  for (const v of versions) {
    // eslint-disable-next-line no-await-in-loop
    await store.deleteVersion(projectId, commandType, v.id)
  }

  await store.deletePin(projectId, commandType)

  return {
    outcomes: outcomesDeleted,
    scenarios: scenariosDeleted,
    versions: versions.length,
  }
}

/** Format the reset result for text output. */
export function renderResetText(counts: ResetArtifactCounts): string {
  const total = counts.versions + counts.outcomes + counts.scenarios
  if (total === 0) return 'Nothing to delete — pair has no stored state.'

  const parts: string[] = []
  if (counts.versions > 0) parts.push(`${counts.versions} version${counts.versions === 1 ? '' : 's'}`)
  if (counts.outcomes > 0) parts.push(`${counts.outcomes} outcome${counts.outcomes === 1 ? '' : 's'}`)
  if (counts.scenarios > 0) parts.push(`${counts.scenarios} scenario${counts.scenarios === 1 ? '' : 's'}`)

  return `Deleted ${parts.join(', ')}.`
}

// ---------------------------------------------------------------------------
// oclif command
// ---------------------------------------------------------------------------

export default class HarnessReset extends Command {
  static override description = 'Delete all harness state for a (project, commandType) pair'
  static override flags = {
    commandType: Flags.string({
      default: 'curate',
      description: 'Harness pair command type',
      options: [...HARNESS_COMMAND_TYPES],
    }),
    force: Flags.boolean({
      default: false,
      description: 'Skip confirmation prompt',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['json', 'text'],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(HarnessReset)

    if (!isHarnessCommandType(flags.commandType)) {
      this.error(`invalid --commandType value '${flags.commandType}'`, {exit: 1})
    }

    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()
    const opened = await openHarnessStoreForProject(projectRoot)

    if (!opened) {
      const msg = 'Nothing to delete — pair has no stored state.'
      if (flags.format === 'json') {
        this.log(JSON.stringify({outcomes: 0, scenarios: 0, versions: 0}, null, 2))
      } else {
        this.log(msg)
      }

      return
    }

    try {
      const {projectId, store} = opened

      if (!flags.force) {
        const counts = await countArtifacts(store, projectId, flags.commandType)
        const total = counts.versions + counts.outcomes + counts.scenarios

        if (total === 0) {
          const msg = 'Nothing to delete — pair has no stored state.'
          if (flags.format === 'json') {
            this.log(JSON.stringify({outcomes: 0, scenarios: 0, versions: 0}, null, 2))
          } else {
            this.log(msg)
          }

          return
        }

        const lines = [
          `This will delete for (${flags.commandType}):`,
          `  ${counts.versions} version${counts.versions === 1 ? '' : 's'}`,
          `  ${counts.outcomes} outcome${counts.outcomes === 1 ? '' : 's'}`,
          `  ${counts.scenarios} scenario${counts.scenarios === 1 ? '' : 's'}`,
        ]
        this.log(lines.join('\n'))

        const proceed = await confirm({default: false, message: 'Proceed with reset?'})
        if (!proceed) {
          this.log('Reset cancelled.')
          return
        }
      }

      const result = await executeReset(store, projectId, flags.commandType)

      if (flags.format === 'json') {
        this.log(JSON.stringify(result, null, 2))
      } else {
        this.log(renderResetText(result))
      }
    } finally {
      opened.close()
    }
  }
}
