import type {ITransportClient, TaskAck} from '@campfirein/brv-transport-client'

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {type ProviderConfigResponse, TransportStateEventNames} from '../../server/core/domain/transport/schemas.js'
import {TaskEvents} from '../../shared/transport/events/index.js'
import {runCancelBranchWithRetry} from '../lib/cancel-task.js'
import {
  type DaemonClientOptions,
  formatConnectionError,
  hasLeakedHandles,
  type ProviderErrorContext,
  providerMissingMessage,
  withDaemonRetry,
} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'
import {DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, waitForTaskCompletion} from '../lib/task-client.js'

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Natural language question about your codebase or project knowledge (omit when using --cancel)',
      required: false,
    }),
  }
  public static description = `Query and retrieve information from the context tree

Good:
- "How is user authentication implemented?"
- "What are the API rate limits and where are they enforced?"
Bad:
- "auth" or "authentication" (too vague, not a question)
- "show me code" (not specific about what information is needed)`
  public static examples = [
    '# Ask questions about patterns, decisions, or implementation details',
    '<%= config.bin %> <%= command.id %> What are the coding standards?',
    '<%= config.bin %> <%= command.id %> How is authentication implemented?',
    '',
    '# JSON output (for automation)',
    '<%= config.bin %> <%= command.id %> "How does auth work?" --format json',
  ]
  public static flags = {
    cancel: Flags.string({
      description: 'Cancel a running task by id. Short-circuits the query flow — no new task is created.',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    timeout: Flags.integer({
      default: DEFAULT_TIMEOUT_SECONDS,
      description: 'Maximum seconds to wait for task completion',
      max: MAX_TIMEOUT_SECONDS,
      min: MIN_TIMEOUT_SECONDS,
    }),
  }
  public static strict = false

  protected getDaemonClientOptions(): DaemonClientOptions {
    return {}
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Query)
    const format: 'json' | 'text' = flags.format === 'json' ? 'json' : 'text'

    if (flags.cancel) {
      if (args.query !== undefined && args.query.trim() !== '') {
        this.reportCombinationError(format)
        this.exit(1)
        return
      }

      const ok = await runCancelBranchWithRetry({
        command: 'query',
        daemonClientOptions: this.getDaemonClientOptions(),
        format,
        log: (msg) => this.log(msg),
        onTransportError: (error) => this.reportError(error, format),
        taskId: flags.cancel,
      })
      if (!ok) this.exit(1)
      return
    }

    if (!this.validateInput(args.query ?? '', format)) return

    let providerContext: ProviderErrorContext | undefined
    let wasCancelled = false

    try {
      await withDaemonRetry(
        async (client, projectRoot, worktreeRoot) => {
          const active = await client.requestWithAck<ProviderConfigResponse>(
            TransportStateEventNames.GET_PROVIDER_CONFIG,
          )
          providerContext = {activeModel: active.activeModel, activeProvider: active.activeProvider}

          if (!active.activeProvider) {
            throw new Error(
              'No provider connected. Run "brv providers connect byterover" to use the free built-in provider, or connect another provider.',
            )
          }

          if (active.providerKeyMissing) {
            throw new Error(providerMissingMessage(active.activeProvider, active.authMethod))
          }

          const result = await this.submitTask({
            client,
            format,
            projectRoot,
            query: args.query ?? '',
            timeoutMs: (flags.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
            worktreeRoot,
          })
          if (result.wasCancelled) wasCancelled = true
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
      this.reportError(error, format, providerContext)
      return
    }

    // Throw the SIGINT-conventional exit AFTER the daemon-retry try/catch so
    // the ExitError isn't swallowed by reportError. Routine completions and
    // errors fall through here naturally.
    if (wasCancelled) this.exit(130)
  }

  private reportCombinationError(format: 'json' | 'text'): void {
    const message = 'Provide either a query string or --cancel <id>, not both.'
    if (format === 'json') {
      writeJsonResponse({
        command: 'query',
        data: {message, status: 'error'},
        success: false,
      })
    } else {
      this.log(message)
    }
  }

  private reportError(error: unknown, format: 'json' | 'text', providerContext?: ProviderErrorContext): void {
    const errorMessage = error instanceof Error ? error.message : 'Query failed'

    if (format === 'json') {
      writeJsonResponse({command: 'query', data: {error: errorMessage, status: 'error'}, success: false})
    } else {
      this.log(formatConnectionError(error, providerContext))
    }

    if (hasLeakedHandles(error)) {
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
    }
  }

  private async submitTask(props: {
    client: ITransportClient
    format: 'json' | 'text'
    projectRoot?: string
    query: string
    timeoutMs?: number
    worktreeRoot?: string
  }): Promise<{wasCancelled: boolean}> {
    const {client, format, projectRoot, query, timeoutMs, worktreeRoot} = props
    const taskId = randomUUID()
    const taskPayload = {
      clientCwd: process.cwd(),
      content: query,
      ...(projectRoot ? {projectPath: projectRoot} : {}),
      taskId,
      type: 'query',
      ...(worktreeRoot ? {worktreeRoot} : {}),
    }

    let finalResult: string | undefined
    let wasCancelled = false

    const completionPromise = waitForTaskCompletion(
      {
        client,
        command: 'query',
        format,
        onCancelled: ({taskId: tid}) => {
          wasCancelled = true
          if (format === 'json') {
            // success: false because the JSON top-level field tracks the exit
            // code (130 on cancel). Cancellation semantics live in data.status.
            writeJsonResponse({
              command: 'query',
              data: {event: 'cancelled', message: 'Query cancelled', status: 'cancelled', taskId: tid},
              success: false,
            })
          } else {
            this.log(`✗ Query cancelled (Task: ${tid})`)
          }
        },
        onCompleted: ({durationMs, matchedDocs, result, taskId: tid, tier, topScore}) => {
          const previousResult = finalResult

          // Always prefer the completed payload — it carries the attribution footer
          // that may not be present in the earlier llmservice:response event.
          if (result) {
            finalResult = result
          }

          if (format === 'text') {
            if (!previousResult && finalResult) {
              // No onResponse was received (e.g., Tier 2 direct search)
              this.log(`\n${finalResult}`)
            } else if (previousResult && result && result !== previousResult) {
              // Completed payload has additional content (attribution footer)
              const suffix = result.startsWith(previousResult) ? result.slice(previousResult.length) : `\n${result}`
              if (suffix.trim()) {
                this.log(suffix)
              }
            }
          }

          if (format === 'json') {
            writeJsonResponse({
              command: 'query',
              // Recall metadata is only present on query tasks; older daemons omit it. Spread
              // conditionally so JSON consumers do not see undefined keys.
              data: {
                ...(durationMs === undefined ? {} : {durationMs}),
                event: 'completed',
                ...(matchedDocs === undefined ? {} : {matchedDocs}),
                result: finalResult,
                status: 'completed',
                taskId: tid,
                ...(tier === undefined ? {} : {tier}),
                ...(topScore === undefined ? {} : {topScore}),
              },
              success: true,
            })
          } else if (finalResult) {
            this.log('')
          }
        },
        onError({error}) {
          if (format === 'json') {
            writeJsonResponse({
              command: 'query',
              data: {event: 'error', message: error.message, status: 'error'},
              success: false,
            })
          }
        },
        onResponse: (content) => {
          finalResult = content
          if (format === 'text') {
            this.log(`\n${content}`)
          } else {
            writeJsonResponse({
              command: 'query',
              data: {content, event: 'response', taskId},
              success: true,
            })
          }
        },
        taskId,
        timeoutMs,
      },
      (msg) => this.log(msg),
    )
    await client.requestWithAck<TaskAck>(TaskEvents.CREATE, taskPayload)
    await completionPromise
    return {wasCancelled}
  }

  private validateInput(query: string, format: 'json' | 'text'): boolean {
    if (query.trim()) return true

    if (format === 'json') {
      writeJsonResponse({
        command: 'query',
        data: {message: 'Query argument is required.', status: 'error'},
        success: false,
      })
    } else {
      this.log('Query argument is required.')
      this.log('Usage: brv query "your question here"')
    }

    return false
  }
}
