import type {TaskAck} from '@campfirein/brv-transport-client'

import {Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'

import {TaskEvents} from '../../../shared/transport/events/index.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'
import {DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, waitForTaskCompletion} from '../../lib/task-client.js'

export default class DreamFinalize extends Command {
  public static description =
    'Phase 3 of tool-mode dream — archive the loser topics the agent chose from the merge candidates.'
public static examples = [
    '# Archive specific topics, closing a session',
    '<%= config.bin %> <%= command.id %> --session drm-abc --archive testing/red_green_refactor,redis/cache_config',
    '',
    '# Read archive list from a file (one path per line)',
    '<%= config.bin %> <%= command.id %> --session drm-abc --archive-file losers.txt',
  ]
public static flags = {
    archive: Flags.string({description: 'Comma-separated topic paths to move to .brv/archive/'}),
    'archive-file': Flags.string({description: 'Read archive paths from a file (one per line).'}),
    format: Flags.string({default: 'text', description: 'Output format (text or json)', options: ['text', 'json']}),
    session: Flags.string({description: 'Session id from a prior scan', required: true}),
    timeout: Flags.integer({
      default: DEFAULT_TIMEOUT_SECONDS,
      description: 'Maximum seconds to wait for completion',
      max: MAX_TIMEOUT_SECONDS,
      min: MIN_TIMEOUT_SECONDS,
    }),
  }

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const {flags: raw} = await this.parse(DreamFinalize)
    const format = raw.format === 'json' ? 'json' : 'text'

    let archive: string[] = []
    if (raw.archive) {
      archive = raw.archive.split(',').map((s) => s.trim()).filter(Boolean)
    } else if (raw['archive-file']) {
      try {
        const fileContent = await readFile(raw['archive-file'], 'utf8')
        archive = fileContent.split('\n').map((s) => s.trim()).filter(Boolean)
      } catch (error) {
        const msg = `Failed to read --archive-file: ${error instanceof Error ? error.message : String(error)}`
        if (format === 'json') {
          writeJsonResponse({command: 'dream-finalize', data: {error: msg, status: 'error'}, success: false})
        } else {
          this.log(msg)
        }

        return
      }
    }

    try {
      await withDaemonRetry(
        async (client, projectRoot, worktreeRoot) => {
          const taskId = randomUUID()
          const taskPayload = {
            content: JSON.stringify({archive, sessionId: raw.session}),
            ...(projectRoot ? {projectPath: projectRoot} : {}),
            taskId,
            type: 'dream-finalize' as const,
            ...(worktreeRoot ? {worktreeRoot} : {}),
          }

          const completionPromise = waitForTaskCompletion(
            {
              client,
              command: 'dream-finalize',
              format,
              onCompleted: ({result}) => {
                if (format === 'json') {
                  this.log(result ?? '{}')
                } else {
                  renderFinalizeText(this, result)
                }
              },
              onError: ({error}) => {
                const msg = error?.message ?? 'dream-finalize failed'
                if (format === 'json') {
                  writeJsonResponse({command: 'dream-finalize', data: {error: msg, status: 'error'}, success: false})
                } else {
                  this.log(`dream-finalize failed: ${msg}`)
                }
              },
              taskId,
              timeoutMs: (raw.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
            },
            (msg) => this.log(msg),
          )

          await client.requestWithAck<TaskAck>(TaskEvents.CREATE, taskPayload)
          await completionPromise
        },
        this.getDaemonClientOptions(),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'dream-finalize failed'
      if (format === 'json') {
        writeJsonResponse({command: 'dream-finalize', data: {error: message, status: 'error'}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}

function renderFinalizeText(command: Command, raw: string | undefined): void {
  if (!raw) {
    command.log('(no result)')
    return
  }

  let parsed: {archived?: string[]; skipped?: Array<{path: string; reason: string}>}
  try {
    parsed = JSON.parse(raw)
  } catch {
    command.log(raw)
    return
  }

  command.log(`Archived: ${parsed.archived?.length ?? 0}`)
  for (const p of parsed.archived ?? []) command.log(`  ⌫  ${p}`)
  if ((parsed.skipped?.length ?? 0) > 0) {
    command.log(`Skipped: ${parsed.skipped?.length}`)
    for (const s of parsed.skipped ?? []) command.log(`  ⚠  ${s.path} (${s.reason})`)
  }
}
