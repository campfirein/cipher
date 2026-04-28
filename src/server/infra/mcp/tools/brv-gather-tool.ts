/**
 * brv-gather MCP tool (Phase 5 Task 5.3).
 *
 * Returns a context bundle for the agent to synthesize from. NEVER invokes
 * the LLM — synthesis crosses the MCP boundary by design (DESIGN §4.2).
 *
 * The agent's typical flow:
 *   brv_search → status: 'needs_synthesis' → brv_gather → synthesize locally.
 */

import type {ITransportClient} from '@campfirein/brv-transport-client'
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'

import {waitForConnectedClient} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

import {encodeGatherContent} from '../../../../shared/transport/gather-content.js'
import {TransportTaskEventNames} from '../../../core/domain/transport/schemas.js'
import {associateProjectWithRetry, type McpStartupProjectContext, resolveMcpTaskContext} from './mcp-project-context.js'
import {resolveClientCwd} from './resolve-client-cwd.js'
import {cwdField} from './shared-schema.js'
import {waitForTaskResult} from './task-result-waiter.js'

/* eslint-disable camelcase -- DESIGN §6.2 specifies snake_case for MCP-facing fields */
export const BrvGatherInputSchema = z.object({
  cwd: cwdField,
  /** Result cap, default 10, max 50 (mirrors brv-search). */
  limit: z.number().int().min(1).max(50).optional(),
  query: z.string().describe('Natural language question to gather context for'),
  /** Optional path-prefix scope filter. */
  scope: z.string().optional(),
  /** Soft cap on bundle tokens (default 4000 per DESIGN §6.2). */
  token_budget: z.number().int().min(100).max(64_000).optional(),
})
/* eslint-enable camelcase */

export function registerBrvGatherTool(
  server: McpServer,
  getClient: () => ITransportClient | undefined,
  getWorkingDirectory: () => string | undefined,
  getStartupProjectContext: () => McpStartupProjectContext | undefined,
): void {
  server.registerTool(
    'brv-gather',
    {
      description:
        'Assemble an LLM-free context bundle (BM25 passages + token estimate + follow-up hints) for the calling agent ' +
        'to synthesize from. Use after brv-search returns status: needs_synthesis.',
      inputSchema: BrvGatherInputSchema,
      title: 'ByteRover Gather',
    },
    async (input: {
      cwd?: string
      limit?: number
      query: string
      scope?: string
      token_budget?: number
    }) => {
      const cwdResult = resolveClientCwd(input.cwd, getWorkingDirectory)
      if (!cwdResult.success) {
        return {content: [{text: cwdResult.error, type: 'text' as const}], isError: true}
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
          content: encodeGatherContent({
            ...(input.limit === undefined ? {} : {limit: input.limit}),
            query: input.query,
            ...(input.scope === undefined ? {} : {scope: input.scope}),
            ...(input.token_budget === undefined ? {} : {tokenBudget: input.token_budget}),
          }),
          projectPath: taskContext.projectRoot,
          taskId,
          type: 'gather',
          worktreeRoot: taskContext.worktreeRoot,
        })

        const result = await resultPromise

        return {content: [{text: result, type: 'text' as const}]}
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {content: [{text: `Error: ${message}`, type: 'text' as const}], isError: true}
      }
    },
  )
}
