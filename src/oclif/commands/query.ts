import type {ITransportClient, TaskAck} from '@campfirein/brv-transport-client'

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {type ProviderConfigResponse, TransportStateEventNames} from '../../server/core/domain/transport/schemas.js'
import {TaskEvents} from '../../shared/transport/events/index.js'
import {
  type DaemonClientOptions,
  formatConnectionError,
  hasLeakedHandles,
  type ProviderErrorContext,
  providerMissingMessage,
  withDaemonRetry,
} from '../lib/daemon-client.js'
import {
  attachFeedbackFromCli,
  FeedbackError,
  type FeedbackVerdict,
} from '../lib/harness-feedback.js'
import {writeJsonResponse} from '../lib/json-response.js'
import {DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, waitForTaskCompletion} from '../lib/task-client.js'

/** Parsed flags type */
type QueryFlags = {
  feedback?: FeedbackVerdict
  format?: 'json' | 'text'
  timeout?: number
}

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Natural language question about your codebase or project knowledge',
      required: true,
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
    feedback: Flags.string({
      description:
        'After the query completes, flag the most-recent outcome for AutoHarness learning. "bad" inserts 3 synthetic failures (weighted heavier); "good" inserts 1 synthetic success.',
      options: ['good', 'bad'],
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
    const {args, flags: rawFlags} = await this.parse(Query)
    const flags = rawFlags as QueryFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'
    // oclif's `options: ['good', 'bad']` validator rejects anything
    // else before we reach here — cast is type-narrowing only.
    const feedbackVerdict: FeedbackVerdict | undefined =
      rawFlags.feedback === 'good' || rawFlags.feedback === 'bad' ? rawFlags.feedback : undefined

    if (!this.validateInput(args.query, format)) return

    let providerContext: ProviderErrorContext | undefined
    // Captured from the daemon callback so feedback runs AFTER
    // withDaemonRetry resolves. Running it inside the callback would
    // let `this.error({exit: 1})` get caught by the outer try/catch
    // and routed to `reportError`, which swallows the exit code.
    let capturedProjectRoot: string | undefined
    let daemonSucceeded = false

    try {
      await withDaemonRetry(
        async (client, projectRoot, worktreeRoot) => {
          capturedProjectRoot = projectRoot

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

          await this.submitTask({
            client,
            format,
            projectRoot,
            query: args.query,
            timeoutMs: (flags.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
            worktreeRoot,
          })
          daemonSucceeded = true
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

    if (
      daemonSucceeded &&
      feedbackVerdict !== undefined &&
      capturedProjectRoot !== undefined
    ) {
      await this.handleFeedback(capturedProjectRoot, feedbackVerdict, format)
    }
  }

  /**
   * Attach the `--feedback` verdict to the most-recent query outcome.
   *
   * Surface contract (handoff §C1):
   *   - HARNESS_DISABLED → warn, exit 0 (primary query already succeeded)
   *   - NO_RECENT_OUTCOME / NO_STORAGE → `this.error` with exit 1
   */
  private async handleFeedback(
    projectRoot: string,
    verdict: FeedbackVerdict,
    format: 'json' | 'text',
  ): Promise<void> {
    try {
      const result = await attachFeedbackFromCli(projectRoot, 'query', verdict)
      if (format === 'json') {
        writeJsonResponse({
          command: 'query:feedback',
          data: {
            outcomeId: result.outcomeId,
            syntheticCount: result.syntheticCount,
            verdict: result.verdict,
          },
          success: true,
        })
      } else {
        this.log(
          `feedback attached: ${result.verdict} → outcome ${result.outcomeId} (${result.syntheticCount} synthetic row${result.syntheticCount === 1 ? '' : 's'} inserted for heuristic weighting)`,
        )
      }
    } catch (error) {
      if (error instanceof FeedbackError) {
        if (error.code === 'HARNESS_DISABLED') {
          if (format === 'json') {
            writeJsonResponse({
              command: 'query:feedback',
              data: {reason: error.message, skipped: true},
              success: true,
            })
          } else {
            this.warn(`--feedback ignored: ${error.message}`)
          }

          return
        }

        // NO_RECENT_OUTCOME / NO_STORAGE — user-input error per §C1.
        this.error(error.message, {exit: 1})
      }

      throw error
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
  }): Promise<void> {
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

    const completionPromise = waitForTaskCompletion(
      {
        client,
        command: 'query',
        format,
        onCompleted: ({result, taskId: tid}) => {
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
              data: {
                event: 'completed',
                result: finalResult,
                status: 'completed',
                taskId: tid,
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
