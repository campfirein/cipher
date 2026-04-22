/**
 * `brv harness inspect <version-ref>` — AutoHarness V2 Phase 7 Task 7.1.
 *
 * Dumps a stored version's full record. Accepts the §C3 version-ref
 * grammar (`latest` | `best` | `v<N>` | raw id).
 *
 * Exits `1` on unresolvable refs (user input error, per handoff §C1).
 */

import {Args, Command, Flags} from '@oclif/core'

import type {HarnessVersion} from '../../../agent/core/domain/harness/types.js'

import {resolveProject} from '../../../server/infra/project/resolve-project.js'
import {openHarnessStoreForProject} from '../../lib/harness-cli.js'
import {resolveVersionRef, VersionRefError} from '../../lib/resolve-version-ref.js'

const COMMAND_TYPES = ['chat', 'curate', 'query'] as const
type HarnessCommandType = (typeof COMMAND_TYPES)[number]

export interface InspectReport {
  readonly code: string
  readonly commandType: string
  readonly createdAt: number
  readonly heuristic: number
  readonly id: string
  readonly metadata: HarnessVersion['metadata']
  readonly parentId: null | string
  readonly projectId: string
  readonly projectType: HarnessVersion['projectType']
  readonly version: number
}

export function toInspectReport(v: HarnessVersion): InspectReport {
  return {
    code: v.code,
    commandType: v.commandType,
    createdAt: v.createdAt,
    heuristic: v.heuristic,
    id: v.id,
    metadata: v.metadata,
    parentId: v.parentId ?? null,
    projectId: v.projectId,
    projectType: v.projectType,
    version: v.version,
  }
}

export function renderInspectText(report: InspectReport): string {
  const lines: string[] = [
    `id:        ${report.id}`,
    `version:   #${report.version}`,
    `pair:      (${report.projectId}, ${report.commandType})`,
    `project:   ${report.projectType}`,
    `H:         ${report.heuristic.toFixed(4)}`,
    `created:   ${new Date(report.createdAt).toISOString()}`,
    `parent:    ${report.parentId ?? '<none — bootstrap>'}`,
    `metadata:  ${JSON.stringify(report.metadata)}`,
    '',
    '── code ──────────────────────────────────────────────',
    report.code,
  ]
  return lines.join('\n')
}

export default class HarnessInspect extends Command {
  static args = {
    versionRef: Args.string({
      description: 'Version to inspect: raw id, "latest", "best", or "v<N>"',
      required: true,
    }),
  }
  static description = 'Inspect a stored harness version in full'
  static examples = [
    '<%= config.bin %> <%= command.id %> latest',
    '<%= config.bin %> <%= command.id %> best',
    '<%= config.bin %> <%= command.id %> v3',
    '<%= config.bin %> <%= command.id %> v-abc123 --format json',
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
    const {args, flags} = await this.parse(HarnessInspect)
    const commandType = flags.commandType as HarnessCommandType
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
      const resolution = await resolveVersionRef(
        args.versionRef,
        opened.projectId,
        commandType,
        opened.store,
      )
      const report = toInspectReport(resolution.version)

      if (format === 'json') {
        this.log(JSON.stringify(report, null, 2))
      } else {
        this.log(renderInspectText(report))
      }
    } catch (error) {
      if (error instanceof VersionRefError) {
        // Input error per §C1 → exit 1 with a clear message naming the ref.
        this.error(error.message, {exit: 1})
      }

      throw error
    } finally {
      opened.close()
    }
  }
}
