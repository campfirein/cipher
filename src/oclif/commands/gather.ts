/* eslint-disable camelcase -- DESIGN §6.2 specifies snake_case for the gather payload */
import type {ITransportClient, TaskAck} from '@campfirein/brv-transport-client'

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import type {GatherResult} from '../../server/core/interfaces/executor/i-gather-executor.js'

import {TaskEvents} from '../../shared/transport/events/index.js'
import {encodeGatherContent} from '../../shared/transport/gather-content.js'
import {
  type DaemonClientOptions,
  formatConnectionError,
  hasLeakedHandles,
  withDaemonRetry,
} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'
import {waitForTaskCompletion} from '../lib/task-client.js'

export default class Gather extends Command {
  public static args = {
    query: Args.string({
      description: 'Question to gather context for (no LLM synthesis — bundle is returned for inspection)',
      required: true,
    }),
  }
  public static description = `Assemble an LLM-free context bundle from the context tree

Returns the prefetched markdown bundle, search metadata, token estimate, and
follow-up hints — the same payload that the brv_gather MCP tool returns to
external agents. Useful for:
  • Debugging "what context would the agent see for this query?"
  • Pipelining: brv gather "..." --format json | external-llm
  • Inspecting bundle size before paying tokens for synthesis

Use "brv search" for ranked BM25 results without bundle assembly.
Use "brv query" when you want the synthesized answer.`
  public static examples = [
    '# Gather context for an agent-style question',
    '<%= config.bin %> <%= command.id %> "how does authentication work"',
    '',
    '# Restrict scope and cap result count',
    '<%= config.bin %> <%= command.id %> "JWT tokens" --scope auth/ --limit 5',
    '',
    '# Cap token budget for large knowledge bases',
    '<%= config.bin %> <%= command.id %> "auth" --token-budget 8000',
    '',
    '# JSON output (pipeline-friendly)',
    '<%= config.bin %> <%= command.id %> "auth" --format json | jq .total_tokens_estimated',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    limit: Flags.integer({
      default: 10,
      description: 'Maximum number of BM25 results to include (1-50)',
      max: 50,
      min: 1,
    }),
    scope: Flags.string({
      description: 'Path prefix to scope results (e.g. "auth/" for auth domain only)',
    }),
    'token-budget': Flags.integer({
      description: 'Soft cap on bundle tokens (default 4000). Truncates excess sections.',
      max: 64_000,
      min: 100,
    }),
  }
  // Allow unknown flags for forward-compatibility (e.g., new daemon flags
  // passed through by wrapper scripts without requiring a CLI upgrade).
  public static strict = false

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Gather)
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    if (!this.validateInput(args.query, format)) return

    try {
      await withDaemonRetry(
        async (client, projectRoot, worktreeRoot) => {
          await this.submitTask({
            client,
            format,
            limit: flags.limit,
            projectRoot,
            query: args.query,
            scope: flags.scope,
            tokenBudget: flags['token-budget'],
            worktreeRoot,
          })
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

  private formatTextOutput(gatherResult: GatherResult): string[] {
    const lines: string[] = []
    const meta = gatherResult.search_metadata

    lines.push(
      '',
      `Search metadata: ${meta.result_count} result(s), top score ${meta.top_score.toFixed(2)}, total found ${meta.total_found}`,
      `Bundle tokens (estimated): ${gatherResult.total_tokens_estimated}`,
    )

    if (gatherResult.prefetched_context) {
      lines.push('', '=== Prefetched context ===', '', gatherResult.prefetched_context)
    } else {
      lines.push('', '(No high-confidence passages above the score threshold.)')
    }

    if (gatherResult.manifest_context) {
      lines.push('', '=== Manifest context ===', '', gatherResult.manifest_context)
    }

    if (gatherResult.follow_up_hints && gatherResult.follow_up_hints.length > 0) {
      lines.push('', 'Follow-up hints:')
      for (const hint of gatherResult.follow_up_hints) {
        lines.push(`  - ${hint}`)
      }
    }

    lines.push('')
    return lines
  }

  private reportError(error: unknown, format: 'json' | 'text'): void {
    const errorMessage = error instanceof Error ? error.message : 'Gather failed'

    if (format === 'json') {
      writeJsonResponse({command: 'gather', data: {error: errorMessage, status: 'error'}, success: false})
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
    format: 'json' | 'text'
    limit?: number
    projectRoot?: string
    query: string
    scope?: string
    tokenBudget?: number
    worktreeRoot?: string
  }): Promise<void> {
    const {client, format, projectRoot, query, worktreeRoot} = props
    const taskId = randomUUID()

    const contentPayload = encodeGatherContent({
      ...(props.limit === undefined ? {} : {limit: props.limit}),
      query,
      ...(props.scope === undefined ? {} : {scope: props.scope}),
      ...(props.tokenBudget === undefined ? {} : {tokenBudget: props.tokenBudget}),
    })

    const taskPayload = {
      clientCwd: process.cwd(),
      content: contentPayload,
      ...(projectRoot ? {projectPath: projectRoot} : {}),
      taskId,
      type: 'gather' as const,
      ...(worktreeRoot ? {worktreeRoot} : {}),
    }

    const completionPromise = waitForTaskCompletion(
      {
        client,
        command: 'gather',
        format,
        onCompleted: ({result}) => {
          if (!result) {
            if (format === 'json') {
              writeJsonResponse({
                command: 'gather',
                data: {prefetched_context: '', status: 'completed'},
                success: true,
              })
            } else {
              this.log('\nNo results.\n')
            }

            return
          }

          try {
            const gatherResult = JSON.parse(result) as GatherResult

            if (format === 'json') {
              writeJsonResponse({
                command: 'gather',
                data: {...gatherResult, status: 'completed'},
                success: true,
              })
            } else {
              for (const line of this.formatTextOutput(gatherResult)) {
                this.log(line)
              }
            }
          } catch {
            if (format === 'json') {
              writeJsonResponse({
                command: 'gather',
                data: {error: 'Invalid gather result format', raw: result, status: 'error'},
                success: false,
              })
            } else {
              this.log(`\n${result}\n`)
            }
          }
        },
        onError: ({error}) => {
          if (format === 'json') {
            writeJsonResponse({
              command: 'gather',
              data: {event: 'error', message: error.message, status: 'error'},
              success: false,
            })
          } else {
            this.log(`\nError: ${error.message}\n`)
          }
        },
        taskId,
      },
      (msg) => this.log(msg),
    )

    await client.requestWithAck<TaskAck>(TaskEvents.CREATE, taskPayload)
    await completionPromise
  }

  private validateInput(query: string, format: 'json' | 'text'): boolean {
    if (query.trim()) return true

    if (format === 'json') {
      writeJsonResponse({
        command: 'gather',
        data: {message: 'Gather query is required.', status: 'error'},
        success: false,
      })
    } else {
      this.log('Gather query is required.')
      this.log('Usage: brv gather "your question here"')
    }

    // PHASE-5-UAT.md UAT-14: empty input must exit non-zero so CI scripts
    // can detect failure (`brv gather "" || echo failed`).
    process.exitCode = 1
    return false
  }
}
