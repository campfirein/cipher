/**
 * brv-search MCP tool (Phase 5 Task 5.2).
 *
 * Deterministic, LLM-free tier 0/1/2 query interface for external agents.
 * The daemon-side handler (agent-process.ts case `'mcp-search'`) routes
 * directly through `QueryDispatcher` (NOT a parallel SearchExecutor —
 * that's reserved for the existing CLI `brv search` BM25 task type).
 *
 * Returns a JSON-encoded `DispatchResult` per DESIGN §6.1:
 *   {tier, status, passages?, cached_answer?, fingerprint?, total_found, timing_ms}
 *
 * Agents detect `status: 'needs_synthesis'` as the signal to escalate to
 * `brv_gather` (Task 5.3).
 */

import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import type {BrvSearchResult} from '../../dispatcher/query-dispatcher.js'

import {encodeSearchContent} from '../../../../shared/transport/search-content.js'
import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

export const BrvSearchInputSchema = z.object({
  cwd: cwdField,
  /** Result cap, default 10, max 50 (DESIGN §6.1). */
  limit: z.number().int().min(1).max(50).optional(),
  query: z.string().describe('Natural language question — tiers 0/1/2 only, no LLM'),
  /** Optional path-prefix scope filter (e.g., "src/auth"). */
  scope: z.string().optional(),
})

/**
 * Registers the brv-search tool with the MCP server.
 *
 * Unlike `brv-query` (legacy, marked deprecated in Task 5.5), this tool
 * never invokes the LLM — it returns either a cached answer (tier 0/1),
 * a direct BM25-derived answer + passages (tier 2 direct), or just
 * passages with `status: 'needs_synthesis'` for the agent to feed into
 * `brv_gather` and synthesize using its own model.
 */
export function registerBrvSearchTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
): void {
  server.registerTool(
    'brv-search',
    {
      description:
        'LLM-free tier 0/1/2 search over the ByteRover context tree. Returns cached answer, ' +
        'direct BM25 answer + passages, or passages with needs_synthesis status. Cheap and deterministic. ' +
        'Escalate to brv-gather when status is needs_synthesis.',
      inputSchema: BrvSearchInputSchema,
      title: 'ByteRover Search',
    },
    async (input: {cwd?: string; limit?: number; query: string; scope?: string}) => {
      const cwdResult = resolveClientCwd(input.cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {
          content: [{text: cwdResult.error, type: 'text' as const}],
          isError: true,
        }
      }

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
        const resultPromise = waitForTaskResult(client, taskId)

        await client.requestWithAck(TransportTaskEventNames.CREATE, {
          clientCwd: cwdResult.clientCwd,
          content: encodeSearchContent({
            ...(input.limit === undefined ? {} : {limit: input.limit}),
            query: input.query,
            ...(input.scope === undefined ? {} : {scope: input.scope}),
          }),
          projectPath: taskContext.projectRoot,
          taskId,
          type: 'mcp-search',
          worktreeRoot: taskContext.worktreeRoot,
        })

        const result = await resultPromise

        // PHASE-5-CODE-REVIEW.md W2: return both text content (legacy MCP UIs)
        // and structured `_meta` (tool-aware clients can read the typed payload
        // without re-parsing the JSON text block). The daemon already emits the
        // public BrvSearchResult DTO via toBrvSearchResult — see
        // PHASE-5-CODE-REVIEW.md F4. If JSON parse fails, fall back to text-only
        // so legacy callers still receive the raw daemon response.
        let parsedMeta: BrvSearchResult | undefined
        try {
          const raw: unknown = JSON.parse(result)
          // Light structural check — at minimum tier + status must be present
          // (avoids `as` assertion per CLAUDE.md standards)
          if (
            raw !== null &&
            typeof raw === 'object' &&
            'tier' in raw &&
            'status' in raw
          ) {
            parsedMeta = raw as BrvSearchResult
          }
        } catch {
          // raw text fallback below
        }

        return {
          _meta: parsedMeta as unknown as Record<string, unknown> | undefined,
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
