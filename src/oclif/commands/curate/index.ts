import type {ITransportClient, TaskAck} from '@campfirein/brv-transport-client'

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import type {CurateLogOperation} from '../../../server/core/domain/entities/curate-log-entry.js'

import {extractCurateOperations} from '../../../server/utils/curate-result-parser.js'
import {TaskEvents} from '../../../shared/transport/events/index.js'
import {ProviderEvents, type ProviderGetActiveResponse} from '../../../shared/transport/events/provider-events.js'
import {
  type DaemonClientOptions,
  formatConnectionError,
  hasLeakedHandles,
  withDaemonRetry,
} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'
import {type ToolCallRecord, waitForTaskCompletion} from '../../lib/task-client.js'

/** Parsed flags type */
type CurateFlags = {
  detach?: boolean
  files?: string[]
  folder?: string[]
  format?: 'json' | 'text'
}

export default class Curate extends Command {
  public static args = {
    context: Args.string({
      description: 'Knowledge context: patterns, decisions, errors, or insights',
      required: false,
    }),
  }
  public static description = `Curate context to the context tree (connects to running brv instance)

Requires a running brv instance. Start one with: brv

Good examples:
- "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"
- "API rate limit is 100 req/min per user. Implemented using Redis with sliding window in rateLimiter.ts"
Bad examples:
- "Authentication" or "JWT tokens" (too vague, lacks context)
- "Rate limiting" (no implementation details or file references)`
  public static examples = [
    '# Curate context - queues task for background processing',
    '<%= config.bin %> <%= command.id %> "Auth uses JWT with 24h expiry. Tokens stored in httpOnly cookies via authMiddleware.ts"',
    '',
    '# Include relevant files for comprehensive context (max 5 files)',
    '<%= config.bin %> <%= command.id %> "Authentication middleware validates JWT tokens" -f src/middleware/auth.ts',
    '',
    '# Multiple files',
    '<%= config.bin %> <%= command.id %> "JWT authentication implementation" --files src/auth/jwt.ts --files docs/auth.md',
    '',
    '# Folder pack - analyze and curate entire folder',
    '<%= config.bin %> <%= command.id %> --folder src/auth/',
    '',
    '# Folder pack with context',
    '<%= config.bin %> <%= command.id %> "Analyze authentication module" -d src/auth/',
    '',
    '# View curate history',
    '<%= config.bin %> curate view',
    '<%= config.bin %> curate view --status completed --since 1h',
  ]
  public static flags = {
    detach: Flags.boolean({
      default: false,
      description: 'Queue task and exit without waiting for completion',
    }),
    files: Flags.string({
      char: 'f',
      description: 'Include specific file paths for critical context (max 5 files)',
      multiple: true,
    }),
    folder: Flags.string({
      char: 'd',
      description: 'Folder path to pack and analyze (triggers folder pack flow)',
      multiple: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const {args, flags: rawFlags} = await this.parse(Curate)
    const flags: CurateFlags = {
      detach: rawFlags.detach,
      files: rawFlags.files,
      folder: rawFlags.folder,
      format: rawFlags.format === 'json' ? 'json' : rawFlags.format === 'text' ? 'text' : undefined,
    }
    const format: 'json' | 'text' = flags.format ?? 'text'

    if (!this.validateInput(args, flags, format)) return

    const resolvedContent = args.context?.trim()
      ? args.context
      : flags.folder?.length
        ? 'Analyze this folder and extract all relevant knowledge, patterns, and documentation.'
        : ''
    const taskType = flags.folder?.length ? 'curate-folder' : 'curate'

    try {
      await withDaemonRetry(
        async (client, projectRoot) => {
          const active = await client.requestWithAck<ProviderGetActiveResponse>(ProviderEvents.GET_ACTIVE)
          if (!active.activeProviderId) {
            throw new Error(
              'No provider connected. Run "brv provider connect <provider>" to configure a provider first.',
            )
          }

          await this.submitTask({client, content: resolvedContent, flags, format, projectRoot, taskType})
        },
        {
          ...this.getDaemonClientOptions(),
          onRetry:
            format === 'text'
              ? (attempt, maxRetries) =>
                  this.log(`\nConnection lost. Restarting daemon... (attempt ${attempt}/${maxRetries})`)
              : undefined,
        },
      )
    } catch (error) {
      this.reportError(error, format)
    }
  }

  /**
   * Extract file changes from collected tool calls (same logic as TUI useActivityLogs).
   */
  private composeChangesFromToolCalls(toolCalls: ToolCallRecord[]): {created: string[]; updated: string[]} {
    const changes: {created: string[]; updated: string[]} = {created: [], updated: []}

    for (const tc of toolCalls) {
      if (tc.status !== 'completed') continue
      const ops = extractCurateOperations({result: tc.result, toolName: tc.toolName})
      this.extractChangesFromApplied(ops, changes)
    }

    return changes
  }

  private extractChangesFromApplied(
    applied: CurateLogOperation[],
    changes: {created: string[]; updated: string[]},
  ): void {
    for (const op of applied) {
      if (op.status !== 'success' || !op.filePath) continue

      switch (op.type) {
        case 'ADD': {
          changes.created.push(op.filePath)
          break
        }

        case 'UPDATE':
        case 'UPSERT': {
          changes.updated.push(op.filePath)
          break
        }

        default: {
          break
        }
      }
    }
  }

  private reportError(error: unknown, format: 'json' | 'text'): void {
    const errorMessage = error instanceof Error ? error.message : 'Curate failed'

    if (format === 'json') {
      writeJsonResponse({command: 'curate', data: {error: errorMessage, status: 'error'}, success: false})
    } else {
      this.log(formatConnectionError(error))
    }

    if (hasLeakedHandles(error)) {
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
    }
  }

  private async submitTask(props: {
    client: ITransportClient
    content: string
    flags: CurateFlags
    format: 'json' | 'text'
    projectRoot?: string
    taskType: string
  }): Promise<void> {
    const {client, content, flags, format, projectRoot, taskType} = props
    const hasFolders = Boolean(flags.folder?.length)
    const taskId = randomUUID()
    const taskPayload = {
      clientCwd: process.cwd(),
      content,
      ...(flags.files?.length ? {files: flags.files} : {}),
      ...(hasFolders && flags.folder ? {folderPath: flags.folder[0]} : {}),
      ...(projectRoot ? {projectPath: projectRoot} : {}),
      taskId,
      type: taskType,
    }

    if (flags.detach) {
      const ack = await client.requestWithAck<TaskAck>(TaskEvents.CREATE, taskPayload)
      const {logId} = ack

      if (format === 'json') {
        writeJsonResponse({
          command: 'curate',
          data: {logId, message: 'Context queued for processing', status: 'queued', taskId},
          success: true,
        })
      } else {
        const logSuffix = logId ? ` (Log: ${logId})` : ''
        this.log(`✓ Context queued for processing.${logSuffix}`)
      }
    } else {
      const completionPromise = waitForTaskCompletion(
        {
          client,
          command: 'curate',
          format,
          onCompleted: ({logId, taskId: tid, toolCalls}) => {
            const changes = this.composeChangesFromToolCalls(toolCalls)

            if (format === 'text') {
              for (const file of changes.created) {
                this.log(`  add ${file}`)
              }

              for (const file of changes.updated) {
                this.log(`  update ${file}`)
              }

              const logSuffix = logId ? ` (Log: ${logId})` : ''
              this.log(`✓ Context curated successfully.${logSuffix}`)
            } else {
              writeJsonResponse({
                command: 'curate',
                data: {
                  changes: changes.created.length > 0 || changes.updated.length > 0 ? changes : undefined,
                  event: 'completed',
                  logId,
                  message: 'Context curated successfully',
                  status: 'completed',
                  taskId: tid,
                },
                success: true,
              })
            }
          },
          onError({error, logId}) {
            if (format === 'json') {
              writeJsonResponse({
                command: 'curate',
                data: {event: 'error', logId, message: error.message, status: 'error'},
                success: false,
              })
            }
          },
          taskId,
        },
        (msg) => this.log(msg),
      )
      await client.requestWithAck<TaskAck>(TaskEvents.CREATE, taskPayload)
      await completionPromise
    }
  }

  private validateInput(args: {context?: string}, flags: CurateFlags, format: 'json' | 'text'): boolean {
    const hasContext = Boolean(args.context?.trim())
    const hasFiles = Boolean(flags.files?.length)
    const hasFolders = Boolean(flags.folder?.length)

    if (hasContext || hasFiles || hasFolders) return true

    if (format === 'json') {
      writeJsonResponse({
        command: 'curate',
        data: {
          message: 'Either a context argument, file reference, or folder reference is required.',
          status: 'error',
        },
        success: false,
      })
    } else {
      this.log('Either a context argument, file reference, or folder reference is required.')
      this.log('Usage:')
      this.log('  brv curate "your context here"')
      this.log('  brv curate @src/file.ts')
      this.log('  brv curate @src/             # folder pack')
      this.log('  brv curate "context with files" @src/file.ts')
    }

    return false
  }
}
