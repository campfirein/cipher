import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {recordLegacyQueryInvocation} from './deprecation-telemetry.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

export const BrvQueryInputSchema = z.object({
  cwd: cwdField,
  query: z.string().describe('Natural language question about the codebase or project'),
})

/**
 * Registers the brv-query tool with the MCP server.
 *
 * **DEPRECATED (Phase 5 Task 5.5)** — agents should migrate to:
 *   `brv-search` (tier 0/1/2 — cached/BM25, no LLM)
 *   `brv-gather` (tier 3 prep — context bundle, no LLM; agent synthesizes)
 *   `brv-record-answer` (cache-write companion to close the loop)
 *
 * The legacy tool keeps working — old MCP clients are unaffected. Each
 * invocation writes one JSONL line to `<dataDir>/telemetry/mcp-deprecation.jsonl`
 * so we can decide when usage is low enough to remove this MCP path.
 * The CLI `brv query` command stays — that's a separate consumer.
 */
export function registerBrvQueryTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
): void {
  server.registerTool(
    'brv-query',
    {
      // MCP SDK's `annotations` only accepts standard fields (readOnlyHint,
      // destructiveHint, etc.) — arbitrary metadata goes in `_meta`. Tool-aware
      // clients can read `_meta.deprecated` / `_meta.replacedBy` to surface
      // migration guidance; legacy clients see the `[deprecated]` prefix in
      // the description and the title suffix.
      _meta: {
        deprecated: true,
        replacedBy: ['brv-search', 'brv-gather', 'brv-record-answer'],
      },
      description:
        '[deprecated] Query the ByteRover context tree for patterns, decisions, or implementation details. ' +
        'Migrate to brv-search + brv-gather + brv-record-answer (LLM-free pipeline; agent synthesizes locally).',
      inputSchema: BrvQueryInputSchema,
      title: 'ByteRover Query (deprecated)',
    },
    async ({cwd, query}: {cwd?: string; query: string}) => {
      // Telemetry first — fire on every invocation so adoption metrics include
      // failures (failed legacy calls still count as legacy usage).
      recordLegacyQueryInvocation()
      // Resolve clientCwd: explicit cwd param > server working directory
      const cwdResult = resolveClientCwd(cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {
          content: [{text: cwdResult.error, type: 'text' as const}],
          isError: true,
        }
      }

      // Wait for a connected client (MCP's attemptReconnect() replaces client in background)
      const client = await waitForConnectedClient(getClient)
      if (!client) {
        return {
          content: [
            {
              text: 'Error: Not connected to the daemon. Connection timed out. Ensure "brv" is running.',
              type: 'text' as const,
            },
          ],
          isError: true,
        }
      }

      try {
        const taskContext = resolveMcpTaskContext(cwdResult.clientCwd, getStartupProjectContext())
        if (!getWorkingDirectory()) {
          await associateProjectWithRetry(client, taskContext.projectRoot)
        }

        const taskId = randomUUID()

        // Register event listeners BEFORE sending task:create to avoid race conditions.
        // If the task completes before listeners are set up, the task:completed event is missed.
        const resultPromise = waitForTaskResult(client, taskId)

        // Create task via transport (same pattern as brv query command)
        await client.requestWithAck(TransportTaskEventNames.CREATE, {
          clientCwd: cwdResult.clientCwd,
          content: query,
          projectPath: taskContext.projectRoot,
          taskId,
          type: 'query',
          worktreeRoot: taskContext.worktreeRoot,
        })

        // Wait for the already-listening result promise
        const result = await resultPromise

        return {
          content: [{text: result, type: 'text' as const}],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{text: `Error: ${message}`, type: 'text' as const}],
          isError: true,
        }
      }
    },
  )
}
