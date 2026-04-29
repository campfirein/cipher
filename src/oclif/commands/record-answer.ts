import type {ITransportClient, TaskAck} from '@campfirein/brv-transport-client'

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import type {RecordAnswerResult} from '../../server/core/interfaces/executor/i-record-answer-executor.js'

import {TaskEvents} from '../../shared/transport/events/index.js'
import {encodeRecordAnswerContent} from '../../shared/transport/record-answer-content.js'
import {
  type DaemonClientOptions,
  formatConnectionError,
  hasLeakedHandles,
  withDaemonRetry,
} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'
import {waitForTaskCompletion} from '../lib/task-client.js'

/* eslint-disable perfectionist/sort-objects -- positional CLI args MUST preserve declaration order; oclif uses property iteration order to map argv positions to arg names */
export default class RecordAnswer extends Command {
  public static args = {
    query: Args.string({
      description: 'The query that the answer responds to (must match the prior brv search/gather query)',
      required: true,
    }),
    answer: Args.string({
      description: 'The agent-synthesized answer to cache',
      required: true,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  public static description = `Cache an agent-synthesized answer for future tier-0/1 hits

Closes the cache loop for the LLM-free pipeline:
  brv search → brv gather → (your LLM synthesizes) → brv record-answer

After recording, future equivalent queries to "brv search" (or "brv query")
will hit tier 0 (exact) or tier 1 (fuzzy) cache and skip the synthesis cost.

Optional — skipping it means future queries will need to re-synthesize, but
correctness is preserved (cache is purely a perf optimization). Cache TTL
defaults to 60 seconds.`
  public static examples = [
    '# Record an answer after running brv gather + your own LLM',
    '<%= config.bin %> <%= command.id %> "how does auth work" "Auth uses JWTs..." --fingerprint <fp>',
    '',
    '# Pipelining: gather → llm → record',
    'brv gather "auth" --format json | jq -r .prefetched_context | external-llm > /tmp/ans',
    '<%= config.bin %> <%= command.id %> "auth" "$(cat /tmp/ans)" --fingerprint <fp>',
    '',
    '# JSON output (CI/automation)',
    '<%= config.bin %> <%= command.id %> "q" "a" --fingerprint fp --format json',
  ]
  public static flags = {
    fingerprint: Flags.string({
      description: 'Cache key fingerprint from a prior brv search/gather call (required)',
      required: true,
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }
  // Allow unknown flags for forward-compatibility (e.g., new daemon flags
  // passed through by wrapper scripts without requiring a CLI upgrade).
  public static strict = false

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(RecordAnswer)
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    if (!this.validateInput(args.query, args.answer, flags.fingerprint, format)) return

    try {
      await withDaemonRetry(
        async (client, projectRoot, worktreeRoot) => {
          await this.submitTask({
            answer: args.answer,
            client,
            fingerprint: flags.fingerprint,
            format,
            projectRoot,
            query: args.query,
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

  private formatTextOutput(recordResult: RecordAnswerResult): string[] {
    if (recordResult.recorded) {
      return ['', `Answer recorded for fingerprint ${recordResult.fingerprint}.`, '']
    }

    return [
      '',
      `Answer NOT recorded (fingerprint ${recordResult.fingerprint}).`,
      'Daemon may not have caching enabled, or the cache.set call failed.',
      '',
    ]
  }

  private reportError(error: unknown, format: 'json' | 'text'): void {
    const errorMessage = error instanceof Error ? error.message : 'Record-answer failed'

    if (format === 'json') {
      writeJsonResponse({command: 'record-answer', data: {error: errorMessage, status: 'error'}, success: false})
    } else {
      this.log(formatConnectionError(error))
    }

    if (hasLeakedHandles(error)) {
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
    }
  }

  private async submitTask(props: {
    answer: string
    client: ITransportClient
    fingerprint: string
    format: 'json' | 'text'
    projectRoot?: string
    query: string
    worktreeRoot?: string
  }): Promise<void> {
    const {answer, client, fingerprint, format, projectRoot, query, worktreeRoot} = props
    const taskId = randomUUID()

    const contentPayload = encodeRecordAnswerContent({answer, fingerprint, query})

    const taskPayload = {
      clientCwd: process.cwd(),
      content: contentPayload,
      ...(projectRoot ? {projectPath: projectRoot} : {}),
      taskId,
      type: 'record-answer' as const,
      ...(worktreeRoot ? {worktreeRoot} : {}),
    }

    const completionPromise = waitForTaskCompletion(
      {
        client,
        command: 'record-answer',
        format,
        onCompleted: ({result}) => {
          if (!result) {
            if (format === 'json') {
              writeJsonResponse({
                command: 'record-answer',
                data: {fingerprint, recorded: false, status: 'completed'},
                success: true,
              })
            } else {
              this.log('\nNo response from daemon.\n')
            }

            return
          }

          try {
            const recordResult = JSON.parse(result) as RecordAnswerResult

            if (format === 'json') {
              writeJsonResponse({
                command: 'record-answer',
                data: {...recordResult, status: 'completed'},
                success: true,
              })
            } else {
              for (const line of this.formatTextOutput(recordResult)) {
                this.log(line)
              }
            }
          } catch {
            if (format === 'json') {
              writeJsonResponse({
                command: 'record-answer',
                data: {error: 'Invalid record-answer result format', raw: result, status: 'error'},
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
              command: 'record-answer',
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

  private validateInput(query: string, answer: string, fingerprint: string, format: 'json' | 'text'): boolean {
    if (query.trim() && answer.trim() && fingerprint.trim()) return true

    const message = 'query, answer, and --fingerprint are all required and cannot be empty.'
    if (format === 'json') {
      writeJsonResponse({command: 'record-answer', data: {message, status: 'error'}, success: false})
    } else {
      this.log(message)
      this.log('Usage: brv record-answer "<query>" "<answer>" --fingerprint <fp>')
    }

    // PHASE-5-UAT.md UAT-14: empty input must exit non-zero so CI scripts
    // can detect failure.
    process.exitCode = 1
    return false
  }
}
