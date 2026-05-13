import type {ITransportClient, TaskAck} from '@campfirein/brv-transport-client'

import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import {type ProviderConfigResponse, TransportStateEventNames} from '../../server/core/domain/transport/schemas.js'
import {formatDirectResponse} from '../../server/infra/executor/direct-search-responder.js'
import {TaskEvents} from '../../shared/transport/events/index.js'
import {
  type DaemonClientOptions,
  formatConnectionError,
  hasLeakedHandles,
  type ProviderErrorContext,
  providerMissingMessage,
  withDaemonRetry,
} from '../lib/daemon-client.js'
import {writeJsonResponse} from '../lib/json-response.js'
import {type QueryToolModeEnvelope, runRetrieval} from '../lib/query-retrieval.js'
import {DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, waitForTaskCompletion} from '../lib/task-client.js'

/** Parsed flags type */
type QueryFlags = {
  format?: 'json' | 'text'
  limit?: number
  timeout?: number
}

/**
 * Env-var opt-in for tool-mode query. Mirrors curate's
 * `BRV_CURATE_TOOL_MODE`. Tool mode short-circuits today's
 * Tier-0/1/2/3/4 path and returns matches + a synthesis prompt for
 * the calling agent to compose an answer from. M3 (future) replaces
 * the env var with a BrvConfig field.
 */
const TOOL_MODE_ENV_VAR = 'BRV_QUERY_TOOL_MODE'

/** Default match cap. Locked to 10 (matches `brv search`). */
const DEFAULT_QUERY_LIMIT = 10
const MIN_QUERY_LIMIT = 1
const MAX_QUERY_LIMIT = 50

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
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    limit: Flags.integer({
      default: DEFAULT_QUERY_LIMIT,
      // Tool-mode only — bounds the matches[] array returned in the
      // envelope. Legacy `brv query` (Tier 3 LLM synthesis) ignores
      // this flag.
      description: `Maximum matches under tool mode (${MIN_QUERY_LIMIT}-${MAX_QUERY_LIMIT})`,
      max: MAX_QUERY_LIMIT,
      min: MIN_QUERY_LIMIT,
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

    // Tool-mode dispatch happens BEFORE any provider check or daemon
    // connection. Tool mode never invokes byterover's LLM — providers
    // can be absent and the call still works. Mirrors the curate
    // tool-mode dispatch order.
    if (process.env[TOOL_MODE_ENV_VAR] === '1') {
      await this.handleToolModeQuery({
        format,
        limit: flags.limit ?? DEFAULT_QUERY_LIMIT,
        query: args.query,
      })
      return
    }

    if (!this.validateInput(args.query, format)) return

    let providerContext: ProviderErrorContext | undefined

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

          await this.submitTask({
            client,
            format,
            projectRoot,
            query: args.query,
            timeoutMs: (flags.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
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
      this.reportError(error, format, providerContext)
    }
  }

  /**
   * Wire-envelope emitter for tool-mode query. JSON mode wraps the
   * envelope in the standard CLI envelope ({command, data, success,
   * timestamp}). Text mode prints a human-readable digest mirroring
   * the legacy Tier-2 direct-response output — the primary consumer
   * is the calling agent in `--format json` mode.
   */
  private emitToolModeEnvelope(envelope: QueryToolModeEnvelope, format: 'json' | 'text', query?: string): void {
    if (format === 'json') {
      writeJsonResponse({command: 'query', data: envelope, success: true})
      return
    }

    if (envelope.status === 'no-matches') {
      this.log('No matches.')
      return
    }

    // Reuse the existing Tier-2 direct-response formatter so shell
    // users see the same shape they get on the legacy path.
    const directResults = envelope.matchedDocs.map((m) => ({
      content: m.rendered_md,
      path: m.path,
      score: m.score,
      title: m.title,
    }))
    this.log(formatDirectResponse(query ?? '', directResults))
  }

  /**
   * Tool-mode query dispatch. Wraps the daemon connection so
   * `runRetrieval` can submit a `type: 'search'` task and consume
   * its `SearchKnowledgeResult` — same code path as `brv search`.
   * The daemon is used ONLY for the BM25 index; no LLM tier
   * dispatch and no provider check fire on this path.
   *
   * Dispatch/connection failures bubble up as outer envelope
   * `success: false` via `reportError`, mirroring curate tool mode.
   */
  private async handleToolModeQuery(props: {
    format: 'json' | 'text'
    limit: number
    query: string
  }): Promise<void> {
    const {format, limit, query} = props

    if (query.trim().length === 0) {
      // Use the same `{error, status: 'error'}` shape as `reportError`
      // emits — calling agents parsing `--format json` get one
      // consistent failure surface regardless of where the rejection
      // came from.
      if (format === 'json') {
        writeJsonResponse({
          command: 'query',
          data: {error: 'Tool-mode query requires a question argument.', status: 'error'},
          success: false,
        })
      } else {
        this.log('Query argument is required.')
        this.log('Usage: BRV_QUERY_TOOL_MODE=1 brv query "your question here"')
      }

      return
    }

    try {
      await withDaemonRetry(async (client) => {
        const envelope = await runRetrieval({client, limit, query})
        this.emitToolModeEnvelope(envelope, format, query)
      }, this.getDaemonClientOptions())
    } catch (error) {
      this.reportError(error, format)
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
