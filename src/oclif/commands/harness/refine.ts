/**
 * `brv harness refine` — force-trigger a refinement attempt.
 *
 * Submits a `harness-refine` task to the daemon, which calls
 * `HarnessSynthesizer.refineIfNeeded` in the agent process. Waits
 * for the result (up to 60s) and prints the outcome.
 *
 * Respects the synthesizer's single-flight queue — if another
 * refinement is already in progress for the pair, the user sees
 * a "refinement already running" message and exits 0.
 */

import {Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import type {SynthesisResult} from '../../../agent/infra/harness/harness-synthesizer.js'

import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {HARNESS_NOT_ENABLED_REASON} from '../../../shared/constants/harness.js'
import {TaskEvents} from '../../../shared/transport/events/index.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {
  HARNESS_COMMAND_TYPES,
  isHarnessCommandType,
  openHarnessStoreForProject,
} from '../../lib/harness-cli.js'
import {waitForTaskCompletion} from '../../lib/task-client.js'

// ---------------------------------------------------------------------------
// Public types — tested directly by unit tests
// ---------------------------------------------------------------------------

export type RefineJsonPayload = {
  readonly accepted: boolean
  readonly fromVersion?: number
  readonly reason?: string
  readonly toVersion?: number
}

// ---------------------------------------------------------------------------
// Pure logic — unit-testable without oclif or daemon
// ---------------------------------------------------------------------------

/** Format the synthesis result for text output. */
export function renderRefineText(
  result?: SynthesisResult,
  fromVersion?: number,
  toVersion?: number,
): string {
  if (result === undefined) {
    return 'No refinement performed — nothing to refine or refinement already running.'
  }

  if (result.accepted) {
    const delta = result.deltaH === undefined ? '' : ` (ΔH: +${result.deltaH.toFixed(2)})`
    return `Refinement accepted — v${fromVersion} → v${toVersion}${delta}`
  }

  return `Refinement rejected — ${result.reason ?? 'unknown reason'}`
}

/** Build the JSON payload matching the event shape. */
export function formatRefineResult(
  result?: SynthesisResult,
  fromVersion?: number,
  toVersion?: number,
): RefineJsonPayload {
  if (result === undefined) {
    return {accepted: false, reason: 'no refinement performed — skipped'}
  }

  if (result.accepted) {
    return {
      accepted: true,
      fromVersion,
      toVersion,
    }
  }

  return {
    accepted: false,
    fromVersion,
    reason: result.reason,
  }
}

// ---------------------------------------------------------------------------
// oclif command
// ---------------------------------------------------------------------------

export default class HarnessRefine extends Command {
  static override description = 'Force-trigger a refinement attempt for a pair'
  static override flags = {
    commandType: Flags.string({
      default: 'curate',
      description: 'Harness pair command type',
      options: [...HARNESS_COMMAND_TYPES],
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['json', 'text'],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(HarnessRefine)

    if (!isHarnessCommandType(flags.commandType)) {
      this.error(`invalid --commandType value '${flags.commandType}'`, {exit: 1})
    }

    const format = flags.format === 'json' ? 'json' : 'text'
    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()

    // Read the current version number before refinement for display
    const opened = await openHarnessStoreForProject(projectRoot)
    let fromVersion: number | undefined
    if (opened) {
      try {
        const latest = await opened.store.getLatest(opened.projectId, flags.commandType)
        fromVersion = latest?.version
      } finally {
        opened.close()
      }
    }

    // Submit harness-refine task to daemon
    let taskResult: string | undefined
    try {
      taskResult = await withDaemonRetry(async (client) => {
        const taskId = randomUUID()
        const completionPromise = new Promise<string>((resolve, reject) => {
          waitForTaskCompletion(
            {
              client,
              command: 'harness refine',
              format,
              onCompleted: (r) => resolve(r.result ?? ''),
              onError: (r) => reject(new Error(r.error.message)),
              taskId,
              timeoutMs: 60_000,
            },
            () => {},
          ).catch(reject)
        })

        await client.requestWithAck(TaskEvents.CREATE, {
          clientCwd: process.cwd(),
          content: flags.commandType,
          projectPath: projectRoot,
          taskId,
          type: 'harness-refine',
        })

        return completionPromise
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (format === 'json') {
        this.log(JSON.stringify({accepted: false, error: message}, null, 2))
        this.exit(2)
      } else {
        this.error(`Refinement failed: ${message}`, {exit: 2})
      }

      return
    }

    // Parse the result from the agent process with minimal shape guard
    let synthesisResult: SynthesisResult | undefined
    try {
      const parsed: unknown = taskResult ? JSON.parse(taskResult) : undefined
      synthesisResult =
        parsed !== null && typeof parsed === 'object' && 'accepted' in parsed
          ? (parsed as SynthesisResult)
          : undefined
    } catch {
      synthesisResult = undefined
    }

    // Synthesizer unavailable — exit 2 per spec
    if (synthesisResult?.reason === HARNESS_NOT_ENABLED_REASON) {
      if (format === 'json') {
        this.log(JSON.stringify({accepted: false, error: HARNESS_NOT_ENABLED_REASON}, null, 2))
        this.exit(2)
      } else {
        this.error('Harness is not enabled — configure harness.enabled in .brv/config.json', {exit: 2})
      }

      return
    }

    // toVersion inferred — SynthesisResult carries toVersionId (UUID) but
    // not the numeric version. Safe for strictly sequential refinement.
    const toVersion = synthesisResult?.accepted ? (fromVersion === undefined ? undefined : fromVersion + 1) : undefined

    if (format === 'json') {
      this.log(JSON.stringify(formatRefineResult(synthesisResult, fromVersion, toVersion), null, 2))
    } else {
      this.log(renderRefineText(synthesisResult, fromVersion, toVersion))
    }
  }
}
