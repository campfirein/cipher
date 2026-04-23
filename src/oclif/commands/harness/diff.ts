/**
 * `brv harness diff <from> <to>` — AutoHarness V2 Phase 7 Task 7.2.
 *
 * Produces a unified diff between two harness versions' code bodies.
 * Closes brutal-review item Tier 2 D3.
 *
 * Exits `1` on unresolvable refs per handoff §C1. JSON shape is
 * pinned to §C2's `diff` entry.
 */

import {Args, Command, Flags} from '@oclif/core'

import type {HarnessVersion} from '../../../agent/core/domain/harness/types.js'

import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {
  HARNESS_COMMAND_TYPES,
  isHarnessCommandType,
  openHarnessStoreForProject,
} from '../../lib/harness-cli.js'
import {resolveVersionRef, VersionRefError} from '../../lib/resolve-version-ref.js'
import {unifiedDiff} from '../../lib/unified-diff.js'

export interface DiffReport {
  readonly fromVersionId: string
  readonly lineAdds: number
  readonly lineDeletes: number
  readonly toVersionId: string
  readonly unifiedDiff: string
}

export function buildDiffReport(from: HarnessVersion, to: HarnessVersion): DiffReport {
  const diff = unifiedDiff(from.code, to.code, from.id, to.id)
  return {
    fromVersionId: from.id,
    lineAdds: diff.lineAdds,
    lineDeletes: diff.lineDeletes,
    toVersionId: to.id,
    unifiedDiff: diff.unifiedDiff,
  }
}

export function renderDiffText(report: DiffReport): string {
  if (report.unifiedDiff === '') {
    return `${report.fromVersionId} == ${report.toVersionId} (identical code)`
  }

  return `${report.unifiedDiff}\n\n+${report.lineAdds} additions, -${report.lineDeletes} deletions`
}

export default class HarnessDiff extends Command {
  static args = {
    from: Args.string({
      description: 'From-version ref: raw id, "latest", "best", or "v<N>"',
      required: true,
    }),
    to: Args.string({
      description: 'To-version ref: raw id, "latest", "best", or "v<N>"',
      required: true,
    }),
  }
  static description = 'Show a unified diff between two harness versions'
  static examples = [
    '<%= config.bin %> <%= command.id %> v1 v2',
    '<%= config.bin %> <%= command.id %> v-abc v-def --format json',
    '<%= config.bin %> <%= command.id %> v2 latest',
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
    const {args, flags} = await this.parse(HarnessDiff)
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
      const [fromRes, toRes] = await Promise.all([
        resolveVersionRef(args.from, opened.projectId, commandType, opened.store),
        resolveVersionRef(args.to, opened.projectId, commandType, opened.store),
      ])
      const report = buildDiffReport(fromRes.version, toRes.version)

      if (format === 'json') {
        this.log(JSON.stringify(report, null, 2))
      } else {
        this.log(renderDiffText(report))
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
