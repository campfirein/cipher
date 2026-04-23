/**
 * `brv harness use <version-ref>` — AutoHarness V2 Phase 7 Task 7.2.
 *
 * Pins a specific harness version as the one the sandbox loads,
 * overriding the default `getLatest` behaviour. Closes brutal-review
 * item Tier 2 D2 (manual rollback without disabling the whole
 * feature).
 *
 * Exits `1` on unresolvable refs per handoff §C1. JSON shape is
 * pinned to §C2's `use` entry.
 */

import {Args, Command, Flags} from '@oclif/core'

import type {HarnessVersion} from '../../../agent/core/domain/harness/types.js'
import type {IHarnessStore} from '../../../agent/core/interfaces/i-harness-store.js'

import {selectHarnessMode} from '../../../agent/infra/harness/harness-mode-selector.js'
import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {
  HARNESS_COMMAND_TYPES,
  type HarnessCommandType,
  isHarnessCommandType,
  openHarnessStoreForProject,
} from '../../lib/harness-cli.js'
import {resolveVersionRef, VersionRefError} from '../../lib/resolve-version-ref.js'

export interface UseReport {
  readonly newMode: 'assisted' | 'filter' | 'policy' | null
  readonly pinnedVersionId: string
  readonly previousVersionId: null | string
}

export interface UseInputs {
  readonly commandType: HarnessCommandType
  readonly pinnedVersion: HarnessVersion
  readonly previousVersionId: null | string
  readonly projectId: string
  readonly store: IHarnessStore
}

/**
 * Pin `pinnedVersion` for `(projectId, commandType)` and compute the
 * resulting mode from the pinned version's stored H.
 *
 * Mode derivation mirrors the sandbox's own `selectHarnessMode` call
 * (same thresholds, same override behavior). The stored H is used
 * as-is rather than recomputing from recent outcomes — the user's
 * explicit choice of version beats whatever the heuristic would say
 * today, which is the whole point of pinning.
 */
export async function applyPin(inputs: UseInputs): Promise<UseReport> {
  const {commandType, pinnedVersion, previousVersionId, projectId, store} = inputs

  await store.setPin({
    commandType,
    pinnedAt: Date.now(),
    pinnedVersionId: pinnedVersion.id,
    projectId,
  })

  // `selectHarnessMode` only reads `modeOverride` off the config — the
  // other fields (`autoLearn`, `enabled`, `language`, `maxVersions`)
  // are required by the schema but ignored by the selector. Hardcoding
  // them to schema defaults keeps the CLI honest about what it can
  // honour: v1.0 doesn't plumb `modeOverride` into `HarnessFeatureConfig`,
  // so reporting a `newMode` that disagrees with a user-pinned override
  // is a known gap. When 7.4 / daemon-side wiring surfaces
  // `modeOverride` to the CLI, thread it through here.
  const modeSelection = selectHarnessMode(pinnedVersion.heuristic, {
    autoLearn: true,
    enabled: true,
    language: 'auto',
    maxVersions: 20,
  })

  return {
    newMode: modeSelection?.mode ?? null,
    pinnedVersionId: pinnedVersion.id,
    previousVersionId,
  }
}

export function renderUseText(report: UseReport): string {
  const prev = report.previousVersionId ?? '<none>'
  const mode = report.newMode ?? 'below Mode A floor'
  return [
    `pinned: ${report.pinnedVersionId}`,
    `was:    ${prev}`,
    `mode:   ${mode}`,
    '',
    'next session: harness.* will load the pinned version.',
    'to replace this pin, run `brv harness use <other-ref>`.',
  ].join('\n')
}

export default class HarnessUse extends Command {
  static args = {
    versionRef: Args.string({
      description: 'Version to pin: raw id, "latest", "best", or "v<N>"',
      required: true,
    }),
  }
  static description = 'Pin a specific harness version (manual rollback path)'
  static examples = [
    '<%= config.bin %> <%= command.id %> v3',
    '<%= config.bin %> <%= command.id %> v-abc123 --commandType query',
    '<%= config.bin %> <%= command.id %> latest --format json',
  ]
  static flags = {
    commandType: Flags.string({
      default: 'curate',
      description: 'Harness pair command type',
      options: [...HARNESS_COMMAND_TYPES],
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(HarnessUse)
    if (!isHarnessCommandType(flags.commandType)) {
      this.error(`invalid --commandType value '${flags.commandType}'`, {exit: 1})
    }

    const {commandType} = flags
    const format = flags.format === 'json' ? 'json' : 'text'

    const projectRoot = resolveProject()?.projectRoot ?? process.cwd()
    const opened = await openHarnessStoreForProject(projectRoot)
    if (opened === undefined) {
      this.error(
        `no harness storage for this project (${projectRoot}) — run curate once to bootstrap.`,
        {exit: 1},
      )
    }

    try {
      // Capture the previous pin-or-latest as `previousVersionId` so
      // the caller sees the rollback transition explicitly.
      const [existingPin, latest] = await Promise.all([
        opened.store.getPin(opened.projectId, commandType),
        opened.store.getLatest(opened.projectId, commandType),
      ])
      const previousVersionId = existingPin?.pinnedVersionId ?? latest?.id ?? null

      const resolution = await resolveVersionRef(
        args.versionRef,
        opened.projectId,
        commandType,
        opened.store,
      )
      const report = await applyPin({
        commandType,
        pinnedVersion: resolution.version,
        previousVersionId,
        projectId: opened.projectId,
        store: opened.store,
      })

      if (format === 'json') {
        this.log(JSON.stringify(report, null, 2))
      } else {
        this.log(renderUseText(report))
      }
    } catch (error) {
      if (error instanceof VersionRefError) {
        this.error(error.message, {exit: 1})
      }

      throw error
    } finally {
      opened.close()
    }
  }
}
